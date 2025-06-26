import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface DeleteAllDataRequest {
  userId: string
  confirmationText: string
}

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

    const { userId, confirmationText }: DeleteAllDataRequest = await req.json()

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'Missing userId' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // 验证确认文本
    if (confirmationText !== 'DELETE ALL MY DATA') {
      return new Response(
        JSON.stringify({ error: 'Invalid confirmation text' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log(`Starting data deletion for user: ${userId}`)

    // 验证用户存在
    const { data: user, error: userError } = await supabaseClient
      .from('users')
      .select('id')
      .eq('id', userId)
      .single()

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    let deletedCounts = {
      scraped_reviews: 0,
      quotes: 0,
      suggestions: 0,
      themes: 0,
      scraping_sessions: 0,
      reports: 0
    }

    // First, get all report IDs for this user
    console.log('Fetching user reports...')
    const { data: userReports, error: reportsError } = await supabaseClient
      .from('reports')
      .select('id')
      .eq('user_id', userId)

    if (reportsError) {
      console.error('Error fetching user reports:', reportsError)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch user reports' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    const reportIds = userReports?.map(r => r.id) || []
    console.log(`Found ${reportIds.length} reports for user`)

    if (reportIds.length === 0) {
      // No reports found, just return success
      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'No data found to delete',
          deletedCounts,
          totalDeleted: 0,
          timestamp: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Get scraping session IDs
    console.log('Fetching scraping sessions...')
    const { data: scrapingSessions, error: scrapingSessionsError } = await supabaseClient
      .from('scraping_sessions')
      .select('id')
      .in('report_id', reportIds)

    const scrapingSessionIds = scrapingSessions?.map(s => s.id) || []
    console.log(`Found ${scrapingSessionIds.length} scraping sessions`)

    // Get theme IDs
    console.log('Fetching themes...')
    const { data: themes, error: themesError } = await supabaseClient
      .from('themes')
      .select('id')
      .in('report_id', reportIds)

    const themeIds = themes?.map(t => t.id) || []
    console.log(`Found ${themeIds.length} themes`)

    // 步骤1: 删除 scraped_reviews
    if (scrapingSessionIds.length > 0) {
      console.log('Deleting scraped reviews...')
      const { count: scrapedReviewsCount, error: scrapedReviewsError } = await supabaseClient
        .from('scraped_reviews')
        .delete({ count: 'exact' })
        .in('scraping_session_id', scrapingSessionIds)

      if (scrapedReviewsError) {
        console.error('Error deleting scraped reviews:', scrapedReviewsError)
      } else {
        deletedCounts.scraped_reviews = scrapedReviewsCount || 0
        console.log(`Deleted ${deletedCounts.scraped_reviews} scraped reviews`)
      }
    }

    // 步骤2: 删除 quotes
    if (themeIds.length > 0) {
      console.log('Deleting quotes...')
      const { count: quotesCount, error: quotesError } = await supabaseClient
        .from('quotes')
        .delete({ count: 'exact' })
        .in('theme_id', themeIds)

      if (quotesError) {
        console.error('Error deleting quotes:', quotesError)
      } else {
        deletedCounts.quotes = quotesCount || 0
        console.log(`Deleted ${deletedCounts.quotes} quotes`)
      }

      // 步骤3: 删除 suggestions
      console.log('Deleting suggestions...')
      const { count: suggestionsCount, error: suggestionsError } = await supabaseClient
        .from('suggestions')
        .delete({ count: 'exact' })
        .in('theme_id', themeIds)

      if (suggestionsError) {
        console.error('Error deleting suggestions:', suggestionsError)
      } else {
        deletedCounts.suggestions = suggestionsCount || 0
        console.log(`Deleted ${deletedCounts.suggestions} suggestions`)
      }
    }

    // 步骤4: 删除 themes
    if (reportIds.length > 0) {
      console.log('Deleting themes...')
      const { count: themesCount, error: themesDeleteError } = await supabaseClient
        .from('themes')
        .delete({ count: 'exact' })
        .in('report_id', reportIds)

      if (themesDeleteError) {
        console.error('Error deleting themes:', themesDeleteError)
      } else {
        deletedCounts.themes = themesCount || 0
        console.log(`Deleted ${deletedCounts.themes} themes`)
      }
    }

    // 步骤5: 删除 scraping_sessions
    if (reportIds.length > 0) {
      console.log('Deleting scraping sessions...')
      const { count: scrapingSessionsCount, error: scrapingSessionsDeleteError } = await supabaseClient
        .from('scraping_sessions')
        .delete({ count: 'exact' })
        .in('report_id', reportIds)

      if (scrapingSessionsDeleteError) {
        console.error('Error deleting scraping sessions:', scrapingSessionsDeleteError)
      } else {
        deletedCounts.scraping_sessions = scrapingSessionsCount || 0
        console.log(`Deleted ${deletedCounts.scraping_sessions} scraping sessions`)
      }
    }

    // 步骤6: 删除 reports
    console.log('Deleting reports...')
    const { count: reportsCount, error: reportsDeleteError } = await supabaseClient
      .from('reports')
      .delete({ count: 'exact' })
      .eq('user_id', userId)

    if (reportsDeleteError) {
      console.error('Error deleting reports:', reportsDeleteError)
    } else {
      deletedCounts.reports = reportsCount || 0
      console.log(`Deleted ${deletedCounts.reports} reports`)
    }

    const totalDeleted = Object.values(deletedCounts).reduce((sum, count) => sum + count, 0)

    console.log(`Data deletion completed for user ${userId}:`, deletedCounts)

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'All data deleted successfully',
        deletedCounts,
        totalDeleted,
        timestamp: new Date().toISOString()
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error in delete-all-data:', error)
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