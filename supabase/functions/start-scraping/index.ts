import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface StartScrapingRequest {
  reportId: string
  appName: string
  userSearchTerm?: string // 🆕 用户的原始搜索词
  selectedAppName?: string // 🆕 用户选择的app名称
  scrapingSessionId: string
  appInfo?: any
  selectedApps?: any[]
  redditOnly?: boolean // 🆕 向后兼容
  enabledPlatforms?: string[] // 🆕 启用的平台列表
  analysisConfig?: any // 🆕 分析配置
  searchContext?: {
    userProvidedName: string
    useUserNameForReddit: boolean
    redditOnlyMode?: boolean
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
      userSearchTerm,
      selectedAppName,
      scrapingSessionId, 
      appInfo, 
      selectedApps,
      redditOnly,
      enabledPlatforms, // 🆕 接收启用的平台
      analysisConfig, // 🆕 接收分析配置
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
    
    // 🆕 确定启用的平台（向后兼容）
    const finalEnabledPlatforms = enabledPlatforms || 
      (redditOnly || searchContext?.redditOnlyMode ? ['reddit'] : ['app_store', 'google_play', 'reddit'])
    
    // 🔑 确定 Reddit 搜索使用的名称
    const redditSearchName = userSearchTerm || // 🆕 优先使用用户搜索词
      (searchContext?.useUserNameForReddit 
        ? searchContext.userProvidedName 
        : appName)
    
    console.log(`🎯 Enabled platforms: ${finalEnabledPlatforms.join(', ')}`)
    console.log(`🎯 Reddit search will use: "${redditSearchName}" (user search term: "${userSearchTerm || 'not provided'}", selected app: "${selectedAppName || 'not provided'}")`)
    
    // 🆕 更新scraping session中的平台状态（如果还没有设置）
    const { data: currentSession } = await supabaseClient
      .from('scraping_sessions')
      .select('enabled_platforms')
      .eq('id', scrapingSessionId)
      .single()
    
    if (!currentSession?.enabled_platforms) {
      await supabaseClient
        .from('scraping_sessions')
        .update({
          enabled_platforms: finalEnabledPlatforms,
          analysis_config: analysisConfig || {},
          app_store_scraper_status: finalEnabledPlatforms.includes('app_store') ? 'pending' : 'disabled',
          google_play_scraper_status: finalEnabledPlatforms.includes('google_play') ? 'pending' : 'disabled',
          reddit_scraper_status: finalEnabledPlatforms.includes('reddit') ? 'pending' : 'disabled'
        })
        .eq('id', scrapingSessionId)
    }

    // Update report status to scraping and scraping session to running
    await supabaseClient
      .from('reports')
      .update({ 
        status: 'scraping',
        updated_at: new Date().toISOString()
      })
      .eq('id', reportId)

    await supabaseClient
      .from('scraping_sessions')
      .update({ 
        status: 'running',
        started_at: new Date().toISOString()
      })
      .eq('id', scrapingSessionId)

    // 🆕 Start the scraping process with platform configuration
    EdgeRuntime.waitUntil(performScraping(
      reportId, 
      appName, 
      scrapingSessionId, 
      supabaseClient, 
      appInfo, 
      selectedApps,
      redditSearchName,
      finalEnabledPlatforms, // 🆕 传递启用的平台
      analysisConfig, // 🆕 传递分析配置
      userSearchTerm, // 🆕 传递用户搜索词
      selectedAppName // 🆕 传递选中的app名称
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
  redditSearchName?: string,
  enabledPlatforms?: string[], // 🆕 启用的平台
  analysisConfig?: any, // 🆕 分析配置
  userSearchTerm?: string, // 🆕 传递用户搜索词
  selectedAppName?: string // 🆕 传递选中的app名称
) {
  try {
    console.log(`📊 Starting scraping process for ${appName}`)
    console.log(`🎯 Reddit search name: "${redditSearchName || appName}"`)
    console.log(`🎯 Enabled platforms: ${enabledPlatforms?.join(', ') || 'all'}`)
    
    const isRedditOnly = enabledPlatforms?.length === 1 && enabledPlatforms[0] === 'reddit'
    const enabledSet = new Set(enabledPlatforms || ['app_store', 'google_play', 'reddit'])
    
    // 🆕 根据启用的平台进行抓取
    if (isRedditOnly) {
      console.log(`🎯 Reddit-only mode: Performing Reddit-only scraping`)
      
      // 更新 Reddit scraper 状态为运行中
      await supabaseClient
        .from('scraping_sessions')
        .update({
          reddit_scraper_status: 'running',
          reddit_started_at: new Date().toISOString()
        })
        .eq('id', scrapingSessionId)
      
      const scrapedData = await performRedditOnlyScraping(redditSearchName || appName, scrapingSessionId)
      
      // 更新 Reddit scraper 状态和总体状态为完成
      const completedAt = new Date().toISOString()
      await supabaseClient
        .from('scraping_sessions')
        .update({
          status: 'completed',
          completed_at: completedAt,
          reddit_scraper_status: scrapedData.totalReviews > 0 ? 'completed' : 'failed',
          reddit_completed_at: completedAt,
          // 确保其他平台状态为disabled（如果它们没有被启用）
          app_store_scraper_status: 'disabled',
          google_play_scraper_status: 'disabled'
        })
        .eq('id', scrapingSessionId)

      console.log(`✅ Reddit-only scraping completed: Found ${scrapedData.totalReviews} Reddit posts`)
      console.log(`🔄 Status monitoring will handle completion detection and analysis triggering`)
      return
    }

    // 🔄 更新后的综合抓取逻辑 - 现在会传递enabledPlatforms
    // Determine scraping strategy based on available app info
    let scrapedData
    if (selectedApps && selectedApps.length > 0) {
      // Multiple apps - scrape each one
      console.log(`Scraping ${selectedApps.length} selected apps...`)
      scrapedData = await scrapeMultipleApps(selectedApps, scrapingSessionId, redditSearchName, enabledPlatforms)
    } else if (appInfo) {
      // Single app with detailed info
      console.log(`Scraping single app with detailed info: ${appInfo.name}`)
      scrapedData = await scrapeSingleAppWithInfo(appInfo, scrapingSessionId, redditSearchName, enabledPlatforms)
    } else {
      // Fallback to general search
      console.log(`Fallback to general search for: ${appName}`)
      scrapedData = await scrapeGeneralSearch(appName, scrapingSessionId, redditSearchName, enabledPlatforms, userSearchTerm, selectedAppName)
    }
    
    console.log(`✅ Scraping completed: Found ${scrapedData.totalReviews} total reviews`)
    console.log(`- App Store: ${scrapedData.appStore.length}`)
    console.log(`- Google Play: ${scrapedData.googlePlay.length}`)
    console.log(`- Reddit: ${scrapedData.reddit.length} (searched for: "${redditSearchName || appName}")`)
    
    // Update scraping session status and individual platform statuses
    const completedAt = new Date().toISOString()
    const platformUpdates: any = {
      status: 'completed',
      completed_at: completedAt
    }

    // Update individual platform scraper statuses based on results
    // Note: enabledSet is already defined above at line 177

    if (enabledSet.has('app_store')) {
      platformUpdates.app_store_scraper_status = scrapedData.appStore.length > 0 ? 'completed' : 'failed'
      platformUpdates.app_store_completed_at = completedAt
    }

    if (enabledSet.has('google_play')) {
      platformUpdates.google_play_scraper_status = scrapedData.googlePlay.length > 0 ? 'completed' : 'failed'
      platformUpdates.google_play_completed_at = completedAt
    }

    if (enabledSet.has('reddit')) {
      platformUpdates.reddit_scraper_status = scrapedData.reddit.length > 0 ? 'completed' : 'failed'
      platformUpdates.reddit_completed_at = completedAt
    }

    await supabaseClient
      .from('scraping_sessions')
      .update(platformUpdates)
      .eq('id', scrapingSessionId)

    console.log(`✅ Updated scraping session with platform statuses:`, {
      app_store: platformUpdates.app_store_scraper_status,
      google_play: platformUpdates.google_play_scraper_status,
      reddit: platformUpdates.reddit_scraper_status
    })

    // 不再直接触发分析，让cron-scraping-monitor来处理状态转换和分析触发
    console.log(`✅ Scraping data collection completed for report ${reportId}`)
    console.log(`🔄 Status monitoring will handle completion detection and analysis triggering`)

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
async function scrapeMultipleApps(selectedApps: any[], scrapingSessionId: string, redditSearchName?: string, enabledPlatforms?: string[]) {
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
async function scrapeSingleAppWithInfo(appInfo: any, scrapingSessionId: string, redditSearchName?: string, enabledPlatforms?: string[]) {
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

// General search approach (no specific app info)
async function scrapeGeneralSearch(appName: string, scrapingSessionId: string, redditSearchName?: string, enabledPlatforms?: string[], userSearchTerm?: string, selectedAppName?: string) {
  console.log(`📱 General search approach for: ${appName}`)
  return await startParallelScraping(appName, scrapingSessionId, redditSearchName, enabledPlatforms, userSearchTerm, selectedAppName)
}

// Scrape specific iOS app
async function scrapeSpecificIOSApp(appInfo: any, scrapingSessionId: string) {
  try {
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/scrape-app-store`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
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
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
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
async function scrapeRedditForApp(appName: string, scrapingSessionId: string, userSearchTerm?: string, selectedAppName?: string) {
  try {
    console.log(`🎯 Calling Reddit scraper with app name: "${appName}"`)
    console.log(`🎯 User search term: "${userSearchTerm || 'not provided'}", Selected app: "${selectedAppName || 'not provided'}"`)

    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/scrape-reddit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        appName: selectedAppName || appName, // 🆕 使用selectedAppName作为app名称
        userSearchTerm: userSearchTerm, // 🆕 传递用户搜索词
        scrapingSessionId,
        // 移除maxPosts限制，让scrape-reddit获取所有可用数据
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

function startParallelScraping(appName: string, scrapingSessionId: string, redditSearchName?: string, enabledPlatforms?: string[], userSearchTerm?: string, selectedAppName?: string) {
  const baseUrl = Deno.env.get('SUPABASE_URL')

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
  }

  // 🆕 确定启用的平台
  const enabledSet = new Set(enabledPlatforms || ['app_store', 'google_play', 'reddit'])
  const isAppStoreEnabled = enabledSet.has('app_store')
  const isGooglePlayEnabled = enabledSet.has('google_play')
  const isRedditEnabled = enabledSet.has('reddit')

  console.log(`🎯 Parallel scraping setup:`)
  console.log(`   - App Store: ${isAppStoreEnabled ? 'ENABLED' : 'DISABLED'}`)
  console.log(`   - Google Play: ${isGooglePlayEnabled ? 'ENABLED' : 'DISABLED'}`)
  console.log(`   - Reddit: ${isRedditEnabled ? 'ENABLED' : 'DISABLED'}`)
  console.log(`   - App Store/Google Play search: "${appName}"`)
  console.log(`   - Reddit search: "${redditSearchName || appName}"`)

  // 🆕 只为启用的平台创建Promise
  const scrapingPromises: any = {}

  // App Store Promise (只在启用时创建)
  if (isAppStoreEnabled) {
    const appStoreRequestBody = JSON.stringify({ appName, scrapingSessionId })
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
    scrapingPromises.appStore = appStorePromise
  } else {
    // 为禁用的平台创建一个立即解析的Promise
    scrapingPromises.appStore = Promise.resolve({ 
      platform: 'app_store', 
      success: true, 
      data: { reviews: [] }, 
      error: null,
      disabled: true 
    })
  }

  // Google Play Promise (只在启用时创建)
  if (isGooglePlayEnabled) {
    const googlePlayRequestBody = JSON.stringify({ appName, scrapingSessionId })
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
    scrapingPromises.googlePlay = googlePlayPromise
  } else {
    // 为禁用的平台创建一个立即解析的Promise
    scrapingPromises.googlePlay = Promise.resolve({ 
      platform: 'google_play', 
      success: true, 
      data: { reviews: [] }, 
      error: null,
      disabled: true 
    })
  }

  // Reddit Promise (只在启用时创建)
  if (isRedditEnabled) {
    const redditRequestBody = JSON.stringify({ 
      appName: selectedAppName || redditSearchName || appName, // 🆕 使用selectedAppName作为app名称
      userSearchTerm: userSearchTerm, // 🆕 传递用户搜索词 
      scrapingSessionId,
              // 移除maxPosts限制，让scrape-reddit获取所有可用数据
    })
    const redditPromise = fetch(`${baseUrl}/functions/v1/scrape-reddit`, {
      method: 'POST',
      headers,
      body: redditRequestBody
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
    scrapingPromises.reddit = redditPromise
  } else {
    // 为禁用的平台创建一个立即解析的Promise
    scrapingPromises.reddit = Promise.resolve({ 
      platform: 'reddit', 
      success: true, 
      data: { posts: [] }, 
      error: null,
      disabled: true 
    })
  }

  return waitForScrapingCompletion(scrapingSessionId, scrapingPromises)
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