import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ProcessBatchRequestV2 {
  reportId: string           // Report ID to process
  batchIndex?: number        // Specific batch index to process
  tasks?: any[]             // Direct task data from start-analysis-v2
  enableChainProcessing?: boolean  // Deprecated - now handled by database triggers
  forceRetry?: boolean      // Force retry failed tasks
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

    const { reportId, batchIndex, tasks, forceRetry }: ProcessBatchRequestV2 = await req.json()

    if (!reportId) {
      return new Response(
        JSON.stringify({ error: 'reportId is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    let tasksToProcess: any[] = []

    if (tasks && tasks.length > 0) {
      // Direct task processing (from start-analysis-v2)
      console.log(`🎯 Processing ${tasks.length} direct tasks for report ${reportId}`)
      tasksToProcess = tasks
    } else if (batchIndex !== undefined) {
      // Process specific batch index
      console.log(`🎯 Processing batch ${batchIndex} for report ${reportId}`)
      const { data: batchTasks, error: tasksError } = await supabaseClient
        .from('analysis_tasks')
        .select('*')
        .eq('report_id', reportId)
        .eq('batch_index', batchIndex)
        .in('status', ['pending', ...(forceRetry ? ['failed'] : [])])
        .order('priority', { ascending: false })

      if (tasksError) {
        throw new Error(`Failed to fetch batch tasks: ${tasksError.message}`)
      }

      tasksToProcess = batchTasks || []
    } else {
      // Find next pending tasks for this report (up to 4 tasks)
      console.log(`🔍 Looking for next pending tasks for report ${reportId}...`)
      const { data: pendingTasks, error: tasksError } = await supabaseClient
        .from('analysis_tasks')
        .select('*')
        .eq('report_id', reportId)
        .in('status', ['pending', ...(forceRetry ? ['failed'] : [])])
        .order('batch_index', { ascending: true })
        .order('priority', { ascending: false })
        .limit(4) // Process up to 4 tasks per call

      if (tasksError) {
        throw new Error(`Failed to fetch pending tasks: ${tasksError.message}`)
      }

      tasksToProcess = pendingTasks || []
    }

    if (tasksToProcess.length === 0) {
      console.log(`ℹ️ No tasks to process for report ${reportId}`)
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No tasks to process',
          processed: 0
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log(`🚀 Processing ${tasksToProcess.length} analysis tasks`)

    // Process all tasks in parallel using Promise.allSettled for better error handling
    const processingPromises = tasksToProcess.map(task => 
      processAnalysisTaskV2(task, supabaseClient)
    )

    const results = await Promise.allSettled(processingPromises)
    const successCount = results.filter(r => r.status === 'fulfilled').length
    const failureCount = results.length - successCount

    console.log(`📊 Batch processing complete: ${successCount} success, ${failureCount} failed`)

    // 链式调用逻辑已移除 - 现在由数据库触发器自动处理后续批次

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Processed ${tasksToProcess.length} analysis tasks`,
        processed: successCount,
        failed: failureCount,
        taskIds: tasksToProcess.map(t => t.id)
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

async function processAnalysisTaskV2(task: any, supabaseClient: any) {
  const startTime = Date.now()
  
  try {
    console.log(`🔄 Processing analysis task ${task.id} (themes analysis, batch ${task.batch_index})`)

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

    // Perform themes analysis with DeepSeek
    console.log(`🧠 Analyzing themes for batch ${task.batch_index} with DeepSeek...`)
    const analysisResult = await analyzeThemesWithDeepSeek(
      report.app_name, 
      task.reviews_data, 
      task.batch_index
    )

    // Save analysis results to task (只存储themes_data)
    const updateData = {
      status: 'completed',
      themes_data: analysisResult,
      updated_at: new Date().toISOString()
    }

    await supabaseClient
      .from('analysis_tasks')
      .update(updateData)
      .eq('id', task.id)

    const processingTime = Date.now() - startTime
    console.log(`✅ Completed task ${task.id} (themes) in ${Math.round(processingTime / 1000)}s`)

    // Log success metric
    await logSystemMetric(supabaseClient, 'task_processing_time', processingTime / 1000, 'seconds', {
      task_id: task.id,
      report_id: task.report_id,
      analysis_type: 'themes',
      status: 'success'
    })

  } catch (error) {
    console.error(`❌ Error processing task ${task.id}:`, error)
    
    // Mark task as failed
    await supabaseClient
      .from('analysis_tasks')
      .update({ 
        status: 'failed',
        error_message: error.message,
        updated_at: new Date().toISOString()
      })
      .eq('id', task.id)

    // Log failure metric
    await logSystemMetric(supabaseClient, 'task_processing_failures', 1, 'count', {
      task_id: task.id,
      report_id: task.report_id,
      analysis_type: 'themes',
      error: error.message
    })

    throw error // Re-throw to be handled by Promise.allSettled
  }
}

// 简化的themes分析函数
async function analyzeThemesWithDeepSeek(appName: string, reviews: any[], batchIndex: number) {
  const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY')
  
  if (!deepseekApiKey) {
    throw new Error('DEEPSEEK_API_KEY environment variable is not set')
  }

  // 按平台分组评论
  const platformGroups = {
    reddit: reviews.filter(r => r.platform === 'reddit'),
    app_store: reviews.filter(r => r.platform === 'app_store'),
    google_play: reviews.filter(r => r.platform === 'google_play')
  }

  console.log(`🔍 Batch ${batchIndex} platform distribution: Reddit ${platformGroups.reddit.length}, App Store ${platformGroups.app_store.length}, Google Play ${platformGroups.google_play.length}`)

  const platformThemes = {
    reddit_themes: [],
    app_store_themes: [],
    google_play_themes: []
  }

  // 分别分析每个平台的themes
  for (const [platform, platformReviews] of Object.entries(platformGroups)) {
    if (platformReviews.length === 0) {
      console.log(`⏭️ Skipping ${platform} - no reviews`)
      continue
    }

    console.log(`🧠 Analyzing ${platform} themes (${platformReviews.length} reviews)...`)
    
    // Extract review text from review objects
    const reviewTexts = platformReviews
      .map(review => typeof review === 'string' ? review : review.review_text)
      .filter(text => text && text.trim().length > 10)
      .map(text => text.length > 400 ? text.substring(0, 400) + '...' : text)
      .slice(0, 50) // Smaller batches for better performance

    if (reviewTexts.length === 0) {
      console.log(`⏭️ Skipping ${platform} - no valid review texts`)
      continue
    }

    // 针对不同平台定制化的prompt
    const platformSpecificPrompt = getPlatformSpecificPrompt(platform, appName, reviewTexts)

    try {
      const themes = await callDeepSeekAPI(platformSpecificPrompt)
      
      // 为每个theme添加平台标识
      const themesWithPlatform = themes.themes.map(theme => ({
        ...theme,
        platform: platform,
        source_platform: platform
      }))
      
      if (platform === 'reddit') {
        platformThemes.reddit_themes = themesWithPlatform
      } else if (platform === 'app_store') {
        platformThemes.app_store_themes = themesWithPlatform
      } else if (platform === 'google_play') {
        platformThemes.google_play_themes = themesWithPlatform
      }

      console.log(`✅ ${platform} analysis complete: ${themesWithPlatform.length} themes found`)
      
    } catch (error) {
      console.error(`❌ Error analyzing ${platform} themes:`, error)
      // 继续处理其他平台
    }
  }

  console.log(`📊 Batch ${batchIndex} themes analysis complete: Reddit ${platformThemes.reddit_themes.length}, App Store ${platformThemes.app_store_themes.length}, Google Play ${platformThemes.google_play_themes.length}`)

  return platformThemes
}

// 获取平台特定的prompt
function getPlatformSpecificPrompt(platform: string, appName: string, reviewTexts: string[]): string {
  const platformNames = {
    reddit: 'Reddit',
    app_store: 'App Store',
    google_play: 'Google Play'
  }

  const platformContext = {
    reddit: 'Reddit discussions and community feedback',
    app_store: 'iOS App Store user reviews',
    google_play: 'Google Play Store user reviews'
  }

  const prompt = `You are an expert product analyst specializing in user feedback analysis. Your task is to identify the most important themes from ${platformContext[platform]} for "${appName}".

PLATFORM-SPECIFIC CONTEXT: 
This analysis focuses specifically on ${platformNames[platform]} feedback, which may have different characteristics and user perspectives compared to other platforms.

ANALYSIS GUIDELINES:
1. Focus on themes that appear across multiple reviews (not isolated complaints)
2. Prioritize actionable insights that could improve the product
3. Group similar feedback into coherent themes
4. Extract meaningful quotes that represent each theme
5. Provide specific, actionable suggestions for each theme
6. Consider the ${platformNames[platform]} user context and behavior patterns

QUALITY STANDARDS:
- Each theme should represent feedback from multiple users
- Theme titles should be clear and specific (2-5 words)
- Descriptions should explain the theme's impact and context (2-3 sentences)
- Quotes should be representative and authentic user voices
- Suggestions should be actionable and specific to the theme

${platformNames[platform].toUpperCase()} REVIEWS (${reviewTexts.length} reviews for ${appName}):
${reviewTexts.map((text, i) => `Review ${i + 1}: ${text}`).join('\n\n')}

REQUIRED OUTPUT FORMAT (return ONLY valid JSON, no markdown):
{
  "themes": [
    {
      "title": "Clear theme name (2-5 words)",
      "description": "Detailed explanation of what this theme represents and why it matters to users. Include the frequency and impact of this feedback.",
      "quotes": [
        "Exact quote from review that represents this theme",
        "Another representative quote showing this pattern"
      ],
      "suggestions": [
        "Specific actionable recommendation to address this theme",
        "Another concrete suggestion for improvement"
      ]
    }
  ]
}

IMPORTANT: 
- Return 20-50 themes based on the data quality and diversity (focus on extracting meaningful patterns)
- Ensure each theme has 2-3 representative quotes from the actual reviews
- Make suggestions specific and actionable, not generic advice
- Return only the JSON object, no additional text or markdown formatting
- Consider this is ${platformNames[platform]} specific feedback when creating themes`

  return prompt
}

// 调用DeepSeek API的通用函数
async function callDeepSeekAPI(prompt: string) {
  const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY')
  
  // API call with timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 120000) // 2 minute timeout

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
            role: 'system',
            content: 'You are an expert product analyst specializing in user feedback analysis. Always return valid JSON without markdown formatting.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        stream: false,
        max_tokens: 6000, // 增加max_tokens以支持更多themes
        temperature: 0.3, // Lower temperature for more consistent JSON output
      }),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      throw new Error('No content in DeepSeek response')
    }

    // Parse JSON response with improved error handling
    try {
      // Try to extract JSON from markdown code blocks if present
      let cleanContent = content.trim()
      
      // Remove markdown code blocks
      if (cleanContent.startsWith('```json') && cleanContent.endsWith('```')) {
        cleanContent = cleanContent.slice(7, -3).trim()
      } else if (cleanContent.startsWith('```') && cleanContent.endsWith('```')) {
        cleanContent = cleanContent.slice(3, -3).trim()
      }
      
      const result = JSON.parse(cleanContent)
      
      // Validate the structure
      if (result.themes && Array.isArray(result.themes)) {
        return result
      } else {
        throw new Error('Invalid themes structure in response')
      }
      
    } catch (parseError) {
      console.warn('Failed to parse JSON, attempting to extract themes from text:', parseError.message)
      
      // Try to extract structured information from the raw text
      const extractedThemes = extractThemesFromText(content)
      if (extractedThemes.length > 0) {
        return { themes: extractedThemes }
      }
      
      // Fallback: return raw content as a single theme
      return { 
        themes: [{ 
          title: 'Analysis Result', 
          description: content.length > 500 ? content.substring(0, 500) + '...' : content, 
          quotes: [], 
          suggestions: ['Review the analysis output', 'Consider refining the prompt'] 
        }] 
      }
    }

  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error(`Themes analysis timed out after 2 minutes`)
    }
    throw error
  }
}

// Extract themes from raw text when JSON parsing fails
function extractThemesFromText(content: string): any[] {
  const themes: any[] = []
  
  // Try to find theme-like patterns in the text
  const lines = content.split('\n').filter(line => line.trim().length > 0)
  
  let currentTheme: any = null
  for (const line of lines) {
    const trimmed = line.trim()
    
    // Look for theme titles (lines that start with numbers, bullets, or are short and descriptive)
    if (trimmed.match(/^\d+\.?\s+/) || trimmed.match(/^[-*•]\s+/) || (trimmed.length < 100 && !trimmed.includes('.'))) {
      // Save previous theme if exists
      if (currentTheme) {
        themes.push(currentTheme)
      }
      
      // Start new theme
      currentTheme = {
        title: trimmed.replace(/^\d+\.?\s+|^[-*•]\s+/, '').trim(),
        description: '',
        quotes: [],
        suggestions: []
      }
    } else if (currentTheme && trimmed.length > 0) {
      // Add to description
      if (currentTheme.description) {
        currentTheme.description += ' ' + trimmed
      } else {
        currentTheme.description = trimmed
      }
    }
  }
  
  // Add the last theme
  if (currentTheme) {
    themes.push(currentTheme)
  }
  
  // If no themes found, try to create one from the whole content
  if (themes.length === 0 && content.trim().length > 0) {
    themes.push({
      title: 'User Feedback Analysis',
      description: content.length > 300 ? content.substring(0, 300) + '...' : content,
      quotes: [],
      suggestions: []
    })
  }
  
  return themes.slice(0, 50) // 增加限制到50个themes
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
        metric_type: metricName,
        metric_value: metricValue,
        metric_unit: metricUnit,
        details: tags,
        created_at: new Date().toISOString()
      })
  } catch (error) {
    console.warn('Failed to log system metric:', error)
  }
} 