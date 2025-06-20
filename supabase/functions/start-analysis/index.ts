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

// 优化的平台评论上限
const PLATFORM_LIMITS = {
  APP_STORE_LIMIT: 4000,
  GOOGLE_PLAY_LIMIT: 4000,
  REDDIT_LIMIT: 1000
}

// 优化的批处理配置
const BATCH_CONFIG = {
  BATCH_SIZE: 300, // 减少到300个评论每批，确保不超过token限制
  MAX_BATCHES_PER_RUN: 8, // 每次运行最多处理8个批次，避免超时
  BATCH_DELAY: 500, // 减少批次间延迟到500ms
  MAX_TOKENS_PER_BATCH: 4000, // 每批最大token数
  MAX_PROCESSING_TIME: 4 * 60 * 1000 // 4分钟最大处理时间
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

    console.log(`🧠 Starting optimized AI analysis for report ${reportId}, app: ${appName}`)
    console.log(`📊 Data summary:`, scrapedDataSummary)
    console.log(`🎯 Platform limits: App Store=${PLATFORM_LIMITS.APP_STORE_LIMIT}, Google Play=${PLATFORM_LIMITS.GOOGLE_PLAY_LIMIT}, Reddit=${PLATFORM_LIMITS.REDDIT_LIMIT}`)
    console.log(`⚡ Batch config: Size=${BATCH_CONFIG.BATCH_SIZE}, MaxBatches=${BATCH_CONFIG.MAX_BATCHES_PER_RUN}, Delay=${BATCH_CONFIG.BATCH_DELAY}ms`)

    // Start the analysis process in the background
    EdgeRuntime.waitUntil(performOptimizedAnalysis(reportId, appName, scrapingSessionId, supabaseClient, scrapedDataSummary))

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Optimized analysis started',
        reportId,
        scrapingSessionId,
        batchConfig: BATCH_CONFIG
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

async function performOptimizedAnalysis(
  reportId: string, 
  appName: string, 
  scrapingSessionId: string, 
  supabaseClient: any,
  scrapedDataSummary: any
) {
  const startTime = Date.now()
  
  try {
    console.log(`🔍 Starting optimized analysis process for ${appName}`)

    // Check if we have any data to analyze
    if (scrapedDataSummary.totalReviews === 0) {
      console.log('No reviews found, creating empty report')
      await createEmptyReport(reportId, appName, supabaseClient)
    } else {
      // Fetch reviews with proper limits and pagination
      console.log(`📥 Fetching reviews from database with optimized limits...`)
      const scrapedData = await fetchScrapedReviewsOptimized(scrapingSessionId, supabaseClient)
      
      if (scrapedData.totalReviews === 0) {
        console.log('⚠️ No reviews found in database, creating empty report')
        await createEmptyReport(reportId, appName, supabaseClient)
      } else {
        console.log(`🧠 Starting optimized AI analysis with ${scrapedData.totalReviews} reviews...`)
        
        // Check if we need to process in chunks due to time constraints
        const estimatedProcessingTime = estimateProcessingTime(scrapedData.totalReviews)
        console.log(`⏱️ Estimated processing time: ${Math.round(estimatedProcessingTime / 1000)}s`)
        
        if (estimatedProcessingTime > BATCH_CONFIG.MAX_PROCESSING_TIME) {
          console.log(`⚠️ Large dataset detected, using chunked processing approach`)
          await processInChunks(reportId, appName, scrapedData, supabaseClient)
        } else {
          console.log(`✅ Dataset size manageable, using standard batch processing`)
          const analysisResult = await analyzeWithOptimizedBatching(appName, scrapedData)
          await saveAnalysisResults(reportId, analysisResult, supabaseClient)
        }
      }
    }
    
    // Update report status to completed
    await supabaseClient
      .from('reports')
      .update({ 
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', reportId)

    const totalTime = Date.now() - startTime
    console.log(`✅ Optimized analysis completed for ${appName} (${reportId}) in ${Math.round(totalTime / 1000)}s`)

  } catch (error) {
    console.error(`❌ Error in optimized analysis process for ${reportId}:`, error)
    
    // Update report status to error
    await supabaseClient
      .from('reports')
      .update({ status: 'error' })
      .eq('id', reportId)
  }
}

// 优化的数据获取函数 - 修复limit问题
async function fetchScrapedReviewsOptimized(scrapingSessionId: string, supabaseClient: any) {
  console.log(`📥 Fetching reviews for scraping session ${scrapingSessionId} with optimized queries...`)
  
  const scrapedData = {
    appStore: [],
    googlePlay: [],
    reddit: [],
    totalReviews: 0
  }

  try {
    // 首先检查总数
    const { count: totalCount, error: countError } = await supabaseClient
      .from('scraped_reviews')
      .select('*', { count: 'exact', head: true })
      .eq('scraping_session_id', scrapingSessionId)

    if (countError) {
      console.error('Error getting total count:', countError)
    } else {
      console.log(`📊 Total reviews in database for session: ${totalCount}`)
    }

    // Fetch App Store reviews with explicit ordering and limit
    console.log(`📱 Fetching App Store reviews (limit: ${PLATFORM_LIMITS.APP_STORE_LIMIT})...`)
    const { data: appStoreReviews, error: appStoreError } = await supabaseClient
      .from('scraped_reviews')
      .select('review_text, rating, review_date, author_name, source_url, additional_data')
      .eq('scraping_session_id', scrapingSessionId)
      .eq('platform', 'app_store')
      .order('created_at', { ascending: false })
      .limit(PLATFORM_LIMITS.APP_STORE_LIMIT)

    if (appStoreError) {
      console.error('❌ Error fetching App Store reviews:', appStoreError)
    } else {
      scrapedData.appStore = appStoreReviews || []
      console.log(`✅ Fetched ${scrapedData.appStore.length} App Store reviews (requested limit: ${PLATFORM_LIMITS.APP_STORE_LIMIT})`)
    }

    // Fetch Google Play reviews with explicit ordering and limit
    console.log(`🤖 Fetching Google Play reviews (limit: ${PLATFORM_LIMITS.GOOGLE_PLAY_LIMIT})...`)
    const { data: googlePlayReviews, error: googlePlayError } = await supabaseClient
      .from('scraped_reviews')
      .select('review_text, rating, review_date, author_name, source_url, additional_data')
      .eq('scraping_session_id', scrapingSessionId)
      .eq('platform', 'google_play')
      .order('created_at', { ascending: false })
      .limit(PLATFORM_LIMITS.GOOGLE_PLAY_LIMIT)

    if (googlePlayError) {
      console.error('❌ Error fetching Google Play reviews:', googlePlayError)
    } else {
      scrapedData.googlePlay = googlePlayReviews || []
      console.log(`✅ Fetched ${scrapedData.googlePlay.length} Google Play reviews (requested limit: ${PLATFORM_LIMITS.GOOGLE_PLAY_LIMIT})`)
    }

    // Fetch Reddit posts with explicit ordering and limit
    console.log(`💬 Fetching Reddit posts (limit: ${PLATFORM_LIMITS.REDDIT_LIMIT})...`)
    const { data: redditPosts, error: redditError } = await supabaseClient
      .from('scraped_reviews')
      .select('review_text, rating, review_date, author_name, source_url, additional_data')
      .eq('scraping_session_id', scrapingSessionId)
      .eq('platform', 'reddit')
      .order('created_at', { ascending: false })
      .limit(PLATFORM_LIMITS.REDDIT_LIMIT)

    if (redditError) {
      console.error('❌ Error fetching Reddit posts:', redditError)
    } else {
      scrapedData.reddit = redditPosts || []
      console.log(`✅ Fetched ${scrapedData.reddit.length} Reddit posts (requested limit: ${PLATFORM_LIMITS.REDDIT_LIMIT})`)
    }

    scrapedData.totalReviews = scrapedData.appStore.length + scrapedData.googlePlay.length + scrapedData.reddit.length

    console.log(`📊 Final fetched counts with optimized queries: ${scrapedData.totalReviews} total`)
    console.log(`   - App Store: ${scrapedData.appStore.length}/${PLATFORM_LIMITS.APP_STORE_LIMIT} reviews`)
    console.log(`   - Google Play: ${scrapedData.googlePlay.length}/${PLATFORM_LIMITS.GOOGLE_PLAY_LIMIT} reviews`)
    console.log(`   - Reddit: ${scrapedData.reddit.length}/${PLATFORM_LIMITS.REDDIT_LIMIT} posts`)
    
    return scrapedData

  } catch (error) {
    console.error('❌ Critical error in fetchScrapedReviewsOptimized:', error)
    return scrapedData
  }
}

// 估算处理时间
function estimateProcessingTime(totalReviews: number): number {
  // 基于经验：每个batch大约需要15-20秒，每个batch 300个评论
  const estimatedBatches = Math.ceil(totalReviews / BATCH_CONFIG.BATCH_SIZE)
  const estimatedTimePerBatch = 18000 // 18秒每批
  const estimatedDelay = estimatedBatches * BATCH_CONFIG.BATCH_DELAY
  return estimatedBatches * estimatedTimePerBatch + estimatedDelay
}

// 分块处理大数据集
async function processInChunks(reportId: string, appName: string, scrapedData: any, supabaseClient: any) {
  console.log(`🔄 Processing large dataset in chunks to avoid timeout`)
  
  // 只处理前面的数据以确保在时间限制内完成
  const maxReviewsPerRun = BATCH_CONFIG.MAX_BATCHES_PER_RUN * BATCH_CONFIG.BATCH_SIZE
  
  const limitedData = {
    appStore: scrapedData.appStore.slice(0, Math.min(scrapedData.appStore.length, maxReviewsPerRun * 0.5)),
    googlePlay: scrapedData.googlePlay.slice(0, Math.min(scrapedData.googlePlay.length, maxReviewsPerRun * 0.4)),
    reddit: scrapedData.reddit.slice(0, Math.min(scrapedData.reddit.length, maxReviewsPerRun * 0.1)),
    totalReviews: 0
  }
  
  limitedData.totalReviews = limitedData.appStore.length + limitedData.googlePlay.length + limitedData.reddit.length
  
  console.log(`📊 Processing limited dataset: ${limitedData.totalReviews} reviews (from ${scrapedData.totalReviews} total)`)
  console.log(`   - App Store: ${limitedData.appStore.length} reviews`)
  console.log(`   - Google Play: ${limitedData.googlePlay.length} reviews`)
  console.log(`   - Reddit: ${limitedData.reddit.length} posts`)
  
  const analysisResult = await analyzeWithOptimizedBatching(appName, limitedData)
  await saveAnalysisResults(reportId, analysisResult, supabaseClient)
}

// 优化的批处理分析
async function analyzeWithOptimizedBatching(appName: string, scrapedData: any) {
  console.log(`🧠 Starting optimized batch analysis for ${appName}`)
  
  // Combine reviews from all platforms
  const allReviews = [
    ...scrapedData.appStore.map((r: any) => `[App Store] ${r.review_text}`),
    ...scrapedData.googlePlay.map((r: any) => `[Google Play] ${r.review_text}`),
    ...scrapedData.reddit.map((r: any) => `[Reddit] ${r.review_text}`)
  ]

  if (allReviews.length === 0) {
    throw new Error('No reviews available for analysis')
  }

  console.log(`📊 Total reviews to analyze: ${allReviews.length} (optimized batching)`)

  // 🔄 Step 1: Split into optimized batches
  const batches = []
  for (let i = 0; i < allReviews.length; i += BATCH_CONFIG.BATCH_SIZE) {
    batches.push(allReviews.slice(i, i + BATCH_CONFIG.BATCH_SIZE))
  }

  // 限制批次数量以避免超时
  const limitedBatches = batches.slice(0, BATCH_CONFIG.MAX_BATCHES_PER_RUN)
  
  console.log(`📦 Split ${allReviews.length} reviews into ${limitedBatches.length} batches (${BATCH_CONFIG.BATCH_SIZE} reviews per batch, max ${BATCH_CONFIG.MAX_BATCHES_PER_RUN} batches)`)

  // 🔄 Step 2: Process batches with optimized timing
  const batchResults = []
  const startTime = Date.now()
  
  for (let i = 0; i < limitedBatches.length; i++) {
    const batch = limitedBatches[i]
    const batchStartTime = Date.now()
    
    console.log(`🔍 Analyzing batch ${i + 1}/${limitedBatches.length} (${batch.length} reviews)`)
    
    try {
      const batchResult = await analyzeBatchOptimized(appName, batch, i + 1, limitedBatches.length)
      batchResults.push(batchResult)
      
      const batchTime = Date.now() - batchStartTime
      console.log(`✅ Batch ${i + 1}: Found ${batchResult.themes?.length || 0} themes in ${Math.round(batchTime / 1000)}s`)
      
      // 检查总时间，如果接近限制则停止
      const totalElapsed = Date.now() - startTime
      if (totalElapsed > BATCH_CONFIG.MAX_PROCESSING_TIME * 0.8) {
        console.log(`⚠️ Approaching time limit (${Math.round(totalElapsed / 1000)}s), stopping at batch ${i + 1}`)
        break
      }
      
      // 优化的延迟
      if (i < limitedBatches.length - 1) {
        console.log(`⏳ Waiting ${BATCH_CONFIG.BATCH_DELAY}ms before next batch...`)
        await new Promise(resolve => setTimeout(resolve, BATCH_CONFIG.BATCH_DELAY))
      }
      
    } catch (error) {
      console.error(`❌ Error analyzing batch ${i + 1}:`, error.message)
      batchResults.push({
        themes: [],
        batchNumber: i + 1,
        error: error.message
      })
    }
  }

  console.log(`✅ Completed analysis of ${batchResults.length} batches`)

  // 🔄 Step 3: Quick merge and deduplicate
  const mergedResult = await quickMergeResults(appName, batchResults)
  
  console.log(`🎯 Final result: ${mergedResult.themes.length} unique themes`)
  
  return mergedResult
}

// 优化的单批次分析
async function analyzeBatchOptimized(appName: string, reviews: string[], batchNumber: number, totalBatches: number) {
  const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY')
  
  if (!deepseekApiKey) {
    throw new Error('DEEPSEEK_API_KEY environment variable is not set')
  }

  // 更激进的文本截断以节省tokens
  const truncatedReviews = reviews.map(review => {
    if (review.length > 300) {
      return review.substring(0, 300) + '...'
    }
    return review
  })

  // 简化的prompt以减少token使用
  const prompt = `Analyze user reviews for "${appName}". Find 8-10 key themes.

Reviews (${truncatedReviews.length}):
${truncatedReviews.join('\n\n')}

Return JSON only:
{
  "themes": [
    {
      "title": "Theme title (2-4 words)",
      "description": "Brief description (1-2 sentences)",
      "quotes": [{"text": "Quote", "source": "App Store", "date": "2025-01-10"}],
      "suggestions": ["Suggestion 1", "Suggestion 2"]
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
            content: 'You are a product analyst. Return only valid JSON with 8-10 themes.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 3000 // 进一步减少token限制
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`)
    }

    const result = await response.json()
    let content = result.choices[0].message.content.trim()

    // 清理响应
    content = content.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim()

    const batchResult = JSON.parse(content)
    
    if (!batchResult.themes || !Array.isArray(batchResult.themes)) {
      throw new Error('Invalid batch result structure')
    }

    return batchResult

  } catch (error) {
    console.error(`❌ Error analyzing batch ${batchNumber}:`, error.message)
    throw error
  }
}

// 快速合并结果（避免复杂的DeepSeek调用）
async function quickMergeResults(appName: string, batchResults: any[]) {
  console.log(`🔄 Quick merging results from ${batchResults.length} batches...`)
  
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
        description: "Unable to complete AI analysis. Please try again later.",
        quotes: [],
        suggestions: ["Retry the analysis", "Check system status"]
      }]
    }
  }

  // 使用简单但有效的去重算法
  const mergedThemes = simpleButEffectiveMerge(allThemes)
  
  console.log(`✅ Quick merge completed: ${mergedThemes.length} final themes`)
  
  return { themes: mergedThemes }
}

// 简单但有效的合并算法
function simpleButEffectiveMerge(allThemes: any[]) {
  const themeGroups = new Map()
  
  // 按标题关键词分组
  for (const theme of allThemes) {
    const keywords = theme.title.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((word: string) => word.length > 2)
      .slice(0, 2) // 只取前两个关键词
      .sort()
      .join('_')
    
    if (!themeGroups.has(keywords)) {
      themeGroups.set(keywords, [])
    }
    themeGroups.get(keywords).push(theme)
  }
  
  // 从每组选择最佳代表
  const finalThemes = []
  for (const [keywords, groupThemes] of themeGroups) {
    if (groupThemes.length === 1) {
      finalThemes.push(groupThemes[0])
    } else {
      // 合并同组主题
      const mergedTheme = {
        title: groupThemes[0].title,
        description: groupThemes[0].description,
        quotes: [],
        suggestions: []
      }
      
      // 收集所有引用和建议
      for (const theme of groupThemes) {
        if (theme.quotes) mergedTheme.quotes.push(...theme.quotes)
        if (theme.suggestions) mergedTheme.suggestions.push(...theme.suggestions)
      }
      
      // 去重并限制数量
      mergedTheme.quotes = Array.from(new Set(mergedTheme.quotes.map(q => q.text)))
        .slice(0, 3)
        .map(text => ({ text, source: 'App Store', date: '2025-01-10' }))
      
      mergedTheme.suggestions = Array.from(new Set(mergedTheme.suggestions)).slice(0, 3)
      
      finalThemes.push(mergedTheme)
    }
  }
  
  // 按重要性排序并限制数量
  return finalThemes
    .sort((a, b) => (b.quotes?.length || 0) - (a.quotes?.length || 0))
    .slice(0, 20) // 限制为20个主题
}

async function createEmptyReport(reportId: string, appName: string, supabaseClient: any) {
  const { data: themeData, error: themeError } = await supabaseClient
    .from('themes')
    .insert({
      report_id: reportId,
      title: "No Reviews Found",
      description: `Unable to find sufficient user reviews for ${appName}. This could be due to the app being new, having limited reviews, or platform restrictions.`
    })
    .select()
    .single()

  if (!themeError && themeData) {
    const suggestions = [
      "Verify the app name is spelled correctly",
      "Check if the app is available in your region",
      "Try searching for the app manually on App Store and Google Play",
      "The app might be new and have limited reviews"
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

async function saveAnalysisResults(reportId: string, analysisResult: any, supabaseClient: any) {
  try {
    for (const theme of analysisResult.themes) {
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

      // Save quotes
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

      // Save suggestions
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