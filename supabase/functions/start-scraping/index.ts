import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface StartScrapingRequest {
  reportId: string
  appName: string
  scrapingSessionId: string
  appInfo?: any
  selectedApps?: any[]
  redditOnly?: boolean // 🆕 仅 Reddit 分析标识
  searchContext?: {
    userProvidedName: string
    useUserNameForReddit: boolean
    redditOnlyMode?: boolean // 🆕 Reddit-only 模式
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

    const { 
      reportId, 
      appName, 
      scrapingSessionId, 
      appInfo, 
      selectedApps,
      redditOnly, // 🆕 接收 Reddit-only 标识
      searchContext 
    }: StartScrapingRequest = await req.json()

    if (!reportId || !appName || !scrapingSessionId) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log(`🚀 Starting scraping for report ${reportId}, app: ${appName}`)
    
    // 🔑 确定 Reddit 搜索使用的名称
    const redditSearchName = searchContext?.useUserNameForReddit 
      ? searchContext.userProvidedName 
      : appName
    
    console.log(`🎯 Reddit search will use: "${redditSearchName}" (user-provided: ${searchContext?.useUserNameForReddit})`)
    
    // 🆕 Reddit-only 模式检查
    if (redditOnly || searchContext?.redditOnlyMode) {
      console.log(`🎯 Reddit-only mode enabled: Skipping app store scraping`)
    }

    // Update scraping session status to running
    await supabaseClient
      .from('scraping_sessions')
      .update({ 
        status: 'running',
        started_at: new Date().toISOString()
      })
      .eq('id', scrapingSessionId)

    // Start the scraping process in the background
    EdgeRuntime.waitUntil(performScraping(
      reportId, 
      appName, 
      scrapingSessionId, 
      supabaseClient, 
      appInfo, 
      selectedApps,
      redditSearchName, // 🎯 传递正确的 Reddit 搜索名称
      redditOnly || searchContext?.redditOnlyMode // 🆕 传递 Reddit-only 标识
    ))

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: redditOnly ? 'Reddit-only scraping started' : 'Scraping started',
        reportId,
        scrapingSessionId,
        redditSearchName, // 返回实际用于 Reddit 搜索的名称
        analysisType: redditOnly ? 'reddit_only' : 'comprehensive' // 🆕 分析类型
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error in start-scraping:', error)
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

async function performScraping(
  reportId: string, 
  appName: string, 
  scrapingSessionId: string, 
  supabaseClient: any,
  appInfo?: any,
  selectedApps?: any[],
  redditSearchName?: string, // 🆕 专门用于 Reddit 搜索的名称
  redditOnly?: boolean // 🆕 Reddit-only 标识
) {
  try {
    console.log(`📊 Starting scraping process for ${appName}`)
    console.log(`🎯 Reddit search name: "${redditSearchName || appName}"`)
    
    // 🆕 Reddit-only 模式处理
    if (redditOnly) {
      console.log(`🎯 Reddit-only mode: Performing Reddit-only scraping`)
      const scrapedData = await performRedditOnlyScraping(redditSearchName || appName, scrapingSessionId)
      
      console.log(`✅ Reddit-only scraping completed: Found ${scrapedData.totalReviews} Reddit posts`)
      console.log(`- Reddit: ${scrapedData.reddit.length} posts`)
      
      // Update scraping session with Reddit-only totals
      await supabaseClient
        .from('scraping_sessions')
        .update({
          status: 'completed',
          total_reviews_found: scrapedData.totalReviews,
          app_store_reviews: 0, // 明确设置为 0
          google_play_reviews: 0, // 明确设置为 0
          reddit_posts: scrapedData.reddit.length,
          completed_at: new Date().toISOString()
        })
        .eq('id', scrapingSessionId)

      // Trigger the next stage (AI analysis)
      console.log(`🔄 Triggering AI analysis for Reddit-only report ${reportId}`)
      
      const analysisResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/start-analysis`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          reportId,
          appName,
          scrapingSessionId,
          scrapedDataSummary: {
            totalReviews: scrapedData.totalReviews,
            appStoreCount: 0,
            googlePlayCount: 0,
            redditCount: scrapedData.reddit.length
          }
        })
      })

      if (!analysisResponse.ok) {
        throw new Error(`Failed to trigger analysis: ${analysisResponse.status}`)
      }

      console.log(`✅ Successfully triggered AI analysis for Reddit-only report ${reportId}`)
      return
    }

    // 🔄 原有的综合抓取逻辑
    // Determine scraping strategy based on available app info
    let scrapedData
    if (selectedApps && selectedApps.length > 0) {
      // Multiple apps - scrape each one
      console.log(`Scraping ${selectedApps.length} selected apps...`)
      scrapedData = await scrapeMultipleApps(selectedApps, scrapingSessionId, redditSearchName)
    } else if (appInfo) {
      // Single app with detailed info
      console.log(`Scraping single app with detailed info: ${appInfo.name}`)
      scrapedData = await scrapeSingleAppWithInfo(appInfo, scrapingSessionId, redditSearchName)
    } else {
      // Fallback to general search
      console.log(`Fallback to general search for: ${appName}`)
      scrapedData = await scrapeGeneralSearch(appName, scrapingSessionId, redditSearchName)
    }
    
    console.log(`✅ Scraping completed: Found ${scrapedData.totalReviews} total reviews`)
    console.log(`- App Store: ${scrapedData.appStore.length}`)
    console.log(`- Google Play: ${scrapedData.googlePlay.length}`)
    console.log(`- Reddit: ${scrapedData.reddit.length} (searched for: "${redditSearchName || appName}")`)
    
    // Update scraping session with totals
    await supabaseClient
      .from('scraping_sessions')
      .update({
        status: 'completed',
        total_reviews_found: scrapedData.totalReviews,
        app_store_reviews: scrapedData.appStore.length,
        google_play_reviews: scrapedData.googlePlay.length,
        reddit_posts: scrapedData.reddit.length,
        completed_at: new Date().toISOString()
      })
      .eq('id', scrapingSessionId)

    // Trigger the next stage (AI analysis)
    console.log(`🔄 Triggering AI analysis for report ${reportId}`)
    
    const analysisResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/start-analysis`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        reportId,
        appName,
        scrapingSessionId,
        scrapedDataSummary: {
          totalReviews: scrapedData.totalReviews,
          appStoreCount: scrapedData.appStore.length,
          googlePlayCount: scrapedData.googlePlay.length,
          redditCount: scrapedData.reddit.length
        }
      })
    })

    if (!analysisResponse.ok) {
      throw new Error(`Failed to trigger analysis: ${analysisResponse.status}`)
    }

    console.log(`✅ Successfully triggered AI analysis for report ${reportId}`)

  } catch (error) {
    console.error(`❌ Error in scraping process for ${reportId}:`, error)
    
    // Update scraping session with error
    await supabaseClient
      .from('scraping_sessions')
      .update({ 
        status: 'error',
        error_message: error.message,
        completed_at: new Date().toISOString()
      })
      .eq('id', scrapingSessionId)
    
    // Update report status to error
    await supabaseClient
      .from('reports')
      .update({ status: 'error' })
      .eq('id', reportId)
  }
}

// 🆕 仅 Reddit 抓取函数
async function performRedditOnlyScraping(appName: string, scrapingSessionId: string) {
  console.log(`🎯 Performing Reddit-only scraping for: "${appName}"`)
  
  const scrapedData = {
    appStore: [],
    googlePlay: [],
    reddit: [],
    totalReviews: 0
  }

  try {
    // 只调用 Reddit 抓取
    const redditData = await scrapeRedditForApp(appName, scrapingSessionId)
    scrapedData.reddit = redditData
    scrapedData.totalReviews = redditData.length
    
    console.log(`✅ Reddit-only scraping completed: ${scrapedData.reddit.length} posts found`)
    
  } catch (error) {
    console.error(`❌ Error in Reddit-only scraping:`, error)
  }

  return scrapedData
}

// Scrape multiple selected apps
async function scrapeMultipleApps(selectedApps: any[], scrapingSessionId: string, redditSearchName?: string) {
  const allData = {
    appStore: [],
    googlePlay: [],
    reddit: [],
    totalReviews: 0
  }

  for (const app of selectedApps) {
    console.log(`Scraping app: ${app.name} (${app.platform})`)
    
    try {
      if (app.platform === 'ios') {
        const appStoreData = await scrapeSpecificIOSApp(app, scrapingSessionId)
        allData.appStore.push(...appStoreData)
      } else if (app.platform === 'android') {
        const googlePlayData = await scrapeSpecificAndroidApp(app, scrapingSessionId)
        allData.googlePlay.push(...googlePlayData)
      }

      // 🔑 Reddit 搜索使用用户提供的名称
      const searchName = redditSearchName || app.name
      console.log(`🎯 Reddit search for app ${app.name} using name: "${searchName}"`)
      const redditData = await scrapeRedditForApp(searchName, scrapingSessionId)
      allData.reddit.push(...redditData)

    } catch (error) {
      console.error(`Error scraping app ${app.name}:`, error)
    }
  }

  allData.totalReviews = allData.appStore.length + allData.googlePlay.length + allData.reddit.length
  return allData
}

// Scrape single app (with detailed info)
async function scrapeSingleAppWithInfo(appInfo: any, scrapingSessionId: string, redditSearchName?: string) {
  const scrapedData = {
    appStore: [],
    googlePlay: [],
    reddit: [],
    totalReviews: 0
  }

  try {
    if (appInfo.platform === 'ios') {
      scrapedData.appStore = await scrapeSpecificIOSApp(appInfo, scrapingSessionId)
    } else if (appInfo.platform === 'android') {
      scrapedData.googlePlay = await scrapeSpecificAndroidApp(appInfo, scrapingSessionId)
    }

    // 🔑 Reddit 搜索使用用户提供的名称
    const searchName = redditSearchName || appInfo.name
    console.log(`🎯 Reddit search for ${appInfo.name} using name: "${searchName}"`)
    scrapedData.reddit = await scrapeRedditForApp(searchName, scrapingSessionId)

  } catch (error) {
    console.error(`Error scraping app ${appInfo.name}:`, error)
  }

  scrapedData.totalReviews = scrapedData.appStore.length + scrapedData.googlePlay.length + scrapedData.reddit.length
  return scrapedData
}

// General search (fallback)
async function scrapeGeneralSearch(appName: string, scrapingSessionId: string, redditSearchName?: string) {
  return await startParallelScraping(appName, scrapingSessionId, redditSearchName)
}

// Scrape specific iOS app
async function scrapeSpecificIOSApp(appInfo: any, scrapingSessionId: string) {
  try {
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/scrape-app-store`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        appName: appInfo.name,
        appId: appInfo.id,
        scrapingSessionId 
      })
    })

    if (response.ok) {
      const data = await response.json()
      return data.reviews || []
    }
  } catch (error) {
    console.error('Error scraping specific iOS app:', error)
  }
  
  return []
}

// Scrape specific Android app
async function scrapeSpecificAndroidApp(appInfo: any, scrapingSessionId: string) {
  try {
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/scrape-google-play`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        appName: appInfo.name,
        packageName: appInfo.packageId,
        scrapingSessionId 
      })
    })

    if (response.ok) {
      const data = await response.json()
      return data.reviews || []
    }
  } catch (error) {
    console.error('Error scraping specific Android app:', error)
  }
  
  return []
}

// Search Reddit for specific app
async function scrapeRedditForApp(appName: string, scrapingSessionId: string) {
  try {
    console.log(`🎯 Calling Reddit scraper with app name: "${appName}"`)
    
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/scrape-reddit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        appName, // 🔑 这里传递的是用户提供的原始名称
        scrapingSessionId 
      })
    })

    if (response.ok) {
      const data = await response.json()
      console.log(`✅ Reddit scraper returned ${data.posts?.length || 0} posts for "${appName}"`)
      return data.posts || []
    } else {
      console.error(`❌ Reddit scraper failed: ${response.status}`)
    }
  } catch (error) {
    console.error('Error scraping Reddit for app:', error)
  }
  
  return []
}

function startParallelScraping(appName: string, scrapingSessionId: string, redditSearchName?: string) {
  const baseUrl = Deno.env.get('SUPABASE_URL')
  const authHeader = `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
  
  const headers = {
    'Authorization': authHeader,
    'Content-Type': 'application/json'
  }

  // 🔑 为不同平台使用不同的应用名称
  const appStoreRequestBody = JSON.stringify({ appName, scrapingSessionId })
  const googlePlayRequestBody = JSON.stringify({ appName, scrapingSessionId })
  const redditRequestBody = JSON.stringify({ 
    appName: redditSearchName || appName, // 🎯 Reddit 使用用户提供的名称
    scrapingSessionId 
  })

  console.log(`🎯 Parallel scraping setup:`)
  console.log(`   - App Store/Google Play: "${appName}"`)
  console.log(`   - Reddit: "${redditSearchName || appName}"`)

  // Start all three scraping tasks in parallel
  const appStorePromise = fetch(`${baseUrl}/functions/v1/scrape-app-store`, {
    method: 'POST',
    headers,
    body: appStoreRequestBody
  }).then(async (response) => {
    const result = { platform: 'app_store', success: false, data: null, error: null }
    try {
      if (response.ok) {
        result.data = await response.json()
        result.success = true
        console.log(`App Store scraping completed: ${result.data.reviews?.length || 0} reviews`)
      } else {
        const errorText = await response.text()
        result.error = `HTTP ${response.status}: ${errorText}`
        console.error(`App Store scraping failed: ${result.error}`)
      }
    } catch (error) {
      result.error = error.message
      console.error(`App Store scraping error: ${error.message}`)
    }
    return result
  })

  const googlePlayPromise = fetch(`${baseUrl}/functions/v1/scrape-google-play`, {
    method: 'POST',
    headers,
    body: googlePlayRequestBody
  }).then(async (response) => {
    const result = { platform: 'google_play', success: false, data: null, error: null }
    try {
      if (response.ok) {
        result.data = await response.json()
        result.success = true
        console.log(`Google Play scraping completed: ${result.data.reviews?.length || 0} reviews`)
      } else {
        const errorText = await response.text()
        result.error = `HTTP ${response.status}: ${errorText}`
        console.error(`Google Play scraping failed: ${result.error}`)
      }
    } catch (error) {
      result.error = error.message
      console.error(`Google Play scraping error: ${error.message}`)
    }
    return result
  })

  const redditPromise = fetch(`${baseUrl}/functions/v1/scrape-reddit`, {
    method: 'POST',
    headers,
    body: redditRequestBody // 🔑 使用包含用户提供名称的请求体
  }).then(async (response) => {
    const result = { platform: 'reddit', success: false, data: null, error: null }
    try {
      if (response.ok) {
        result.data = await response.json()
        result.success = true
        console.log(`Reddit scraping completed: ${result.data.posts?.length || 0} posts (searched for: "${redditSearchName || appName}")`)
      } else {
        const errorText = await response.text()
        result.error = `HTTP ${response.status}: ${errorText}`
        console.error(`Reddit scraping failed: ${result.error}`)
      }
    } catch (error) {
      result.error = error.message
      console.error(`Reddit scraping error: ${error.message}`)
    }
    return result
  })

  return waitForScrapingCompletion(scrapingSessionId, {
    appStore: appStorePromise,
    googlePlay: googlePlayPromise,
    reddit: redditPromise
  })
}

async function waitForScrapingCompletion(scrapingSessionId: string, scrapingPromises: any) {
  console.log('Waiting for all scraping tasks to complete...')
  
  // Wait for all promises to settle (complete or fail)
  const results = await Promise.allSettled([
    scrapingPromises.appStore,
    scrapingPromises.googlePlay,
    scrapingPromises.reddit
  ])

  const scrapedData = {
    appStore: [],
    googlePlay: [],
    reddit: [],
    totalReviews: 0,
    errors: []
  }

  // Process results
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const platformResult = result.value
      
      if (platformResult.success && platformResult.data) {
        switch (platformResult.platform) {
          case 'app_store':
            scrapedData.appStore = platformResult.data.reviews || []
            break
          case 'google_play':
            scrapedData.googlePlay = platformResult.data.reviews || []
            break
          case 'reddit':
            scrapedData.reddit = platformResult.data.posts || []
            break
        }
      } else if (platformResult.error) {
        scrapedData.errors.push(`${platformResult.platform}: ${platformResult.error}`)
      }
    } else {
      scrapedData.errors.push(`Promise rejected: ${result.reason}`)
    }
  }

  scrapedData.totalReviews = scrapedData.appStore.length + scrapedData.googlePlay.length + scrapedData.reddit.length

  // Log completion status
  console.log('All scraping tasks completed:')
  console.log(`- App Store: ${scrapedData.appStore.length} reviews`)
  console.log(`- Google Play: ${scrapedData.googlePlay.length} reviews`)
  console.log(`- Reddit: ${scrapedData.reddit.length} posts`)
  console.log(`- Total: ${scrapedData.totalReviews} items`)
  
  if (scrapedData.errors.length > 0) {
    console.log('Scraping errors:', scrapedData.errors)
  }

  return scrapedData
}