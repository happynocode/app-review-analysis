import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface UpdateStatusRequest {
  scrapingSessionId?: string
  reportId?: string
  platform?: 'app_store' | 'google_play' | 'reddit'
  status?: 'running' | 'completed' | 'failed'
  autoDetect?: boolean
}

interface ScrapingStats {
  app_store: number
  google_play: number
  reddit: number
  total: number
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { 
      scrapingSessionId, 
      reportId, 
      platform, 
      status, 
      autoDetect = false 
    }: UpdateStatusRequest = await req.json()

    console.log('🔄 Status update request:', { scrapingSessionId, reportId, platform, status, autoDetect })

    if (autoDetect) {
      // 自动检测模式：基于实际数据更新状态
      return await handleAutoDetect(supabase, scrapingSessionId, reportId)
    } else if (scrapingSessionId && platform && status) {
      // 手动更新模式
      return await handleManualUpdate(supabase, scrapingSessionId, platform, status)
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid parameters. Need either autoDetect=true or (scrapingSessionId, platform, status)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

  } catch (error: any) {
    console.error('❌ Error in update-scraper-status:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function handleAutoDetect(supabase: any, scrapingSessionId?: string, reportId?: string) {
  console.log('🤖 Auto-detect mode activated')

  let sessions = []

  if (scrapingSessionId) {
    // 检测特定的scraping session
    const { data, error } = await supabase
      .from('scraping_sessions')
      .select('*')
      .eq('id', scrapingSessionId)
      .single()

    if (error) throw error
    sessions = [data]
  } else if (reportId) {
    // 检测特定报告的所有scraping sessions
    const { data, error } = await supabase
      .from('scraping_sessions')
      .select('*')
      .eq('report_id', reportId)

    if (error) throw error
    sessions = data || []
  } else {
    // 检测所有运行中的sessions
    const { data, error } = await supabase
      .from('scraping_sessions')
      .select('*')
      .eq('status', 'running')

    if (error) throw error
    sessions = data || []
  }

  console.log(`🔍 Found ${sessions.length} sessions to check`)

  const results = []

  for (const session of sessions) {
    console.log(`📊 Checking session ${session.id}`)

    // 获取实际的scraped数据统计
    const stats = await getScrapingStats(supabase, session.id)
    console.log(`📈 Stats for session ${session.id}:`, stats)

    // 确定各平台应有的状态
    const enabledPlatforms = session.enabled_platforms || ['app_store', 'google_play', 'reddit']
    const updates: any = {}
    const statusUpdates = []

    for (const platform of enabledPlatforms) {
      const currentStatus = session[`${platform}_scraper_status`]
      const dataCount = stats[platform as keyof ScrapingStats]
      
      let newStatus = currentStatus
      
      if (currentStatus === 'pending' || currentStatus === 'running') {
        if (dataCount > 0) {
          // 如果有数据，状态应该是completed
          newStatus = 'completed'
          updates[`${platform}_scraper_status`] = 'completed'
          updates[`${platform}_completed_at`] = new Date().toISOString()
          statusUpdates.push(`${platform}: pending -> completed (${dataCount} reviews)`)
        }
      }
    }

    // 检查是否需要更新overall session状态
    const allEnabledComplete = enabledPlatforms.every(platform => {
      const currentStatus = session[`${platform}_scraper_status`]
      const dataCount = stats[platform as keyof ScrapingStats]
      return currentStatus === 'completed' || (currentStatus === 'pending' && dataCount > 0)
    })

    if (allEnabledComplete && session.status === 'running') {
      updates.status = 'completed'
      updates.completed_at = new Date().toISOString()
      updates.total_reviews_found = stats.total
      updates.app_store_reviews = stats.app_store
      updates.google_play_reviews = stats.google_play
      updates.reddit_posts = stats.reddit
      statusUpdates.push(`session: running -> completed (${stats.total} total reviews)`)
    }

    // 应用更新
    if (Object.keys(updates).length > 0) {
      console.log(`🔄 Updating session ${session.id}:`, updates)
      
      const { error: updateError } = await supabase
        .from('scraping_sessions')
        .update(updates)
        .eq('id', session.id)

      if (updateError) {
        console.error(`❌ Failed to update session ${session.id}:`, updateError)
        results.push({
          sessionId: session.id,
          success: false,
          error: updateError.message
        })
      } else {
        console.log(`✅ Successfully updated session ${session.id}`)
        results.push({
          sessionId: session.id,
          success: true,
          updates: statusUpdates,
          stats: stats
        })
      }
    } else {
      console.log(`ℹ️ No updates needed for session ${session.id}`)
      results.push({
        sessionId: session.id,
        success: true,
        message: 'No updates needed',
        stats: stats
      })
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: `Auto-detect completed for ${sessions.length} sessions`,
      results: results
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleManualUpdate(supabase: any, scrapingSessionId: string, platform: string, status: string) {
  console.log(`🖐️ Manual update: ${platform} -> ${status}`)

  const updates: any = {
    [`${platform}_scraper_status`]: status
  }

  if (status === 'completed') {
    updates[`${platform}_completed_at`] = new Date().toISOString()
  } else if (status === 'running') {
    updates[`${platform}_started_at`] = new Date().toISOString()
  } else if (status === 'failed') {
    updates[`${platform}_completed_at`] = new Date().toISOString()
    // 可以添加错误信息字段
  }

  const { error } = await supabase
    .from('scraping_sessions')
    .update(updates)
    .eq('id', scrapingSessionId)

  if (error) {
    throw error
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: `Updated ${platform} status to ${status}`,
      scrapingSessionId,
      platform,
      status
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getScrapingStats(supabase: any, scrapingSessionId: string): Promise<ScrapingStats> {
  const { data, error } = await supabase
    .from('scraped_reviews')
    .select('platform')
    .eq('scraping_session_id', scrapingSessionId)

  if (error) {
    console.error('Error fetching scraping stats:', error)
    return { app_store: 0, google_play: 0, reddit: 0, total: 0 }
  }

  const stats: ScrapingStats = {
    app_store: 0,
    google_play: 0,
    reddit: 0,
    total: 0
  }

  for (const review of data || []) {
    if (review.platform === 'app_store') stats.app_store++
    else if (review.platform === 'google_play') stats.google_play++
    else if (review.platform === 'reddit') stats.reddit++
    stats.total++
  }

  return stats
} 