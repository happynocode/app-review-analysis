import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface GenerateReportRequest {
  reportId: string
  appName: string
  userSearchTerm?: string // 🆕 用户的原始搜索词
  selectedAppName?: string // 🆕 用户选择的app名称
  appInfo?: any // Single app detailed information
  selectedApps?: any[] // Multiple apps information
  redditOnly?: boolean // 🆕 仅 Reddit 分析标识
  enabledPlatforms?: string[] // 🆕 用户选择的平台
  analysisConfig?: {
    redditOnly?: boolean
    userProvidedName?: string
    customSettings?: any
  }
}

// Track active report generations to prevent duplicates
const activeReports = new Set<string>()

Deno.serve(async (req) => {
  // Handle CORS preflight requests
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
      appInfo, 
      selectedApps, 
      redditOnly,
      enabledPlatforms,
      analysisConfig 
    }: GenerateReportRequest = await req.json()

    if (!reportId || !appName) {
      return new Response(
        JSON.stringify({ error: 'Missing reportId or appName' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // 🆕 确定启用的平台
    let finalEnabledPlatforms = enabledPlatforms || ['app_store', 'google_play', 'reddit']
    if (redditOnly) {
      finalEnabledPlatforms = ['reddit']
    }

    // 🆕 准备分析配置
    const finalAnalysisConfig = {
      redditOnly: redditOnly || false,
      userProvidedName: appName,
      enabledPlatforms: finalEnabledPlatforms,
      ...analysisConfig
    }

    // Check if this report is already being processed
    if (activeReports.has(reportId)) {
      return new Response(
        JSON.stringify({ 
          error: 'Report generation already in progress',
          reportId 
        }),
        { 
          status: 409, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Check if report already exists and is completed
    const { data: existingReport } = await supabaseClient
      .from('reports')
      .select('status')
      .eq('id', reportId)
      .single()

    if (existingReport?.status === 'completed') {
      return new Response(
        JSON.stringify({ 
          error: 'Report already completed',
          reportId 
        }),
        { 
          status: 409, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Add to active reports
    activeReports.add(reportId)

    console.log(`🚀 Starting report generation for ${appName} (${reportId})`)
    console.log(`📱 User-provided app name: "${userSearchTerm || appName}" (will be used for Reddit search)`)
    
    // 🆕 检查是否为仅 Reddit 分析
    if (redditOnly) {
      console.log(`🎯 Reddit-only analysis mode enabled for "${appName}"`)
    }

    // Update report status to processing (user_search_term, selected_app_name, enabled_platforms already set during INSERT)
    await supabaseClient
      .from('reports')
      .update({
        status: 'processing'
      })
      .eq('id', reportId)

    // 🆕 Check if there's already an active scraping session for this report
    const { data: existingSession, error: checkError } = await supabaseClient
      .from('scraping_sessions')
      .select('*')
      .eq('report_id', reportId)
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (checkError) {
      activeReports.delete(reportId)
      throw new Error(`Failed to check existing sessions: ${checkError.message}`)
    }

    let scrapingSession
    if (existingSession) {
      console.log(`♻️ Found existing active scraping session ${existingSession.id} for report ${reportId}`)
      scrapingSession = existingSession
    } else {
      // 🆕 Create scraping session with platform configuration
      const { data: newSession, error: sessionError } = await supabaseClient
        .from('scraping_sessions')
        .insert({
          report_id: reportId,
          app_name: appName,
          user_search_term: userSearchTerm,
          selected_app_name: selectedAppName,
          status: 'pending',
          enabled_platforms: finalEnabledPlatforms,
          analysis_config: finalAnalysisConfig,
          // 🆕 设置每个scraper的初始状态
          app_store_scraper_status: finalEnabledPlatforms.includes('app_store') ? 'pending' : 'disabled',
          google_play_scraper_status: finalEnabledPlatforms.includes('google_play') ? 'pending' : 'disabled',
          reddit_scraper_status: finalEnabledPlatforms.includes('reddit') ? 'pending' : 'disabled'
        })
        .select()
        .single()

      if (sessionError) {
        activeReports.delete(reportId)
        throw new Error(`Failed to create scraping session: ${sessionError.message}`)
      }

      scrapingSession = newSession
      console.log(`✅ Created new scraping session ${scrapingSession.id}`)
    }

    // 🆕 Start the scraping process with platform configuration
    EdgeRuntime.waitUntil(initiateScrapingProcess(
      reportId,
      userSearchTerm || appName, // 优先使用用户搜索词
      scrapingSession.id,
      userSearchTerm,
      selectedAppName,
      appInfo, 
      selectedApps,
      finalEnabledPlatforms,
      finalAnalysisConfig
    ))

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: redditOnly ? 'Reddit-only analysis started' : 'Report generation started',
        reportId,
        scrapingSessionId: scrapingSession.id,
        userProvidedAppName: appName, // 明确显示使用的是用户提供的名称
        analysisType: redditOnly ? 'reddit_only' : 'comprehensive' // 🆕 分析类型
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error in generate-report:', error)
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

async function initiateScrapingProcess(
  reportId: string, 
  userProvidedAppName: string,
  scrapingSessionId: string, 
  userSearchTerm?: string, // 🆕 用户搜索词，可选
  selectedAppName?: string, // 🆕 选中的app名称，可选
  appInfo?: any,
  selectedApps?: any[],
  enabledPlatforms?: string[], // 🆕 启用的平台列表
  analysisConfig?: any // 🆕 分析配置
) {
  try {
    console.log(`🔄 Initiating scraping process for report ${reportId}`)
    console.log(`📱 User-provided app name: "${userProvidedAppName}"`)
    console.log(`🎯 Enabled platforms: ${enabledPlatforms?.join(', ') || 'all'}`)
    
    // 🆕 分析配置日志
    const isRedditOnly = analysisConfig?.redditOnly || false
    if (isRedditOnly) {
      console.log(`🎯 Reddit-only mode: Skipping app store scraping`)
    }

    // 🆕 Call the start-scraping function with platform configuration
    const scrapingResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/start-scraping`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        reportId,
        appName: userProvidedAppName,
        userSearchTerm: userSearchTerm,
        selectedAppName: selectedAppName,
        scrapingSessionId,
        appInfo,
        selectedApps,
        enabledPlatforms, // 🆕 传递启用的平台
        analysisConfig, // 🆕 传递分析配置
        // 🆕 保持向后兼容
        redditOnly: isRedditOnly,
        searchContext: {
          userProvidedName: userProvidedAppName,
          useUserNameForReddit: true,
          redditOnlyMode: isRedditOnly
        }
      })
    })

    if (!scrapingResponse.ok) {
      const errorData = await scrapingResponse.json()
      throw new Error(`Failed to start scraping: ${errorData.error || scrapingResponse.statusText}`)
    }

    const scrapingResult = await scrapingResponse.json()
    console.log(`✅ Successfully initiated scraping for report ${reportId}:`, scrapingResult.message)
    console.log(`🎯 Reddit will search using user-provided name: "${userProvidedAppName}"`)
    
    // 🆕 确认平台配置
    if (isRedditOnly) {
      console.log(`✅ Reddit-only analysis mode confirmed - app store scraping will be skipped`)
    } else {
      console.log(`✅ Multi-platform scraping started for: ${enabledPlatforms?.join(', ')}`)
    }

  } catch (error) {
    console.error(`❌ Error initiating scraping for report ${reportId}:`, error)
    
    // Update report status to error
    try {
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )

      await supabaseClient
        .from('reports')
        .update({ status: 'error' })
        .eq('id', reportId)

      await supabaseClient
        .from('scraping_sessions')
        .update({ 
          status: 'error',
          error_message: error.message,
          completed_at: new Date().toISOString()
        })
        .eq('id', scrapingSessionId)

    } catch (dbError) {
      console.error(`❌ Error updating database after scraping failure:`, dbError)
    }
  } finally {
    // Remove from active reports
    activeReports.delete(reportId)
  }
}