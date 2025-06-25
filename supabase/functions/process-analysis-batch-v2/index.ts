import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-client-info, apikey, content-type',
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
  let taskStatusUpdated = false

  try {
    console.log(`🔄 Processing analysis task ${task.id} (themes analysis, batch ${task.batch_index})`)

    // Update task status to processing with error handling
    const { error: statusError } = await supabaseClient
      .from('analysis_tasks')
      .update({
        status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('id', task.id)

    if (statusError) {
      throw new Error(`Failed to update task status to processing: ${statusError.message}`)
    }

    taskStatusUpdated = true

    // Get app name from report
    const { data: report, error: reportError } = await supabaseClient
      .from('reports')
      .select('app_name')
      .eq('id', task.report_id)
      .single()

    if (reportError || !report) {
      throw new Error('Failed to fetch report information')
    }

    // Perform themes analysis with Gemini and heartbeat updates
    console.log(`🧠 Analyzing themes for batch ${task.batch_index} with Gemini...`)

    // 设置心跳机制，每2分钟更新一次任务状态
    const heartbeatInterval = setInterval(async () => {
      try {
        await supabaseClient
          .from('analysis_tasks')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', task.id)
        console.log(`💓 Heartbeat update for task ${task.id}`)
      } catch (heartbeatError) {
        console.warn(`⚠️ Heartbeat update failed for task ${task.id}:`, heartbeatError)
      }
    }, 120000) // 2分钟间隔

    let analysisResult
    try {
      analysisResult = await analyzeThemesWithGemini(
        report.app_name,
        task.reviews_data,
        task.batch_index
      )

      // 清除心跳定时器
      clearInterval(heartbeatInterval)
    } catch (analysisError) {
      // 确保清除心跳定时器
      clearInterval(heartbeatInterval)
      throw analysisError
    }

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

    // 确保任务状态被正确更新，即使在错误情况下
    try {
      const failureStatus = taskStatusUpdated ? 'failed' : 'pending' // 如果状态还没更新为processing，回滚到pending

      await supabaseClient
        .from('analysis_tasks')
        .update({
          status: failureStatus,
          error_message: error.message,
          updated_at: new Date().toISOString()
        })
        .eq('id', task.id)

      console.log(`📝 Task ${task.id} status updated to ${failureStatus} due to error`)
    } catch (updateError) {
      console.error(`❌ Failed to update task status after error:`, updateError)
    }

    // Log failure metric
    await logSystemMetric(supabaseClient, 'task_processing_failures', 1, 'count', {
      task_id: task.id,
      report_id: task.report_id,
      analysis_type: 'themes',
      error: error.message,
      task_status_was_updated: taskStatusUpdated
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
- Return 5-30 themes based on data quality and diversity
- Each theme title must be 2+ words (not single words like "json", "reddit")
- Ensure each theme has 2-3 representative quotes from actual reviews
- Make suggestions specific and actionable, not generic advice
- Consider this is ${platformNames[platform]} specific feedback when creating themes
- NO MARKDOWN FORMATTING - PURE JSON ONLY`

  return prompt
}

// Gemini模型列表，按优先级排序 (基于用户偏好)
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-preview-05-20',
  'gemini-2.5-flash-lite-preview-06-17',
  
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite'
]

// 模型失败跟踪
const modelFailureTracker = new Map<string, { count: number, lastFailure: number }>()

// 估算token数量 (粗略估算: 1 token ≈ 4 characters)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// 计算指数退避延迟
function calculateBackoffDelay(attempt: number, baseDelay: number = 1000): number {
  const delay = baseDelay * Math.pow(2, attempt)
  const jitter = Math.random() * 0.1 * delay // 10% jitter
  return Math.min(delay + jitter, 60000) // 最大60秒
}

// 改进的JSON清理和修复函数
function sanitizeJsonContent(content: string): string {
  let cleanContent = content.trim()

  // 移除markdown格式
  if (cleanContent.startsWith('```json') && cleanContent.endsWith('```')) {
    cleanContent = cleanContent.slice(7, -3).trim()
  } else if (cleanContent.startsWith('```') && cleanContent.endsWith('```')) {
    cleanContent = cleanContent.slice(3, -3).trim()
  }

  // 寻找JSON对象边界
  const jsonStart = cleanContent.indexOf('{')
  let jsonEnd = cleanContent.lastIndexOf('}')

  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    cleanContent = cleanContent.slice(jsonStart, jsonEnd + 1)
  } else if (jsonStart !== -1) {
    // 如果找到开始但没有找到结束，尝试修复
    cleanContent = cleanContent.slice(jsonStart)
    cleanContent = attemptJsonCompletion(cleanContent)
  }

  // 移除前后缀文本
  cleanContent = cleanContent.replace(/^[^{]*/, '').replace(/[^}]*$/, '')

  return cleanContent
}

// 尝试完成截断的JSON
function attemptJsonCompletion(jsonStr: string): string {
  let completed = jsonStr.trim()

  // 计算括号平衡
  let braceCount = 0
  let bracketCount = 0
  let inString = false
  let escapeNext = false

  for (let i = 0; i < completed.length; i++) {
    const char = completed[i]

    if (escapeNext) {
      escapeNext = false
      continue
    }

    if (char === '\\') {
      escapeNext = true
      continue
    }

    if (char === '"' && !escapeNext) {
      inString = !inString
      continue
    }

    if (!inString) {
      if (char === '{') braceCount++
      else if (char === '}') braceCount--
      else if (char === '[') bracketCount++
      else if (char === ']') bracketCount--
    }
  }

  // 如果JSON在字符串中间截断，尝试关闭字符串
  if (inString) {
    completed += '"'
  }

  // 关闭未闭合的数组
  while (bracketCount > 0) {
    completed += ']'
    bracketCount--
  }

  // 关闭未闭合的对象
  while (braceCount > 0) {
    completed += '}'
    braceCount--
  }

  return completed
}

// 修复常见的JSON格式问题
function fixCommonJsonIssues(jsonStr: string): string {
  let fixed = jsonStr

  // 修复缺失的逗号（在对象属性之间）
  fixed = fixed.replace(/}(\s*)"/g, '},$1"')
  fixed = fixed.replace(/](\s*)"/g, '],$1"')
  fixed = fixed.replace(/"(\s*){/g, '",$1{')
  fixed = fixed.replace(/"(\s*)\[/g, '",$1[')

  // 修复数组中缺失的逗号
  fixed = fixed.replace(/}(\s*){/g, '},$1{')
  fixed = fixed.replace(/](\s*)\[/g, '],$1[')

  // 移除多余的逗号
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1')
  fixed = fixed.replace(/,(\s*,)/g, ',')

  // 修复属性名的引号
  fixed = fixed.replace(/([{,]\s*)(\w+):/g, '$1"$2":')

  // 将单引号改为双引号
  fixed = fixed.replace(/:\s*'([^']*)'/g, ': "$1"')

  // 修复转义的单引号
  fixed = fixed.replace(/\\'/g, "'")

  return fixed
}

// 调用Gemini API的通用函数，支持多模型回退和速率限制处理
async function callGeminiAPI(prompt: string) {
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY')

  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set')
  }

  // 检查输入token数量
  const inputTokens = estimateTokens(prompt)
  console.log(`📊 Estimated input tokens: ${inputTokens}`)

  if (inputTokens > 8000) { // 留一些余量给系统提示
    console.warn(`⚠️ Input tokens (${inputTokens}) approaching limit, consider reducing input size`)
  }

  let lastError: Error | null = null
  let globalAttempt = 0

  // 按顺序尝试每个模型
  for (const model of GEMINI_MODELS) {
    // 检查模型是否最近失败过多
    const failureInfo = modelFailureTracker.get(model)
    if (failureInfo && failureInfo.count >= 3 && Date.now() - failureInfo.lastFailure < 300000) { // 5分钟冷却
      console.log(`🚫 Skipping model ${model} due to recent failures (${failureInfo.count} failures)`)
      continue
    }

    let modelAttempt = 0
    const maxModelAttempts = 3

    while (modelAttempt < maxModelAttempts) {
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      try {
        console.log(`🤖 Trying Gemini model: ${model} (attempt ${modelAttempt + 1}/${maxModelAttempts})`)

        // API call with extended timeout for large batches
        const controller = new AbortController()
        timeoutId = setTimeout(() => controller.abort(), 300000) // 5 minute timeout (increased from 2 minutes)

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `You are an expert product analyst specializing in user feedback analysis. You MUST return valid JSON without markdown formatting or additional text. Only return the JSON object with themes array. Do not include any explanatory text before or after the JSON.

IMPORTANT: Return no more than 30 themes even if you receive 100-200 input themes. Focus on the most significant and distinct themes.

${prompt}`
              }]
            }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 4000, // 减少输出token以避免超限
              topP: 0.8,
              topK: 40
            }
          }),
          signal: controller.signal
        })

        if (timeoutId) {
          clearTimeout(timeoutId)
        }

        // 处理速率限制错误
        if (response.status === 429) {
          const errorText = await response.text()
          console.warn(`⚠️ Rate limit hit for model ${model}: ${errorText}`)

          // 尝试从错误响应中提取重试延迟
          let retryDelay = 7000 // 默认7秒
          try {
            const errorData = JSON.parse(errorText)
            if (errorData.error?.details) {
              const retryInfo = errorData.error.details.find((d: any) => d['@type']?.includes('RetryInfo'))
              if (retryInfo?.retryDelay) {
                const delayMatch = retryInfo.retryDelay.match(/(\d+)s/)
                if (delayMatch) {
                  retryDelay = parseInt(delayMatch[1]) * 1000
                }
              }
            }
          } catch (e) {
            // 忽略解析错误，使用默认延迟
          }

          // 计算退避延迟
          const backoffDelay = calculateBackoffDelay(globalAttempt, retryDelay)
          console.log(`⏳ Waiting ${backoffDelay}ms before retry...`)

          await new Promise(resolve => setTimeout(resolve, backoffDelay))
          modelAttempt++
          globalAttempt++
          continue
        }

        if (!response.ok) {
          const errorText = await response.text()
          const error = new Error(`Gemini API error for model ${model}: ${response.status} - ${errorText}`)
          console.warn(`⚠️ Model ${model} failed: ${error.message}`)

          // 记录模型失败
          const currentFailures = modelFailureTracker.get(model) || { count: 0, lastFailure: 0 }
          modelFailureTracker.set(model, {
            count: currentFailures.count + 1,
            lastFailure: Date.now()
          })

          lastError = error
          break // 尝试下一个模型
        }

        const data = await response.json()
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text

        if (!content) {
          const error = new Error(`No content in Gemini response for model ${model}`)
          console.warn(`⚠️ Model ${model} returned no content`)
          lastError = error
          break // 尝试下一个模型
        }

        console.log(`✅ Successfully used model: ${model}`)
        console.log('🔍 Raw Gemini response preview:', content.substring(0, 300) + '...')

        // 重置模型失败计数器（成功获得响应）
        modelFailureTracker.delete(model)

        // 改进的JSON解析逻辑
        try {
          const cleanContent = sanitizeJsonContent(content)
          console.log('🧹 Cleaned content preview:', cleanContent.substring(0, 300) + '...')

          let result: any
          try {
            result = JSON.parse(cleanContent)
          } catch (firstParseError) {
            // 如果第一次解析失败，尝试更激进的清理
            console.warn('🔧 First JSON parse failed, trying aggressive cleanup...')
            console.log('🔍 Full problematic content (first 500 chars):', content.substring(0, 500))

            let aggressiveClean = content.trim()

            // 寻找最可能的JSON边界
            const possibleStarts = ['{', '[']
            let bestStart = -1, bestEnd = -1

            for (const startChar of possibleStarts) {
              const start = aggressiveClean.indexOf(startChar)
              if (start !== -1) {
                const endChar = startChar === '{' ? '}' : ']'
                const end = aggressiveClean.lastIndexOf(endChar)
                if (end > start) {
                  bestStart = start
                  bestEnd = end
                  break
                }
              }
            }

            if (bestStart !== -1 && bestEnd !== -1) {
              aggressiveClean = aggressiveClean.slice(bestStart, bestEnd + 1)

              // 应用修复函数
              aggressiveClean = fixCommonJsonIssues(aggressiveClean)

              try {
                result = JSON.parse(aggressiveClean)
              } catch (secondParseError) {
                // 最后尝试：完成截断的JSON
                console.warn('🔧 Second parse failed, attempting JSON completion...')
                const completedJson = attemptJsonCompletion(aggressiveClean)
                console.log('🔧 Completed JSON preview:', completedJson.substring(0, 300) + '...')
                result = JSON.parse(completedJson)
              }
            } else {
              throw firstParseError
            }
          }

          // 严格验证结构
          if (result.themes && Array.isArray(result.themes) && result.themes.length > 0) {
            // 验证每个theme的结构并过滤无效的
            const validThemes = result.themes.filter((theme: any) => {
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

            // 限制输出主题数量（用户偏好：不超过30个主题）
            const limitedThemes = validThemes.slice(0, 30)

            if (limitedThemes.length > 0) {
              console.log(`✅ Successfully parsed ${limitedThemes.length} valid themes with model ${model} (filtered from ${result.themes.length} total)`)
              return { themes: limitedThemes }
            } else {
              console.warn(`⚠️ No valid themes found after filtering for model ${model}`)
            }
          }

          const error = new Error(`Invalid or empty themes structure in response for model ${model}`)
          console.warn(`⚠️ Model ${model} returned invalid structure`)
          lastError = error
          break // 尝试下一个模型

        } catch (parseError) {
          console.error(`❌ JSON parsing failed for model ${model}:`, parseError.message)
          console.log('🔍 Full problematic content (first 500 chars):', content.substring(0, 500))

          const error = new Error(`Gemini model ${model} returned invalid JSON format: ${parseError.message}. Content preview: ${content.substring(0, 200)}...`)
          lastError = error
          break // 尝试下一个模型
        }

      } catch (error) {
        if (timeoutId) {
          clearTimeout(timeoutId)
        }

        if (error.name === 'AbortError') {
          const timeoutError = new Error(`Model ${model} timed out after 2 minutes`)
          console.warn(`⚠️ ${timeoutError.message}`)
          lastError = timeoutError
          break // 尝试下一个模型
        }

        console.warn(`⚠️ Model ${model} failed with error:`, error.message)

        // 记录模型失败
        const currentFailures = modelFailureTracker.get(model) || { count: 0, lastFailure: 0 }
        modelFailureTracker.set(model, {
          count: currentFailures.count + 1,
          lastFailure: Date.now()
        })

        lastError = error

        // 如果是最后一次尝试，跳出到下一个模型
        if (modelAttempt >= maxModelAttempts - 1) {
          break
        }
      }

      modelAttempt++
      if (modelAttempt < maxModelAttempts) {
        const delay = calculateBackoffDelay(modelAttempt - 1, 1000)
        console.log(`⏳ Retrying model ${model} in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  // 如果所有模型都失败了，提供更详细的错误信息
  const failureReport = Array.from(modelFailureTracker.entries())
    .map(([model, info]) => `${model}: ${info.count} failures`)
    .join(', ')

  throw new Error(`All Gemini models failed after multiple attempts. Model failures: ${failureReport}. Last error: ${lastError?.message || 'Unknown error'}`)
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