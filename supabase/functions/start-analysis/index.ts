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
      // Fetch ALL scraped reviews from database - NO LIMITS
      console.log(`📥 Fetching ALL ${scrapedDataSummary.totalReviews} reviews from database...`)
      const scrapedData = await fetchAllScrapedReviews(scrapingSessionId, supabaseClient)
      
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

// Fetch ALL scraped reviews from database - NO LIMITS
async function fetchAllScrapedReviews(scrapingSessionId: string, supabaseClient: any) {
  console.log(`📥 Fetching ALL reviews for scraping session ${scrapingSessionId}...`)
  
  // Fetch ALL reviews without any limit
  const { data: reviews, error } = await supabaseClient
    .from('scraped_reviews')
    .select('*')
    .eq('scraping_session_id', scrapingSessionId)
    .order('created_at', { ascending: false }) // Most recent first

  if (error) {
    throw new Error(`Failed to fetch scraped reviews: ${error.message}`)
  }

  // Organize reviews by platform
  const scrapedData = {
    appStore: reviews.filter(r => r.platform === 'app_store'),
    googlePlay: reviews.filter(r => r.platform === 'google_play'),
    reddit: reviews.filter(r => r.platform === 'reddit'),
    totalReviews: reviews.length
  }

  console.log(`📊 Fetched ALL reviews: ${scrapedData.totalReviews} total`)
  console.log(`   - App Store: ${scrapedData.appStore.length} reviews`)
  console.log(`   - Google Play: ${scrapedData.googlePlay.length} reviews`)
  console.log(`   - Reddit: ${scrapedData.reddit.length} posts`)
  
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

// 🚀 Batch Analysis with DeepSeek - NO LIMITS ON REVIEW COUNT
async function analyzeWithDeepSeekBatch(appName: string, scrapedData: any) {
  console.log(`🧠 Starting comprehensive batch analysis for ${appName}`)
  
  // Combine ALL reviews into a single array - NO LIMITS
  const allReviews = [
    ...scrapedData.appStore.map((r: any) => `[App Store] ${r.review_text}`),
    ...scrapedData.googlePlay.map((r: any) => `[Google Play] ${r.review_text}`),
    ...scrapedData.reddit.map((r: any) => `[Reddit] ${r.review_text}`)
  ]

  if (allReviews.length === 0) {
    throw new Error('No reviews available for analysis')
  }

  console.log(`📊 Total reviews to analyze: ${allReviews.length} (NO LIMITS APPLIED)`)

  // 🔄 Step 1: Split reviews into batches for API processing
  const BATCH_SIZE = 800 // Optimized batch size to stay within token limits
  const batches = []
  
  for (let i = 0; i < allReviews.length; i += BATCH_SIZE) {
    batches.push(allReviews.slice(i, i + BATCH_SIZE))
  }

  console.log(`📦 Split ${allReviews.length} reviews into ${batches.length} batches (${BATCH_SIZE} reviews per batch)`)

  // 🔄 Step 2: Analyze each batch separately
  const batchResults = []
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    console.log(`🔍 Analyzing batch ${i + 1}/${batches.length} (${batch.length} reviews)`)
    
    try {
      const batchResult = await analyzeBatchWithDeepSeek(appName, batch, i + 1, batches.length)
      batchResults.push(batchResult)
      
      // Add delay to avoid API rate limits
      if (i < batches.length - 1) {
        console.log(`⏳ Waiting 2 seconds before next batch...`)
        await new Promise(resolve => setTimeout(resolve, 2000))
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
  
  console.log(`🎯 Final result: ${mergedResult.themes.length} unique themes from ${allReviews.length} reviews`)
  
  return mergedResult
}

// 分析单个批次
async function analyzeBatchWithDeepSeek(appName: string, reviews: string[], batchNumber: number, totalBatches: number) {
  const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY')
  
  if (!deepseekApiKey) {
    throw new Error('DEEPSEEK_API_KEY environment variable is not set')
  }

  const prompt = `
You are an expert product analyst. Analyze the following user reviews for the app "${appName}".

This is batch ${batchNumber} of ${totalBatches} total batches.

Your task:
1. Identify the TOP 12-15 most important themes from this batch of reviews
2. For each theme, provide 2-3 representative quotes from actual reviews
3. Generate 2-3 specific, actionable product suggestions for each theme

Focus on themes that are:
- Mentioned by multiple users in this batch
- Have clear sentiment (positive or negative)
- Actionable for product teams
- Specific to user experience, features, or pain points

Reviews to analyze (${reviews.length} total):
${reviews.join('\n\n')}

IMPORTANT: Respond with ONLY valid JSON in English, no markdown formatting, no code blocks, no additional text.

{
  "batchNumber": ${batchNumber},
  "totalBatches": ${totalBatches},
  "reviewsAnalyzed": ${reviews.length},
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
            content: `You are an expert product analyst specializing in user feedback analysis. Always respond with valid JSON only in English, no markdown formatting, no code blocks, no additional text. Focus on finding 12-15 distinct themes per batch.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 8000 // Within DeepSeek's limit of 8192
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

// 合并和去重结果
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

  // 使用DeepSeek进行智能合并和去重
  const mergedResult = await intelligentMergeWithDeepSeek(appName, allThemes)
  
  return mergedResult
}

// 使用DeepSeek进行智能合并
async function intelligentMergeWithDeepSeek(appName: string, allThemes: any[]) {
  const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY')
  
  if (!deepseekApiKey) {
    throw new Error('DEEPSEEK_API_KEY environment variable is not set')
  }

  console.log(`🧠 Using DeepSeek to merge and deduplicate ${allThemes.length} themes...`)

  // 如果主题太多，先进行预处理分组
  let themesToProcess = allThemes
  if (allThemes.length > 100) {
    console.log(`⚠️ Too many themes (${allThemes.length}), pre-processing to reduce size...`)
    themesToProcess = await preProcessThemes(allThemes)
    console.log(`📊 Pre-processed to ${themesToProcess.length} themes`)
  }

  const prompt = `
You are an expert product analyst. You have received multiple theme analyses for the app "${appName}" from different batches of user reviews.

Your task is to merge, deduplicate, and consolidate these themes into the TOP 30 most important themes.

Instructions:
1. Merge similar themes together (e.g., "App Crashes" and "Stability Issues" should be one theme)
2. Remove duplicate themes
3. Prioritize themes by importance, frequency, and user impact
4. Ensure each final theme is distinct and meaningful
5. Combine quotes from similar themes (keep the best examples)
6. Merge suggestions for similar themes
7. Return exactly 30 themes, ranked by importance and user impact

Input themes to merge (${themesToProcess.length} total):
${JSON.stringify(themesToProcess.slice(0, 80), null, 2)}

IMPORTANT: Respond with ONLY valid JSON in English, no markdown formatting, no code blocks, no additional text.

{
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
      ]
    }
  ]
}

Make sure to return exactly 30 themes, ranked by importance and user impact.
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
            content: 'You are an expert product analyst specializing in theme consolidation and deduplication. Always respond with valid JSON only in English, no markdown formatting, no code blocks, no additional text. Return exactly 30 consolidated themes ranked by importance.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.2, // Lower temperature for more consistent merging
        max_tokens: 8000 // Within DeepSeek's limit
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

    // Ensure we have up to 30 themes
    if (mergedResult.themes.length > 30) {
      console.log(`⚠️ Trimming to 30 themes (received ${mergedResult.themes.length})`)
      mergedResult.themes = mergedResult.themes.slice(0, 30)
    }

    console.log(`✅ Successfully merged to ${mergedResult.themes.length} final themes`)
    return mergedResult

  } catch (error) {
    console.error('❌ Error in intelligent merge:', error.message)
    
    // Fallback: Simple deduplication by title similarity
    console.log('🔄 Falling back to simple deduplication...')
    return simpleDeduplication(allThemes)
  }
}

// 预处理主题（当主题数量过多时）
async function preProcessThemes(allThemes: any[]) {
  // 简单的预处理：按标题相似度分组，每组只保留一个代表
  const groups = new Map()
  
  for (const theme of allThemes) {
    const normalizedTitle = theme.title.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    
    const key = normalizedTitle.substring(0, 10) // 使用前10个字符作为分组键
    
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key).push(theme)
  }
  
  // 从每组中选择最好的主题
  const processedThemes = []
  for (const [key, groupThemes] of groups) {
    // 选择描述最长的主题作为代表
    const bestTheme = groupThemes.reduce((best, current) => 
      current.description.length > best.description.length ? current : best
    )
    processedThemes.push(bestTheme)
  }
  
  return processedThemes.slice(0, 80) // 最多80个主题
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

  // Limit to 30 themes
  const finalThemes = uniqueThemes.slice(0, 30)
  
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