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

// Platform limits for review fetching
const PLATFORM_LIMITS = {
  APP_STORE_LIMIT: 4000,
  GOOGLE_PLAY_LIMIT: 4000,
  REDDIT_LIMIT: 1000
}

// Batch configuration for analysis tasks
const BATCH_CONFIG = {
  BATCH_SIZE: 400, // Reviews per batch
  MAX_REVIEWS_PER_BATCH: 500 // Safety limit
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

    console.log(`🧠 Starting asynchronous analysis setup for report ${reportId}, app: ${appName}`)
    console.log(`📊 Data summary:`, scrapedDataSummary)
    console.log(`🎯 Platform limits: App Store=${PLATFORM_LIMITS.APP_STORE_LIMIT}, Google Play=${PLATFORM_LIMITS.GOOGLE_PLAY_LIMIT}, Reddit=${PLATFORM_LIMITS.REDDIT_LIMIT}`)

    // Start the analysis setup process
    EdgeRuntime.waitUntil(setupAsyncAnalysis(reportId, appName, scrapingSessionId, supabaseClient, scrapedDataSummary))

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Asynchronous analysis setup started',
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

async function setupAsyncAnalysis(
  reportId: string, 
  appName: string, 
  scrapingSessionId: string, 
  supabaseClient: any,
  scrapedDataSummary: any
) {
  try {
    console.log(`🔍 Setting up asynchronous analysis for ${appName}`)

    // Check if we have any data to analyze
    if (scrapedDataSummary.totalReviews === 0) {
      console.log('No reviews found, creating empty report')
      await createEmptyReport(reportId, appName, supabaseClient)
      await markReportCompleted(reportId, supabaseClient)
      return
    }

    // Fetch reviews with platform limits
    console.log(`📥 Fetching reviews from database with platform limits...`)
    const scrapedData = await fetchScrapedReviewsWithLimits(scrapingSessionId, supabaseClient)
    
    if (scrapedData.totalReviews === 0) {
      console.log('⚠️ No reviews found in database, creating empty report')
      await createEmptyReport(reportId, appName, supabaseClient)
      await markReportCompleted(reportId, supabaseClient)
      return
    }

    console.log(`📊 Total reviews to analyze: ${scrapedData.totalReviews} (with platform limits applied)`)
    console.log(`   - App Store: ${scrapedData.appStore.length} reviews (limit: ${PLATFORM_LIMITS.APP_STORE_LIMIT})`)
    console.log(`   - Google Play: ${scrapedData.googlePlay.length} reviews (limit: ${PLATFORM_LIMITS.GOOGLE_PLAY_LIMIT})`)
    console.log(`   - Reddit: ${scrapedData.reddit.length} posts (limit: ${PLATFORM_LIMITS.REDDIT_LIMIT})`)

    // Combine all reviews into a single array
    const allReviews = [
      ...scrapedData.appStore.map((r: any) => `[App Store] ${r.review_text}`),
      ...scrapedData.googlePlay.map((r: any) => `[Google Play] ${r.review_text}`),
      ...scrapedData.reddit.map((r: any) => `[Reddit] ${r.review_text}`)
    ]

    // Split reviews into batches
    const batches = []
    for (let i = 0; i < allReviews.length; i += BATCH_CONFIG.BATCH_SIZE) {
      batches.push(allReviews.slice(i, i + BATCH_CONFIG.BATCH_SIZE))
    }

    console.log(`📦 Split ${allReviews.length} reviews into ${batches.length} batches (${BATCH_CONFIG.BATCH_SIZE} reviews per batch)`)

    // Create analysis tasks for each batch
    const analysisTasksToCreate = batches.map((batchReviews, index) => ({
      report_id: reportId,
      scraping_session_id: scrapingSessionId,
      batch_index: index + 1,
      status: 'pending',
      reviews_data: batchReviews
    }))

    console.log(`💾 Creating ${analysisTasksToCreate.length} analysis tasks...`)

    const { data: createdTasks, error: createError } = await supabaseClient
      .from('analysis_tasks')
      .insert(analysisTasksToCreate)
      .select('id, batch_index')

    if (createError) {
      throw new Error(`Failed to create analysis tasks: ${createError.message}`)
    }

    console.log(`✅ Created ${createdTasks.length} analysis tasks`)

    // Update report status to processing
    await supabaseClient
      .from('reports')
      .update({ status: 'processing' })
      .eq('id', reportId)

    console.log(`🎯 Analysis setup completed. Tasks are ready for processing.`)
    console.log(`📋 Next steps: Use external cron job or webhook to trigger process-analysis-batch function`)

    // Trigger the first batch immediately to start the process
    if (createdTasks.length > 0) {
      console.log(`🚀 Triggering first batch processing...`)
      await triggerBatchProcessing(createdTasks[0].id)
    }

  } catch (error) {
    console.error(`❌ Error in async analysis setup for ${reportId}:`, error)
    
    // Update report status to error
    await supabaseClient
      .from('reports')
      .update({ status: 'error' })
      .eq('id', reportId)
  }
}

async function fetchScrapedReviewsWithLimits(scrapingSessionId: string, supabaseClient: any) {
  console.log(`📥 Fetching reviews for scraping session ${scrapingSessionId} with platform limits...`)
  
  const scrapedData = {
    appStore: [],
    googlePlay: [],
    reddit: [],
    totalReviews: 0
  }

  try {
    // Fetch App Store reviews with limit
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
      console.log(`✅ Fetched ${scrapedData.appStore.length} App Store reviews`)
    }

    // Fetch Google Play reviews with limit
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
      console.log(`✅ Fetched ${scrapedData.googlePlay.length} Google Play reviews`)
    }

    // Fetch Reddit posts with limit
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
      console.log(`✅ Fetched ${scrapedData.reddit.length} Reddit posts`)
    }

    scrapedData.totalReviews = scrapedData.appStore.length + scrapedData.googlePlay.length + scrapedData.reddit.length

    console.log(`📊 Fetched reviews with platform limits: ${scrapedData.totalReviews} total`)
    console.log(`   - App Store: ${scrapedData.appStore.length}/${PLATFORM_LIMITS.APP_STORE_LIMIT} reviews`)
    console.log(`   - Google Play: ${scrapedData.googlePlay.length}/${PLATFORM_LIMITS.GOOGLE_PLAY_LIMIT} reviews`)
    console.log(`   - Reddit: ${scrapedData.reddit.length}/${PLATFORM_LIMITS.REDDIT_LIMIT} posts`)
    
    return scrapedData

  } catch (error) {
    console.error('❌ Critical error in fetchScrapedReviewsWithLimits:', error)
    return scrapedData
  }
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

async function markReportCompleted(reportId: string, supabaseClient: any) {
  await supabaseClient
    .from('reports')
    .update({ 
      status: 'completed',
      completed_at: new Date().toISOString()
    })
    .eq('id', reportId)
}

async function triggerBatchProcessing(taskId: string) {
  try {
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-analysis-batch`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ taskId })
    })

    if (!response.ok) {
      console.error(`Failed to trigger batch processing: ${response.status}`)
    } else {
      console.log(`✅ Successfully triggered batch processing for task ${taskId}`)
    }
  } catch (error) {
    console.error('Error triggering batch processing:', error)
  }
}