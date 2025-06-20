import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ProcessBatchRequestV2 {
  queueId?: string        // Processing queue ID to process
  reportId?: string       // Report ID to process all queued batches
  batchId?: string        // Specific batch ID to process
  forceRetry?: boolean    // Force retry failed tasks
}

interface QueueTask {
  id: string
  report_id: string
  batch_id: string
  priority: number
  status: string
  retry_count: number
  max_retries: number
  error_details?: any
  created_at: string
  scheduled_at: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { queueId, reportId, batchId, forceRetry }: ProcessBatchRequestV2 = await req.json()

    let tasksToProcess: QueueTask[] = []

    if (queueId) {
      // Process specific queue task
      console.log(`🎯 Processing specific queue task: ${queueId}`)
      const { data: task, error: taskError } = await supabaseClient
        .from('processing_queue')
        .select('*')
        .eq('id', queueId)
        .eq('status', 'queued')
        .single()

      if (taskError || !task) {
        return new Response(
          JSON.stringify({ error: 'Queue task not found or not queued' }),
          { 
            status: 404, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        )
      }

      tasksToProcess = [task]
    } else if (batchId) {
      // Process all tasks for specific batch
      console.log(`🎯 Processing batch: ${batchId}`)
      const { data: tasks, error: tasksError } = await supabaseClient
        .from('processing_queue')
        .select('*')
        .eq('batch_id', batchId)
        .in('status', ['queued', ...(forceRetry ? ['failed'] : [])])
        .order('priority', { ascending: false })

      if (tasksError) {
        throw new Error(`Failed to fetch batch tasks: ${tasksError.message}`)
      }

      tasksToProcess = tasks || []
    } else if (reportId) {
      // Process all queued tasks for specific report
      console.log(`🎯 Processing report: ${reportId}`)
      const { data: tasks, error: tasksError } = await supabaseClient
        .from('processing_queue')
        .select('*')
        .eq('report_id', reportId)
        .in('status', ['queued', ...(forceRetry ? ['failed'] : [])])
        .order('priority', { ascending: false })
        .limit(10) // Limit concurrent processing

      if (tasksError) {
        throw new Error(`Failed to fetch report tasks: ${tasksError.message}`)
      }

      tasksToProcess = tasks || []
    } else {
      // Find next high-priority queued tasks
      console.log(`🔍 Looking for next queued tasks...`)
      const { data: tasks, error: tasksError } = await supabaseClient
        .from('processing_queue')
        .select('*')
        .eq('status', 'queued')
        .order('priority', { ascending: false })
        .order('scheduled_at', { ascending: true })
        .limit(6) // Support parallel processing

      if (tasksError) {
        throw new Error(`Failed to fetch queued tasks: ${tasksError.message}`)
      }

      tasksToProcess = tasks || []
    }

    if (tasksToProcess.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No queued tasks found',
          processed: 0
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log(`🚀 Processing ${tasksToProcess.length} queue tasks in parallel`)

    // Process all tasks in parallel (background processing)
    const processingPromises = tasksToProcess.map(task => 
      EdgeRuntime.waitUntil(processBatchTaskV2(task, supabaseClient))
    )

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Started processing ${tasksToProcess.length} batch tasks`,
        taskIds: tasksToProcess.map(t => t.id),
        batchIds: [...new Set(tasksToProcess.map(t => t.batch_id))],
        reportIds: [...new Set(tasksToProcess.map(t => t.report_id))]
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error in process-analysis-batch-v2:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

async function processBatchTaskV2(queueTask: QueueTask, supabaseClient: any) {
  const startTime = Date.now()
  
  try {
    console.log(`🔄 Starting batch task ${queueTask.id} for batch ${queueTask.batch_id}`)

    // Update queue task status to processing
    await supabaseClient
      .from('processing_queue')
      .update({ 
        status: 'processing',
        started_at: new Date().toISOString()
      })
      .eq('id', queueTask.id)

    // Find corresponding analysis task
    const { data: analysisTask, error: analysisError } = await supabaseClient
      .from('analysis_tasks')
      .select('*')
      .eq('report_id', queueTask.report_id)
      .eq('status', 'pending')
      .order('batch_index', { ascending: true })
      .limit(1)
      .single()

    if (analysisError || !analysisTask) {
      throw new Error('No pending analysis task found for this queue task')
    }

    console.log(`📊 Processing analysis task ${analysisTask.id} (batch ${analysisTask.batch_index})`)
    console.log(`📊 Reviews in batch: ${analysisTask.reviews_data.length}`)

    // Update analysis task status to processing
    await supabaseClient
      .from('analysis_tasks')
      .update({ 
        status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('id', analysisTask.id)

    // Get app name from report
    const { data: report, error: reportError } = await supabaseClient
      .from('reports')
      .select('app_name')
      .eq('id', queueTask.report_id)
      .single()

    if (reportError || !report) {
      throw new Error('Failed to fetch report information')
    }

    // Perform DeepSeek analysis with timeout protection
    console.log(`🧠 Analyzing batch ${analysisTask.batch_index} with DeepSeek...`)
    const analysisResult = await analyzeWithDeepSeekV2(
      report.app_name, 
      analysisTask.reviews_data, 
      analysisTask.batch_index
    )

    // Save analysis results to task
    await supabaseClient
      .from('analysis_tasks')
      .update({ 
        status: 'completed',
        themes_data: analysisResult,
        updated_at: new Date().toISOString()
      })
      .eq('id', analysisTask.id)

    // Mark queue task as completed
    await supabaseClient
      .from('processing_queue')
      .update({ 
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', queueTask.id)

    const processingTime = Date.now() - startTime
    console.log(`✅ Completed batch task ${queueTask.id} in ${Math.round(processingTime / 1000)}s`)
    console.log(`📊 Found ${analysisResult.themes?.length || 0} themes`)

    // Log success metric
    await logSystemMetric(supabaseClient, 'batch_processing_time', processingTime / 1000, 'seconds', {
      batch_id: queueTask.batch_id,
      report_id: queueTask.report_id,
      status: 'success'
    })

    // Check if all tasks for this report are completed
    await checkAndCompleteReportV2(queueTask.report_id, supabaseClient)

  } catch (error) {
    console.error(`❌ Error processing batch task ${queueTask.id}:`, error)
    
    // Increment retry count
    const newRetryCount = queueTask.retry_count + 1
    const shouldRetry = newRetryCount < queueTask.max_retries

    if (shouldRetry) {
      // Schedule for retry with exponential backoff
      const retryDelay = Math.min(Math.pow(2, newRetryCount) * 60, 300) // Max 5 minutes
      const retryAt = new Date(Date.now() + retryDelay * 1000)

      await supabaseClient
        .from('processing_queue')
        .update({ 
          status: 'queued',
          retry_count: newRetryCount,
          scheduled_at: retryAt.toISOString(),
          error_details: {
            message: error.message,
            timestamp: new Date().toISOString(),
            attempt: newRetryCount
          }
        })
        .eq('id', queueTask.id)

      console.log(`🔄 Scheduled retry ${newRetryCount}/${queueTask.max_retries} for task ${queueTask.id} in ${retryDelay}s`)
    } else {
      // Mark as permanently failed
      await supabaseClient
        .from('processing_queue')
        .update({ 
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_details: {
            message: error.message,
            timestamp: new Date().toISOString(),
            final_attempt: true
          }
        })
        .eq('id', queueTask.id)

      // Also mark corresponding analysis task as failed
      await supabaseClient
        .from('analysis_tasks')
        .update({ 
          status: 'failed',
          error_message: error.message,
          updated_at: new Date().toISOString()
        })
        .eq('report_id', queueTask.report_id)
        .eq('status', 'processing')

      console.log(`❌ Permanently failed task ${queueTask.id} after ${queueTask.max_retries} attempts`)

      // Log failure metric
      await logSystemMetric(supabaseClient, 'batch_processing_failures', 1, 'count', {
        batch_id: queueTask.batch_id,
        report_id: queueTask.report_id,
        error: error.message
      })

      // Send alert for critical failure
      await logAlert(supabaseClient, 'batch_processing_failure', 'error', 
        `Batch task ${queueTask.id} failed permanently after ${queueTask.max_retries} retries`, 
        { queueTask, error: error.message }
      )
    }

    // Check if we should mark the report as failed
    await checkReportStatusV2(queueTask.report_id, supabaseClient)
  }
}

async function analyzeWithDeepSeekV2(appName: string, reviews: string[], batchIndex: number) {
  const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY')
  
  if (!deepseekApiKey) {
    throw new Error('DEEPSEEK_API_KEY environment variable is not set')
  }

  // Enhanced review preprocessing
  const truncatedReviews = reviews
    .filter(review => review.trim().length > 10) // Filter out very short reviews
    .map(review => {
      if (review.length > 400) {
        return review.substring(0, 400) + '...'
      }
      return review
    })
    .slice(0, 250) // Optimized batch size for better performance

  const prompt = `Analyze user reviews for "${appName}". Identify 8-10 key themes with high relevance.

Batch ${batchIndex} Reviews (${truncatedReviews.length} reviews):
${truncatedReviews.join('\n\n')}

Return exactly this JSON structure:
{
  "themes": [
    {
      "title": "Theme Title",
      "description": "Detailed description of the theme",
      "quotes": ["representative quote 1", "representative quote 2"],
      "suggestions": ["improvement suggestion 1", "improvement suggestion 2"]
    }
  ]
}

Focus on:
- User experience issues and positive feedback
- Feature requests and suggestions
- Performance and reliability concerns
- UI/UX feedback
- Business impact themes`

  // Enhanced error handling and timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 180000) // 3 minute timeout

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        stream: false,
        max_tokens: 4000,
        temperature: 0.7,
      }),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response format from DeepSeek API')
    }

    const content = data.choices[0].message.content
    
    try {
      const result = JSON.parse(content)
      
      // Validate result structure
      if (!result.themes || !Array.isArray(result.themes)) {
        throw new Error('Invalid themes format in API response')
      }

      // Ensure themes have required fields
      result.themes = result.themes.map((theme: any) => ({
        title: theme.title || 'Untitled Theme',
        description: theme.description || 'No description provided',
        quotes: Array.isArray(theme.quotes) ? theme.quotes.slice(0, 3) : [],
        suggestions: Array.isArray(theme.suggestions) ? theme.suggestions.slice(0, 3) : []
      }))

      return result
    } catch (parseError) {
      console.error('Failed to parse DeepSeek response:', content)
      throw new Error(`Failed to parse analysis result: ${parseError.message}`)
    }

  } catch (error) {
    clearTimeout(timeoutId)
    
    if (error.name === 'AbortError') {
      throw new Error('DeepSeek API request timed out after 3 minutes')
    }
    
    throw error
  }
}

async function checkAndCompleteReportV2(reportId: string, supabaseClient: any) {
  try {
    // Check if all processing queue tasks for this report are completed
    const { data: queueTasks, error: queueError } = await supabaseClient
      .from('processing_queue')
      .select('status')
      .eq('report_id', reportId)

    if (queueError) {
      console.error('Error checking queue status:', queueError)
      return
    }

    const pendingTasks = queueTasks.filter((task: any) => 
      task.status === 'queued' || task.status === 'processing'
    )

    if (pendingTasks.length > 0) {
      console.log(`⏳ Report ${reportId} still has ${pendingTasks.length} pending queue tasks`)
      return
    }

    // Check if all analysis tasks are completed
    const { data: analysisTasks, error: analysisError } = await supabaseClient
      .from('analysis_tasks')
      .select('status')
      .eq('report_id', reportId)

    if (analysisError) {
      console.error('Error checking analysis tasks:', analysisError)
      return
    }

    const pendingAnalysis = analysisTasks.filter((task: any) => 
      task.status === 'pending' || task.status === 'processing'
    )

    if (pendingAnalysis.length > 0) {
      console.log(`⏳ Report ${reportId} still has ${pendingAnalysis.length} pending analysis tasks`)
      return
    }

    console.log(`🎉 All tasks completed for report ${reportId}. Triggering report completion...`)

    // Trigger complete-report-analysis function
    const { error: completeError } = await supabaseClient.functions.invoke('complete-report-analysis', {
      body: { reportId }
    })

    if (completeError) {
      console.error('Error completing report:', completeError)
      await logAlert(supabaseClient, 'report_completion_error', 'error', 
        `Failed to complete report ${reportId}`, { reportId, error: completeError.message }
      )
    } else {
      console.log(`✅ Successfully triggered completion for report ${reportId}`)
    }

  } catch (error) {
    console.error('Error in checkAndCompleteReportV2:', error)
  }
}

async function checkReportStatusV2(reportId: string, supabaseClient: any) {
  try {
    // Check if too many tasks have failed
    const { data: queueTasks, error: queueError } = await supabaseClient
      .from('processing_queue')
      .select('status')
      .eq('report_id', reportId)

    if (queueError) {
      console.error('Error checking queue status:', queueError)
      return
    }

    const failedTasks = queueTasks.filter((task: any) => task.status === 'failed')
    const totalTasks = queueTasks.length

    // If more than 50% of tasks failed, mark report as failed
    if (failedTasks.length > totalTasks * 0.5 && totalTasks > 0) {
      console.log(`❌ Report ${reportId} has too many failed tasks (${failedTasks.length}/${totalTasks})`)

      await supabaseClient
        .from('reports')
        .update({ 
          status: 'error',
          updated_at: new Date().toISOString()
        })
        .eq('id', reportId)

      await logAlert(supabaseClient, 'report_failure', 'critical', 
        `Report ${reportId} marked as failed due to high task failure rate`, 
        { reportId, failedTasks: failedTasks.length, totalTasks }
      )
    }

  } catch (error) {
    console.error('Error in checkReportStatusV2:', error)
  }
}

async function logSystemMetric(
  supabaseClient: any, 
  metricName: string, 
  metricValue: number, 
  metricUnit: string, 
  tags: any = {}
) {
  try {
    await supabaseClient
      .from('system_metrics')
      .insert({
        metric_name: metricName,
        metric_value: metricValue,
        metric_unit: metricUnit,
        tags: tags
      })
  } catch (error) {
    console.error('Error logging metric:', error)
  }
}

async function logAlert(
  supabaseClient: any, 
  alertType: string, 
  severity: string, 
  message: string, 
  details: any = {}
) {
  try {
    await supabaseClient
      .from('alert_logs')
      .insert({
        alert_type: alertType,
        severity: severity,
        message: message,
        details: details
      })
  } catch (error) {
    console.error('Error logging alert:', error)
  }
} 