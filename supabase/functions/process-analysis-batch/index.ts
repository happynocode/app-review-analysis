import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ProcessBatchRequest {
  taskId?: string // Specific task ID to process
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

    const { taskId }: ProcessBatchRequest = await req.json()

    let taskToProcess = null

    if (taskId) {
      // Process specific task
      console.log(`🎯 Processing specific task: ${taskId}`)
      const { data: task, error: taskError } = await supabaseClient
        .from('analysis_tasks')
        .select('*')
        .eq('id', taskId)
        .eq('status', 'pending')
        .single()

      if (taskError || !task) {
        return new Response(
          JSON.stringify({ error: 'Task not found or not pending' }),
          { 
            status: 404, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        )
      }

      taskToProcess = task
    } else {
      // Find next pending task
      console.log(`🔍 Looking for next pending analysis task...`)
      const { data: tasks, error: tasksError } = await supabaseClient
        .from('analysis_tasks')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1)

      if (tasksError) {
        throw new Error(`Failed to fetch pending tasks: ${tasksError.message}`)
      }

      if (!tasks || tasks.length === 0) {
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'No pending tasks found',
            processed: false
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        )
      }

      taskToProcess = tasks[0]
    }

    console.log(`🚀 Processing analysis task ${taskToProcess.id} (batch ${taskToProcess.batch_index})`)

    // Start processing the task
    EdgeRuntime.waitUntil(processAnalysisTask(taskToProcess, supabaseClient))

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Batch processing started',
        taskId: taskToProcess.id,
        batchIndex: taskToProcess.batch_index,
        reportId: taskToProcess.report_id
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error in process-analysis-batch:', error)
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

async function processAnalysisTask(task: any, supabaseClient: any) {
  const startTime = Date.now()
  
  try {
    console.log(`🔄 Starting analysis for task ${task.id}, batch ${task.batch_index}`)
    console.log(`📊 Reviews in batch: ${task.reviews_data.length}`)

    // Update task status to processing
    await supabaseClient
      .from('analysis_tasks')
      .update({ 
        status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('id', task.id)

    // Get app name from report
    const { data: report, error: reportError } = await supabaseClient
      .from('reports')
      .select('app_name')
      .eq('id', task.report_id)
      .single()

    if (reportError || !report) {
      throw new Error('Failed to fetch report information')
    }

    // Perform DeepSeek analysis
    console.log(`🧠 Analyzing batch ${task.batch_index} with DeepSeek...`)
    const analysisResult = await analyzeWithDeepSeek(report.app_name, task.reviews_data, task.batch_index)

    // Save analysis results to task
    await supabaseClient
      .from('analysis_tasks')
      .update({ 
        status: 'completed',
        themes_data: analysisResult,
        updated_at: new Date().toISOString()
      })
      .eq('id', task.id)

    const processingTime = Date.now() - startTime
    console.log(`✅ Completed analysis for task ${task.id} in ${Math.round(processingTime / 1000)}s`)
    console.log(`📊 Found ${analysisResult.themes?.length || 0} themes`)

    // Check if all tasks for this report are completed
    await checkAndCompleteReport(task.report_id, supabaseClient)

    // Trigger next batch processing
    await triggerNextBatch(supabaseClient)

  } catch (error) {
    console.error(`❌ Error processing task ${task.id}:`, error)
    
    // Update task status to failed
    await supabaseClient
      .from('analysis_tasks')
      .update({ 
        status: 'failed',
        error_message: error.message,
        updated_at: new Date().toISOString()
      })
      .eq('id', task.id)

    // Check if we should mark the report as failed
    await checkReportStatus(task.report_id, supabaseClient)
  }
}

async function analyzeWithDeepSeek(appName: string, reviews: string[], batchIndex: number) {
  const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY')
  
  if (!deepseekApiKey) {
    throw new Error('DEEPSEEK_API_KEY environment variable is not set')
  }

  // Truncate reviews to manage token usage
  const truncatedReviews = reviews.map(review => {
    if (review.length > 400) {
      return review.substring(0, 400) + '...'
    }
    return review
  }).slice(0, 300) // Limit to 300 reviews per batch

  const prompt = `Analyze user reviews for "${appName}". Identify 10-12 key themes.

Batch ${batchIndex} Reviews (${truncatedReviews.length}):
${truncatedReviews.join('\n\n')}

Return JSON only:
{
  "batchIndex": ${batchIndex},
  "reviewsAnalyzed": ${truncatedReviews.length},
  "themes": [
    {
      "title": "Theme title (2-5 words)",
      "description": "Detailed description (2-3 sentences)",
      "quotes": [
        {
          "text": "Exact quote from review",
          "source": "App Store|Google Play|Reddit",
          "date": "2025-01-10"
        }
      ],
      "suggestions": [
        "Specific actionable suggestion",
        "Another concrete recommendation"
      ],
      "frequency": "high|medium|low",
      "sentiment": "positive|negative|mixed"
    }
  ]
}`

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${deepseekApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: 'You are an expert product analyst. Always respond with valid JSON only, no markdown formatting.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 6000
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`)
    }

    const result = await response.json()
    let content = result.choices[0].message.content.trim()

    // Clean up the response
    content = content.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim()

    const analysisResult = JSON.parse(content)
    
    if (!analysisResult.themes || !Array.isArray(analysisResult.themes)) {
      throw new Error('Invalid analysis result structure')
    }

    console.log(`✅ DeepSeek analysis completed for batch ${batchIndex}: ${analysisResult.themes.length} themes`)
    return analysisResult

  } catch (error) {
    console.error(`❌ DeepSeek analysis failed for batch ${batchIndex}:`, error.message)
    throw error
  }
}

async function checkAndCompleteReport(reportId: string, supabaseClient: any) {
  try {
    // Check if all tasks for this report are completed
    const { data: tasks, error: tasksError } = await supabaseClient
      .from('analysis_tasks')
      .select('id, status')
      .eq('report_id', reportId)

    if (tasksError) {
      console.error('Error checking task status:', tasksError)
      return
    }

    const pendingTasks = tasks.filter(task => task.status === 'pending' || task.status === 'processing')
    const completedTasks = tasks.filter(task => task.status === 'completed')
    const failedTasks = tasks.filter(task => task.status === 'failed')

    console.log(`📊 Report ${reportId} task status: ${completedTasks.length} completed, ${pendingTasks.length} pending, ${failedTasks.length} failed`)

    if (pendingTasks.length === 0) {
      // All tasks are done, trigger report completion
      console.log(`🎯 All tasks completed for report ${reportId}, triggering final report assembly`)
      
      const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/complete-report-analysis`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reportId })
      })

      if (!response.ok) {
        console.error(`Failed to trigger report completion: ${response.status}`)
      } else {
        console.log(`✅ Successfully triggered report completion for ${reportId}`)
      }
    }

  } catch (error) {
    console.error('Error checking report completion:', error)
  }
}

async function checkReportStatus(reportId: string, supabaseClient: any) {
  try {
    // Check if too many tasks have failed
    const { data: tasks, error: tasksError } = await supabaseClient
      .from('analysis_tasks')
      .select('id, status')
      .eq('report_id', reportId)

    if (tasksError) {
      console.error('Error checking task status:', tasksError)
      return
    }

    const failedTasks = tasks.filter(task => task.status === 'failed')
    const totalTasks = tasks.length

    // If more than 50% of tasks failed, mark report as failed
    if (failedTasks.length > totalTasks * 0.5) {
      console.log(`❌ Too many failed tasks (${failedTasks.length}/${totalTasks}), marking report as failed`)
      
      await supabaseClient
        .from('reports')
        .update({ status: 'error' })
        .eq('id', reportId)
    }

  } catch (error) {
    console.error('Error checking report status:', error)
  }
}

async function triggerNextBatch(supabaseClient: any) {
  try {
    // Find next pending task
    const { data: nextTasks, error: nextError } = await supabaseClient
      .from('analysis_tasks')
      .select('id')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)

    if (nextError) {
      console.error('Error finding next task:', nextError)
      return
    }

    if (nextTasks && nextTasks.length > 0) {
      console.log(`🔄 Triggering next batch: ${nextTasks[0].id}`)
      
      // Trigger next batch with a small delay
      setTimeout(async () => {
        try {
          const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-analysis-batch`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ taskId: nextTasks[0].id })
          })

          if (!response.ok) {
            console.error(`Failed to trigger next batch: ${response.status}`)
          }
        } catch (error) {
          console.error('Error triggering next batch:', error)
        }
      }, 2000) // 2 second delay
    } else {
      console.log(`✅ No more pending tasks found`)
    }

  } catch (error) {
    console.error('Error triggering next batch:', error)
  }
}