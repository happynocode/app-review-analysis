import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface GenerateReportRequest {
  reportId: string
  appName: string
  appInfo?: any // Single app detailed information
  selectedApps?: any[] // Multiple apps information
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

    const { reportId, appName, appInfo, selectedApps }: GenerateReportRequest = await req.json()

    if (!reportId || !appName) {
      return new Response(
        JSON.stringify({ error: 'Missing reportId or appName' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
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
    console.log(`📱 User-provided app name: "${appName}" (will be used for Reddit search)`)

    // Update report status to processing
    await supabaseClient
      .from('reports')
      .update({ status: 'processing' })
      .eq('id', reportId)

    // Create scraping session with app info
    const { data: scrapingSession, error: sessionError } = await supabaseClient
      .from('scraping_sessions')
      .insert({
        report_id: reportId,
        app_name: appName,
        status: 'pending'
      })
      .select()
      .single()

    if (sessionError) {
      activeReports.delete(reportId)
      throw new Error(`Failed to create scraping session: ${sessionError.message}`)
    }

    console.log(`✅ Created scraping session ${scrapingSession.id}`)

    // Start the scraping process by calling the start-scraping function
    // 🔑 关键修复：传递原始用户输入的应用名称
    EdgeRuntime.waitUntil(initiateScrapingProcess(
      reportId, 
      appName, // 🎯 这是用户填写的原始名称，用于 Reddit 搜索
      scrapingSession.id, 
      appInfo, 
      selectedApps
    ))

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Report generation started',
        reportId,
        scrapingSessionId: scrapingSession.id,
        userProvidedAppName: appName // 明确显示使用的是用户提供的名称
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
  userProvidedAppName: string, // 🔑 明确标识这是用户提供的名称
  scrapingSessionId: string, 
  appInfo?: any,
  selectedApps?: any[]
) {
  try {
    console.log(`🔄 Initiating scraping process for report ${reportId}`)
    console.log(`📱 User-provided app name for Reddit search: "${userProvidedAppName}"`)

    // Call the start-scraping function
    // 🎯 传递用户提供的应用名称，确保 Reddit 搜索使用正确的名称
    const scrapingResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/start-scraping`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        reportId,
        appName: userProvidedAppName, // 🔑 确保传递用户原始输入
        scrapingSessionId,
        appInfo,
        selectedApps,
        // 🆕 添加额外的上下文信息
        searchContext: {
          userProvidedName: userProvidedAppName,
          useUserNameForReddit: true // 明确指示 Reddit 搜索使用用户名称
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