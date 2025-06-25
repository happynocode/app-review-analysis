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

    // Perform themes analysis with Gemini
    console.log(`🧠 Analyzing themes for batch ${task.batch_index} with Gemini...`)
    const analysisResult = await analyzeThemesWithGemini(
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
async function analyzeThemesWithGemini(appName: string, reviews: any[], batchIndex: number) {
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY')

  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set')
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
      const themes = await callGeminiAPI(platformSpecificPrompt)
      
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

CRITICAL OUTPUT REQUIREMENTS:
🚨 You MUST return ONLY valid JSON - no markdown, no explanatory text, no code blocks
🚨 Start your response with { and end with }
🚨 Do not include markdown code blocks or backticks
🚨 Do not add any text before or after the JSON

REQUIRED JSON FORMAT:
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

VALIDATION RULES:
- Return 20-50 themes based on data quality and diversity
- Each theme title must be 2+ words (not single words like "json", "reddit")
- Ensure each theme has 2-3 representative quotes from actual reviews
- Make suggestions specific and actionable, not generic advice
- Consider this is ${platformNames[platform]} specific feedback when creating themes
- NO MARKDOWN FORMATTING - PURE JSON ONLY`

  return prompt
}

// Gemini模型列表，按优先级排序
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite-preview-06-17',
  'gemini-2.5-flash-preview-tts',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite'
]

// 调用Gemini API的通用函数，支持多模型回退
async function callGeminiAPI(prompt: string) {
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY')

  let lastError: Error | null = null

  // 按顺序尝试每个模型
  for (const model of GEMINI_MODELS) {
    try {
      console.log(`🤖 Trying Gemini model: ${model}`)

      // API call with timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 120000) // 2 minute timeout

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are an expert product analyst specializing in user feedback analysis. You MUST return valid JSON without markdown formatting or additional text. Only return the JSON object with themes array. Do not include any explanatory text before or after the JSON.

${prompt}`
            }]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 6000,
            topP: 0.8,
            topK: 40
          }
        }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        const error = new Error(`Gemini API error for model ${model}: ${response.status} - ${errorText}`)
        console.warn(`⚠️ Model ${model} failed: ${error.message}`)
        lastError = error
        continue // 尝试下一个模型
      }

      const data = await response.json()
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text

      if (!content) {
        const error = new Error(`No content in Gemini response for model ${model}`)
        console.warn(`⚠️ Model ${model} returned no content`)
        lastError = error
        continue // 尝试下一个模型
      }

      console.log(`✅ Successfully used model: ${model}`)
      console.log('🔍 Raw Gemini response preview:', content.substring(0, 300) + '...')

      // 改进的JSON解析逻辑
      try {
        let cleanContent = content.trim()

        // 移除可能的markdown格式
        if (cleanContent.startsWith('```json') && cleanContent.endsWith('```')) {
          cleanContent = cleanContent.slice(7, -3).trim()
        } else if (cleanContent.startsWith('```') && cleanContent.endsWith('```')) {
          cleanContent = cleanContent.slice(3, -3).trim()
        }

        // 更aggressive地寻找JSON对象
        const jsonStart = cleanContent.indexOf('{')
        const jsonEnd = cleanContent.lastIndexOf('}')

        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          cleanContent = cleanContent.slice(jsonStart, jsonEnd + 1)
        }

        // 移除可能的前后缀文本
        cleanContent = cleanContent.replace(/^[^{]*/, '').replace(/[^}]*$/, '')

        console.log('🧹 Cleaned content preview:', cleanContent.substring(0, 300) + '...')

        const result = JSON.parse(cleanContent)

        // 严格验证结构
        if (result.themes && Array.isArray(result.themes) && result.themes.length > 0) {
          // 验证每个theme的结构并过滤无效的
          const validThemes = result.themes.filter(theme => {
            const isValid = theme.title &&
                           typeof theme.title === 'string' &&
                           theme.title.trim().length > 2 &&
                           theme.title.trim().length < 200 && // 避免过长的标题
                           theme.description &&
                           typeof theme.description === 'string' &&
                           theme.description.trim().length > 10 &&
                           // 确保是有意义的主题标题，不是单个词汇
                           theme.title.split(' ').length >= 2 &&
                           !theme.title.toLowerCase().match(/^(json|reddit|app|store|google|play|analysis|result|themes?|title|description|quotes|suggestions)$/i)

            if (!isValid) {
              console.warn(`🚨 Filtered invalid theme: "${theme.title}" (reason: ${
                !theme.title ? 'no title' :
                typeof theme.title !== 'string' ? 'title not string' :
                theme.title.trim().length <= 2 ? 'title too short' :
                theme.title.trim().length >= 200 ? 'title too long' :
                !theme.description ? 'no description' :
                typeof theme.description !== 'string' ? 'description not string' :
                theme.description.trim().length <= 10 ? 'description too short' :
                theme.title.split(' ').length < 2 ? 'single word title' :
                'matches blacklisted words'
              })`)
            }
            return isValid
          })

          if (validThemes.length > 0) {
            console.log(`✅ Successfully parsed ${validThemes.length} valid themes with model ${model}`)
            return { themes: validThemes }
          } else {
            console.warn(`⚠️ No valid themes found after filtering for model ${model}`)
          }
        }

        const error = new Error(`Invalid or empty themes structure in response for model ${model}`)
        console.warn(`⚠️ Model ${model} returned invalid structure`)
        lastError = error
        continue // 尝试下一个模型

      } catch (parseError) {
        console.error(`❌ JSON parsing failed for model ${model}:`, parseError.message)
        console.log('🔍 Full problematic content:', content)

        const error = new Error(`Gemini model ${model} returned invalid JSON format: ${parseError.message}. Content preview: ${content.substring(0, 200)}...`)
        lastError = error
        continue // 尝试下一个模型
      }

    } catch (error) {
      clearTimeout(timeoutId)
      if (error.name === 'AbortError') {
        const timeoutError = new Error(`Model ${model} timed out after 2 minutes`)
        console.warn(`⚠️ ${timeoutError.message}`)
        lastError = timeoutError
        continue // 尝试下一个模型
      }

      console.warn(`⚠️ Model ${model} failed with error:`, error.message)
      lastError = error
      continue // 尝试下一个模型
    }
  }

  // 如果所有模型都失败了，抛出最后一个错误
  throw new Error(`All Gemini models failed. Last error: ${lastError?.message || 'Unknown error'}`)
}



// 移除了有问题的extractThemesFromText函数
// 这个函数会把"json"、"Reddit"等单词错误识别为主题标题
// 问题出在这个条件：(trimmed.length < 100 && !trimmed.includes('.'))
// 它会把任何短于100字符且不包含句号的文本都当作主题标题

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