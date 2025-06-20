import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface StartAnalysisRequest {
  reportId: string
  appName: string
  scrapingSessionId: string
  scrapedDataSummary: {
    totalReviews: number
    appStoreCount: number
    googlePlayCount: number
    redditCount: number
  }
}

// 设置平台评论上限
const PLATFORM_LIMITS = {
  APP_STORE_LIMIT: 4000,
  GOOGLE_PLAY_LIMIT: 4000,
  REDDIT_LIMIT: 1000 // Reddit 保持较低限制，因为帖子通常更长
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

    const { reportId, appName, scrapingSessionId, scrapedDataSummary }: StartAnalysisRequest = await req.json()

    if (!reportId || !appName || !scrapingSessionId) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log(`🧠 Starting AI analysis for report ${reportId}, app: ${appName}`)
    console.log(`📊 Data summary:`, scrapedDataSummary)
    console.log(`🎯 Platform limits: App Store=${PLATFORM_LIMITS.APP_STORE_LIMIT}, Google Play=${PLATFORM_LIMITS.GOOGLE_PLAY_LIMIT}, Reddit=${PLATFORM_LIMITS.REDDIT_LIMIT}`)

    // Start the analysis process in the background
    EdgeRuntime.waitUntil(performAnalysis(reportId, appName, scrapingSessionId, supabaseClient, scrapedDataSummary))

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Analysis started',
        reportId,
        scrapingSessionId
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error in start-analysis:', error)
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

async function performAnalysis(
  reportId: string, 
  appName: string, 
  scrapingSessionId: string, 
  supabaseClient: any,
  scrapedDataSummary: any
) {
  try {
    console.log(`🔍 Starting analysis process for ${appName}`)

    // Check if we have any data to analyze
    if (scrapedDataSummary.totalReviews === 0) {
      console.log('No reviews found, creating empty report')
      await createEmptyReport(reportId, appName, supabaseClient)
    } else {
      // Fetch ALL scraped reviews from database using pagination with platform limits
      console.log(`📥 Fetching reviews from database with platform limits...`)
      const scrapedData = await fetchScrapedReviewsWithLimits(scrapingSessionId, supabaseClient)
      
      console.log(`🧠 Starting AI analysis with batch processing for ${scrapedData.totalReviews} reviews...`)
      const analysisResult = await analyzeWithDeepSeekBatch(appName, scrapedData)
      
      console.log('💾 Saving analysis results...')
      await saveAnalysisResults(reportId, analysisResult, supabaseClient)
    }
    
    // Update report status to completed
    await supabaseClient
      .from('reports')
      .update({ 
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', reportId)

    console.log(`✅ Analysis completed for ${appName} (${reportId})`)

  } catch (error) {
    console.error(`❌ Error in analysis process for ${reportId}:`, error)
    
    // Update report status to error
    await supabaseClient
      .from('reports')
      .update({ status: 'error' })
      .eq('id', reportId)
  }
}

// Fetch scraped reviews with platform-specific limits
async function fetchScrapedReviewsWithLimits(scrapingSessionId: string, supabaseClient: any) {
  console.log(`📥 Fetching reviews for scraping session ${scrapingSessionId} with platform limits...`)
  
  const scrapedData = {
    appStore: [],
    googlePlay: [],
    reddit: [],
    totalReviews: 0
  }

  // Fetch App Store reviews (limit: 4000)
  console.log(`📱 Fetching App Store reviews (limit: ${PLATFORM_LIMITS.APP_STORE_LIMIT})...`)
  const { data: appStoreReviews, error: appStoreError } = await supabaseClient
    .from('scraped_reviews')
    .select('*')
    .eq('scraping_session_id', scrapingSessionId)
    .eq('platform', 'app_store')
    .order('created_at', { ascending: false })
    .limit(PLATFORM_LIMITS.APP_STORE_LIMIT)

  if (appStoreError) {
    console.error('Error fetching App Store reviews:', appStoreError)
  } else {
    scrapedData.appStore = appStoreReviews || []
    console.log(`✅ Fetched ${scrapedData.appStore.length} App Store reviews`)
  }

  // Fetch Google Play reviews (limit: 4000)
  console.log(`🤖 Fetching Google Play reviews (limit: ${PLATFORM_LIMITS.GOOGLE_PLAY_LIMIT})...`)
  const { data: googlePlayReviews, error: googlePlayError } = await supabaseClient
    .from('scraped_reviews')
    .select('*')
    .eq('scraping_session_id', scrapingSessionId)
    .eq('platform', 'google_play')
    .order('created_at', { ascending: false })
    .limit(PLATFORM_LIMITS.GOOGLE_PLAY_LIMIT)

  if (googlePlayError) {
    console.error('Error fetching Google Play reviews:', googlePlayError)
  } else {
    scrapedData.googlePlay = googlePlayReviews || []
    console.log(`✅ Fetched ${scrapedData.googlePlay.length} Google Play reviews`)
  }

  // Fetch Reddit posts (limit: 1000)
  console.log(`💬 Fetching Reddit posts (limit: ${PLATFORM_LIMITS.REDDIT_LIMIT})...`)
  const { data: redditPosts, error: redditError } = await supabaseClient
    .from('scraped_reviews')
    .select('*')
    .eq('scraping_session_id', scrapingSessionId)
    .eq('platform', 'reddit')
    .order('created_at', { ascending: false })
    .limit(PLATFORM_LIMITS.REDDIT_LIMIT)

  if (redditError) {
    console.error('Error fetching Reddit posts:', redditError)
  } else {
    scrapedData.reddit = redditPosts || []
    console.log(`✅ Fetched ${scrapedData.reddit.length} Reddit posts`)
  }

  scrapedData.totalReviews = scrapedData.appStore.length + scrapedData.googlePlay.length + scrapedData.reddit.length

  console.log(`📊 Fetched reviews with platform limits: ${scrapedData.totalReviews} total`)
  console.log(`   - App Store: ${scrapedData.appStore.length}/${PLATFORM_LIMITS.APP_STORE_LIMIT} reviews`)
  console.log(`   - Google Play: ${scrapedData.googlePlay.length}/${PLATFORM_LIMITS.GOOGLE_PLAY_LIMIT} reviews`)
  console.log(`   - Reddit: ${scrapedData.reddit.length}/${PLATFORM_LIMITS.REDDIT_LIMIT} posts`)
  
  return scrapedData
}

async function createEmptyReport(reportId: string, appName: string, supabaseClient: any) {
  // Create a theme explaining no data was found
  const { data: themeData, error: themeError } = await supabaseClient
    .from('themes')
    .insert({
      report_id: reportId,
      title: "No Reviews Found",
      description: `Unable to find sufficient user reviews for ${appName}. This could be due to the app being new, having limited reviews, or platform restrictions. Try checking the app name spelling or search for the app manually on different platforms.`
    })
    .select()
    .single()

  if (!themeError && themeData) {
    // Add suggestions for when no data is found
    const suggestions = [
      "Verify the app name is spelled correctly",
      "Check if the app is available in your region",
      "Try searching for the app manually on App Store and Google Play",
      "The app might be new and have limited reviews",
      "Consider checking social media platforms for user discussions"
    ]

    for (const suggestion of suggestions) {
      await supabaseClient
        .from('suggestions')
        .insert({
          theme_id: themeData.id,
          text: suggestion
        })
    }
  }
}

// 🚀 Optimized Batch Analysis with DeepSeek - Process reviews with platform limits
async function analyzeWithDeepSeekBatch(appName: string, scrapedData: any) {
  console.log(`🧠 Starting comprehensive batch analysis for ${appName}`)
  
  // Combine reviews from all platforms with platform limits applied
  const allReviews = [
    ...scrapedData.appStore.map((r: any) => `[App Store] ${r.review_text}`),
    ...scrapedData.googlePlay.map((r: any) => `[Google Play] ${r.review_text}`),
    ...scrapedData.reddit.map((r: any) => `[Reddit] ${r.review_text}`)
  ]

  if (allReviews.length === 0) {
    throw new Error('No reviews available for analysis')
  }

  console.log(`📊 Total reviews to analyze: ${allReviews.length} (with platform limits applied)`)
  console.log(`   - App Store: ${scrapedData.appStore.length} reviews (limit: ${PLATFORM_LIMITS.APP_STORE_LIMIT})`)
  console.log(`   - Google Play: ${scrapedData.googlePlay.length} reviews (limit: ${PLATFORM_LIMITS.GOOGLE_PLAY_LIMIT})`)
  console.log(`   - Reddit: ${scrapedData.reddit.length} posts (limit: ${PLATFORM_LIMITS.REDDIT_LIMIT})`)

  // 🔄 Step 1: Split reviews into smaller batches to avoid token limits and timeouts
  const BATCH_SIZE = 400 // Smaller batch size to stay well within DeepSeek's token limits
  const batches = []
  
  for (let i = 0; i < allReviews.length; i += BATCH_SIZE) {
    batches.push(allReviews.slice(i, i + BATCH_SIZE))
  }

  console.log(`📦 Split ${allReviews.length} reviews into ${batches.length} batches (${BATCH_SIZE} reviews per batch)`)

  // 🔄 Step 2: Analyze each batch separately with shorter delays
  const batchResults = []
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    console.log(`🔍 Analyzing batch ${i + 1}/${batches.length} (${batch.length} reviews)`)
    
    try {
      const batchResult = await analyzeBatchWithDeepSeek(appName, batch, i + 1, batches.length)
      batchResults.push(batchResult)
      
      // Shorter delay to reduce total processing time
      if (i < batches.length - 1) {
        console.log(`⏳ Waiting 1 second before next batch...`)
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    } catch (error) {
      console.error(`❌ Error analyzing batch ${i + 1}:`, error.message)
      // Continue processing other batches
      batchResults.push({
        themes: [],
        batchNumber: i + 1,
        error: error.message
      })
    }
  }

  console.log(`✅ Completed analysis of ${batchResults.length} batches`)

  // 🔄 Step 3: Merge and deduplicate results
  const mergedResult = await mergeAndDeduplicateResults(appName, batchResults)
  
  console.log(`🎯 Final result: ${mergedResult.themes.length} unique themes from ${allReviews.length} reviews (platform limits applied)`)
  
  return mergedResult
}

// 分析单个批次 - 优化token使用
async function analyzeBatchWithDeepSeek(appName: string, reviews: string[], batchNumber: number, totalBatches: number) {
  const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY')
  
  if (!deepseekApiKey) {
    throw new Error('DEEPSEEK_API_KEY environment variable is not set')
  }

  // Truncate very long reviews to save tokens
  const truncatedReviews = reviews.map(review => 
    review.length > 500 ? review.substring(0, 500) + '...' : review
  )

  const prompt = `
You are an expert product analyst. Analyze the following user reviews for the app "${appName}".

This is batch ${batchNumber} of ${totalBatches} total batches.

Your task:
1. Identify the TOP 10-12 most important themes from this batch of reviews
2. For each theme, provide 2 representative quotes from actual reviews
3. Generate 2 specific, actionable product suggestions for each theme

Focus on themes that are:
- Mentioned by multiple users in this batch
- Have clear sentiment (positive or negative)
- Actionable for product teams
- Specific to user experience, features, or pain points

Reviews to analyze (${truncatedReviews.length} total):
${truncatedReviews.join('\n\n')}

IMPORTANT: Respond with ONLY valid JSON in English, no markdown formatting, no code blocks, no additional text.

{
  "batchNumber": ${batchNumber},
  "totalBatches": ${totalBatches},
  "reviewsAnalyzed": ${truncatedReviews.length},
  "themes": [
    {
      "title": "Clear, specific theme title (2-6 words)",
      "description": "Detailed description explaining what users are saying about this theme (2-3 sentences)",
      "quotes": [
        {
          "text": "Exact quote from a review (keep original wording)",
          "source": "App Store|Google Play|Reddit",
          "date": "2025-01-10"
        }
      ],
      "suggestions": [
        "Specific, actionable suggestion for the product team",
        "Another concrete recommendation"
      ],
      "frequency": "high|medium|low",
      "sentiment": "positive|negative|mixed"
    }
  ]
}
`

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
            content: `You are an expert product analyst specializing in user feedback analysis. Always respond with valid JSON only in English, no markdown formatting, no code blocks, no additional text. Focus on finding 10-12 distinct themes per batch.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 6000 // Reduced to stay well within limits
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`)
    }

    const result = await response.json()
    let content = result.choices[0].message.content

    // Clean up the response
    content = content.trim()
    if (content.startsWith('```json')) {
      content = content.replace(/^```json\s*/, '')
    }
    if (content.startsWith('```')) {
      content = content.replace(/^```\s*/, '')
    }
    if (content.endsWith('```')) {
      content = content.replace(/\s*```$/, '')
    }
    content = content.trim()

    const batchResult = JSON.parse(content)
    
    // Validate structure
    if (!batchResult.themes || !Array.isArray(batchResult.themes)) {
      throw new Error('Invalid batch result structure - missing themes array')
    }

    console.log(`✅ Batch ${batchNumber}: Found ${batchResult.themes.length} themes`)
    return batchResult

  } catch (error) {
    console.error(`❌ Error analyzing batch ${batchNumber}:`, error.message)
    throw error
  }
}

// 合并和去重结果 - 优化处理
async function mergeAndDeduplicateResults(appName: string, batchResults: any[]) {
  console.log(`🔄 Merging results from ${batchResults.length} batches...`)
  
  // 收集所有主题
  const allThemes = []
  for (const batchResult of batchResults) {
    if (batchResult.themes && Array.isArray(batchResult.themes)) {
      allThemes.push(...batchResult.themes)
    }
  }

  console.log(`📊 Total themes before deduplication: ${allThemes.length}`)

  if (allThemes.length === 0) {
    return {
      themes: [{
        title: "Analysis Error",
        description: "Unable to complete AI analysis due to technical issues. The reviews have been collected and saved for manual review.",
        quotes: [],
        suggestions: [
          "Review the collected user feedback manually",
          "Check system logs for analysis errors",
          "Consider retrying the analysis later"
        ]
      }]
    }
  }

  // 使用DeepSeek进行智能合并和去重，但限制输入大小
  try {
    const mergedResult = await intelligentMergeWithDeepSeek(appName, allThemes)
    return mergedResult
  } catch (error) {
    console.error('❌ Error in intelligent merge:', error.message)
    console.log('🔄 Falling back to simple deduplication...')
    return simpleDeduplication(allThemes)
  }
}

// 使用DeepSeek进行智能合并 - 优化token使用
async function intelligentMergeWithDeepSeek(appName: string, allThemes: any[]) {
  const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY')
  
  if (!deepseekApiKey) {
    throw new Error('DEEPSEEK_API_KEY environment variable is not set')
  }

  console.log(`🧠 Using DeepSeek to merge and deduplicate ${allThemes.length} themes...`)

  // 如果主题太多，先进行预处理
  let themesToProcess = allThemes
  if (allThemes.length > 60) {
    console.log(`⚠️ Too many themes (${allThemes.length}), pre-processing to reduce size...`)
    themesToProcess = await preProcessThemes(allThemes)
    console.log(`📊 Pre-processed to ${themesToProcess.length} themes`)
  }

  // 进一步限制输入大小以避免token限制
  const limitedThemes = themesToProcess.slice(0, 50)
  
  // 简化主题数据以减少token使用
  const simplifiedThemes = limitedThemes.map(theme => ({
    title: theme.title,
    description: theme.description.substring(0, 200), // 限制描述长度
    quotes: theme.quotes ? theme.quotes.slice(0, 2) : [], // 最多2个引用
    suggestions: theme.suggestions ? theme.suggestions.slice(0, 2) : [] // 最多2个建议
  }))

  const prompt = `
You are an expert product analyst. Merge and deduplicate these themes for the app "${appName}".

Your task:
1. Merge similar themes together
2. Remove duplicates
3. Return the TOP 25 most important themes
4. Prioritize by user impact and frequency

Input themes (${simplifiedThemes.length} total):
${JSON.stringify(simplifiedThemes, null, 1)}

IMPORTANT: Respond with ONLY valid JSON in English, no markdown formatting, no code blocks.

{
  "themes": [
    {
      "title": "Clear theme title (2-6 words)",
      "description": "Description (2-3 sentences)",
      "quotes": [
        {
          "text": "Quote from review",
          "source": "App Store|Google Play|Reddit",
          "date": "2025-01-10"
        }
      ],
      "suggestions": [
        "Actionable suggestion",
        "Another suggestion"
      ]
    }
  ]
}

Return exactly 25 themes ranked by importance.
`

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
            content: 'You are an expert product analyst. Always respond with valid JSON only. Return exactly 25 consolidated themes.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.2,
        max_tokens: 6000 // Reduced to stay within limits
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`DeepSeek merge API error: ${response.status} - ${errorText}`)
    }

    const result = await response.json()
    let content = result.choices[0].message.content

    // Clean up the response
    content = content.trim()
    if (content.startsWith('```json')) {
      content = content.replace(/^```json\s*/, '')
    }
    if (content.startsWith('```')) {
      content = content.replace(/^```\s*/, '')
    }
    if (content.endsWith('```')) {
      content = content.replace(/\s*```$/, '')
    }
    content = content.trim()

    const mergedResult = JSON.parse(content)
    
    // Validate structure
    if (!mergedResult.themes || !Array.isArray(mergedResult.themes)) {
      throw new Error('Invalid merged result structure - missing themes array')
    }

    // Ensure we have up to 25 themes
    if (mergedResult.themes.length > 25) {
      console.log(`⚠️ Trimming to 25 themes (received ${mergedResult.themes.length})`)
      mergedResult.themes = mergedResult.themes.slice(0, 25)
    }

    console.log(`✅ Successfully merged to ${mergedResult.themes.length} final themes`)
    return mergedResult

  } catch (error) {
    console.error('❌ Error in intelligent merge:', error.message)
    throw error
  }
}

// 预处理主题（当主题数量过多时）
async function preProcessThemes(allThemes: any[]) {
  // 按标题相似度分组，每组只保留最好的代表
  const groups = new Map()
  
  for (const theme of allThemes) {
    const normalizedTitle = theme.title.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    
    // 使用前8个字符作为分组键
    const key = normalizedTitle.substring(0, 8)
    
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key).push(theme)
  }
  
  // 从每组中选择最好的主题
  const processedThemes = []
  for (const [key, groupThemes] of groups) {
    // 选择描述最长且有引用的主题作为代表
    const bestTheme = groupThemes.reduce((best, current) => {
      const currentScore = current.description.length + (current.quotes?.length || 0) * 50
      const bestScore = best.description.length + (best.quotes?.length || 0) * 50
      return currentScore > bestScore ? current : best
    })
    processedThemes.push(bestTheme)
  }
  
  return processedThemes.slice(0, 50) // 最多50个主题
}

// 简单去重（备用方案）
function simpleDeduplication(allThemes: any[]) {
  const uniqueThemes = []
  const seenTitles = new Set()

  for (const theme of allThemes) {
    const normalizedTitle = theme.title.toLowerCase().trim()
    
    if (!seenTitles.has(normalizedTitle)) {
      seenTitles.add(normalizedTitle)
      uniqueThemes.push(theme)
    }
  }

  // Limit to 25 themes
  const finalThemes = uniqueThemes.slice(0, 25)
  
  console.log(`📊 Simple deduplication: ${allThemes.length} → ${finalThemes.length} themes`)
  
  return { themes: finalThemes }
}

async function saveAnalysisResults(reportId: string, analysisResult: any, supabaseClient: any) {
  try {
    // Save each theme and its associated quotes and suggestions
    for (const theme of analysisResult.themes) {
      // Create theme
      const { data: themeData, error: themeError } = await supabaseClient
        .from('themes')
        .insert({
          report_id: reportId,
          title: theme.title,
          description: theme.description
        })
        .select()
        .single()

      if (themeError) {
        console.error('Error creating theme:', themeError)
        continue
      }

      // Create quotes for this theme
      if (theme.quotes && theme.quotes.length > 0) {
        for (const quote of theme.quotes) {
          await supabaseClient
            .from('quotes')
            .insert({
              theme_id: themeData.id,
              text: quote.text,
              source: quote.source,
              review_date: quote.date
            })
        }
      }

      // Create suggestions for this theme
      if (theme.suggestions && theme.suggestions.length > 0) {
        for (const suggestion of theme.suggestions) {
          await supabaseClient
            .from('suggestions')
            .insert({
              theme_id: themeData.id,
              text: suggestion
            })
        }
      }
    }

    console.log(`Successfully saved analysis results for report ${reportId}`)
  } catch (error) {
    console.error('Error saving analysis results:', error)
    throw error
  }
}