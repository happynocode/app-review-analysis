import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface CompleteReportRequest {
  reportId: string
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

    const { reportId }: CompleteReportRequest = await req.json()

    if (!reportId) {
      return new Response(
        JSON.stringify({ error: 'Missing reportId' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log(`🎯 Starting final report assembly for ${reportId}`)

    try {
      // Start the completion process
      await completeReportAnalysis(reportId, supabaseClient)

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Report completion finished successfully',
          reportId
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    } catch (error) {
      // Handle specific duplicate processing errors
      if (error.message === 'ALREADY_COMPLETED' || error.message === 'ALREADY_PROCESSING') {
        return new Response(
          JSON.stringify({
            success: true,
            message: 'Report already completed or being processed',
            reportId,
            skipped: true
          }),
          {
            status: 409, // Conflict status
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
      }

      // Re-throw other errors to be handled by the outer catch block
      throw error
    }

  } catch (error) {
    console.error('Error in complete-report-analysis:', error)
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

async function completeReportAnalysis(reportId: string, supabaseClient: any) {
  const startTime = Date.now()

  try {
    console.log(`🔍 Assembling final report for ${reportId}`)

    // Get report information and check current status
    const { data: report, error: reportError } = await supabaseClient
      .from('reports')
      .select('app_name, status')
      .eq('id', reportId)
      .single()

    if (reportError || !report) {
      throw new Error('Failed to fetch report information')
    }

    // Check if report is already completed to prevent duplicate processing
    if (report.status === 'completed') {
      console.log(`⚠️ Report ${reportId} is already completed, skipping processing`)
      throw new Error('ALREADY_COMPLETED')
    }

    if (report.status === 'completing') {
      console.log(`⚠️ Report ${reportId} is already being completed, skipping processing`)
      throw new Error('ALREADY_PROCESSING')
    }

    // Atomically update status to 'completing' to prevent concurrent processing
    const { data: updateResult, error: statusUpdateError } = await supabaseClient
      .from('reports')
      .update({
        status: 'completing',
        updated_at: new Date().toISOString()
      })
      .eq('id', reportId)
      .eq('status', 'analyzing') // Only update if still in analyzing state
      .select()

    if (statusUpdateError) {
      console.log(`⚠️ Failed to update report status to 'completing': ${statusUpdateError.message}`)
      throw new Error('STATUS_UPDATE_FAILED')
    }

    if (!updateResult || updateResult.length === 0) {
      console.log(`⚠️ Report ${reportId} status was not 'analyzing', possibly already being processed`)
      throw new Error('ALREADY_PROCESSING')
    }

    // Get all completed themes analysis tasks for this report
    const { data: completedTasks, error: tasksError } = await supabaseClient
      .from('analysis_tasks')
      .select(`
        themes_data,
        batch_index
      `)
      .eq('report_id', reportId)
      .eq('analysis_type', 'themes')
      .eq('status', 'completed')
      .order('batch_index', { ascending: true })

    if (tasksError) {
      throw new Error(`Failed to fetch completed tasks: ${tasksError.message}`)
    }

    if (!completedTasks || completedTasks.length === 0) {
      throw new Error('No completed themes analysis tasks found')
    }

    console.log(`📊 Found ${completedTasks.length} completed themes analysis tasks`)

    // 按平台分组收集themes
    const platformThemes = {
      reddit_themes: [],
      app_store_themes: [],
      google_play_themes: []
    }

    // 从所有batch收集平台特定的themes
    for (const task of completedTasks) {
      if (task.themes_data) {
        // 新格式：平台分开的themes
        if (task.themes_data.reddit_themes) {
          platformThemes.reddit_themes.push(...task.themes_data.reddit_themes)
        }
        if (task.themes_data.app_store_themes) {
          platformThemes.app_store_themes.push(...task.themes_data.app_store_themes)
        }
        if (task.themes_data.google_play_themes) {
          platformThemes.google_play_themes.push(...task.themes_data.google_play_themes)
        }
        
        // 兼容旧格式：合并的themes（如果存在的话）
        if (task.themes_data.themes && Array.isArray(task.themes_data.themes)) {
          // 尝试根据platform字段分组旧格式的themes
          for (const theme of task.themes_data.themes) {
            if (theme.platform === 'reddit' || theme.source_platform === 'reddit') {
              platformThemes.reddit_themes.push(theme)
            } else if (theme.platform === 'app_store' || theme.source_platform === 'app_store') {
              platformThemes.app_store_themes.push(theme)
            } else if (theme.platform === 'google_play' || theme.source_platform === 'google_play') {
              platformThemes.google_play_themes.push(theme)
            } else {
              // 如果没有平台信息，跳过或分配到一个默认平台
              console.warn(`Theme without platform information: ${theme.title}`)
            }
          }
        }
      }
    }

    console.log(`📋 Aggregated themes by platform:`)
    console.log(`  - Reddit: ${platformThemes.reddit_themes.length} themes`)
    console.log(`  - App Store: ${platformThemes.app_store_themes.length} themes`)
    console.log(`  - Google Play: ${platformThemes.google_play_themes.length} themes`)

    // 分别处理每个平台的themes
    const finalPlatformThemes = {
      reddit_themes: [],
      app_store_themes: [],
      google_play_themes: []
    }

    // 处理Reddit themes
    if (platformThemes.reddit_themes.length > 0) {
      console.log(`🔴 Processing ${platformThemes.reddit_themes.length} Reddit themes`)
      finalPlatformThemes.reddit_themes = await processThemes(report.app_name, platformThemes.reddit_themes, 'reddit')
    }

    // 处理App Store themes  
    if (platformThemes.app_store_themes.length > 0) {
      console.log(`🍎 Processing ${platformThemes.app_store_themes.length} App Store themes`)
      finalPlatformThemes.app_store_themes = await processThemes(report.app_name, platformThemes.app_store_themes, 'app_store')
    }

    // 处理Google Play themes
    if (platformThemes.google_play_themes.length > 0) {
      console.log(`🤖 Processing ${platformThemes.google_play_themes.length} Google Play themes`)
      finalPlatformThemes.google_play_themes = await processThemes(report.app_name, platformThemes.google_play_themes, 'google_play')
    }

    console.log(`🎯 Final platform themes:`)
    console.log(`  - Reddit: ${finalPlatformThemes.reddit_themes.length} themes`)
    console.log(`  - App Store: ${finalPlatformThemes.app_store_themes.length} themes`)
    console.log(`  - Google Play: ${finalPlatformThemes.google_play_themes.length} themes`)

    // 分别保存每个平台的themes到数据库
    await savePlatformThemes(reportId, finalPlatformThemes, supabaseClient)

    // Mark report as completed
    console.log(`🔄 Attempting to mark report ${reportId} as completed...`)

    // First check current status
    const { data: currentReport, error: statusCheckError } = await supabaseClient
      .from('reports')
      .select('status')
      .eq('id', reportId)
      .single()

    if (statusCheckError) {
      console.error(`❌ Failed to check current report status: ${statusCheckError.message}`)
    } else {
      console.log(`📊 Current report status: ${currentReport.status}`)
    }

    const { data: completionUpdateResult, error: completionError } = await supabaseClient
      .from('reports')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', reportId)
      .eq('status', 'completing') // Only complete if in 'completing' state
      .select()

    if (completionError) {
      console.error(`❌ Failed to mark report as completed: ${completionError.message}`)
      console.error(`❌ Error details:`, completionError)
      throw new Error(`Failed to mark report as completed: ${completionError.message}`)
    }

    if (!completionUpdateResult || completionUpdateResult.length === 0) {
      console.warn(`⚠️ No rows were updated when marking report as completed. Current status might not be 'completing'.`)
      // Try to update regardless of current status
      const { data: forceUpdateResult, error: forceUpdateError } = await supabaseClient
        .from('reports')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', reportId)
        .select()

      if (forceUpdateError) {
        console.error(`❌ Force update also failed: ${forceUpdateError.message}`)
        throw new Error(`Failed to mark report as completed: ${forceUpdateError.message}`)
      } else {
        console.log(`✅ Force update successful: ${forceUpdateResult.length} rows updated`)
      }
    } else {
      console.log(`✅ Successfully marked report as completed: ${completionUpdateResult.length} rows updated`)
    }

    const totalTime = Date.now() - startTime
    const totalThemes = finalPlatformThemes.reddit_themes.length + 
                       finalPlatformThemes.app_store_themes.length + 
                       finalPlatformThemes.google_play_themes.length
    
    console.log(`✅ Report analysis completed in ${Math.round(totalTime / 1000)} seconds`)
    console.log(`📊 Total themes across all platforms: ${totalThemes}`)

    // Log completion metric
    await logSystemMetric(supabaseClient, 'report_completion_time', totalTime / 1000, 'seconds', {
      report_id: reportId,
      total_themes: totalThemes,
      reddit_themes: finalPlatformThemes.reddit_themes.length,
      app_store_themes: finalPlatformThemes.app_store_themes.length,
      google_play_themes: finalPlatformThemes.google_play_themes.length,
      status: 'success'
    })

  } catch (error) {
    console.error(`❌ Error completing report analysis for ${reportId}:`, error)

    // Handle different error types appropriately
    if (['ALREADY_COMPLETED', 'ALREADY_PROCESSING', 'STATUS_UPDATE_FAILED'].includes(error.message)) {
      // Don't mark as failed for duplicate processing errors
      console.log(`⚠️ Skipping status update for duplicate processing error: ${error.message}`)
    } else {
      // Mark report as failed for actual processing errors
      await supabaseClient
        .from('reports')
        .update({
          status: 'failed',
          error_message: error.message,
          updated_at: new Date().toISOString()
        })
        .eq('id', reportId)
        .eq('status', 'completing') // Only update if still in completing state

      // Log failure metric
      await logSystemMetric(supabaseClient, 'report_completion_failures', 1, 'count', {
        report_id: reportId,
        error: error.message
      })
    }

    throw error
  }
}

async function processThemes(appName: string, allThemes: any[], platform?: string) {
  const platformName = platform ? ` on platform ${platform}` : ''
  console.log(`🔄 Processing ${allThemes.length} themes for ${appName}${platformName}`)

  if (allThemes.length === 0) {
    return [{
      title: "Analysis Completed",
      description: "Analysis was completed but no significant themes were identified from the available reviews.",
      quotes: [],
      suggestions: ["Review the source data quality", "Consider expanding the review collection scope"]
    }]
  }

  // Use enhanced rule-based merging for all theme sets
  console.log(`📊 Processing ${allThemes.length} themes using enhanced rule-based merging`)
  return ruleBasedMerge(allThemes)
}

async function processSentiment(sentimentBatches: any[]) {
  console.log(`🔄 Processing ${sentimentBatches.length} sentiment batches`)

  if (sentimentBatches.length === 0) {
    return {
      positive: { count: 0, percentage: 0, examples: [] },
      neutral: { count: 0, percentage: 0, examples: [] },
      negative: { count: 0, percentage: 0, examples: [] }
    }
  }

  // Aggregate sentiment data from all batches
  const aggregated = {
    positive: { count: 0, examples: [] },
    neutral: { count: 0, examples: [] },
    negative: { count: 0, examples: [] }
  }

  for (const batch of sentimentBatches) {
    if (batch.sentiment) {
      aggregated.positive.count += batch.sentiment.positive?.count || 0
      aggregated.neutral.count += batch.sentiment.neutral?.count || 0
      aggregated.negative.count += batch.sentiment.negative?.count || 0

      if (batch.sentiment.positive?.examples) {
        aggregated.positive.examples.push(...batch.sentiment.positive.examples)
      }
      if (batch.sentiment.neutral?.examples) {
        aggregated.neutral.examples.push(...batch.sentiment.neutral.examples)
      }
      if (batch.sentiment.negative?.examples) {
        aggregated.negative.examples.push(...batch.sentiment.negative.examples)
      }
    }
  }

  const total = aggregated.positive.count + aggregated.neutral.count + aggregated.negative.count

  return {
    positive: {
      count: aggregated.positive.count,
      percentage: total > 0 ? Math.round((aggregated.positive.count / total) * 100) : 0,
      examples: aggregated.positive.examples.slice(0, 5)
    },
    neutral: {
      count: aggregated.neutral.count,
      percentage: total > 0 ? Math.round((aggregated.neutral.count / total) * 100) : 0,
      examples: aggregated.neutral.examples.slice(0, 5)
    },
    negative: {
      count: aggregated.negative.count,
      percentage: total > 0 ? Math.round((aggregated.negative.count / total) * 100) : 0,
      examples: aggregated.negative.examples.slice(0, 5)
    }
  }
}

async function processKeywords(allKeywords: any[]) {
  console.log(`🔄 Processing ${allKeywords.length} keywords`)

  if (allKeywords.length === 0) {
    return []
  }

  // Group keywords by keyword text and aggregate frequency
  const keywordMap = new Map()

  for (const keyword of allKeywords) {
    const key = keyword.keyword?.toLowerCase()
    if (key) {
      if (keywordMap.has(key)) {
        const existing = keywordMap.get(key)
        existing.frequency += keyword.frequency || 1
        existing.examples.push(...(keyword.examples || []))
      } else {
        keywordMap.set(key, {
          keyword: keyword.keyword,
          frequency: keyword.frequency || 1,
          context: keyword.context || 'neutral',
          examples: keyword.examples || []
        })
      }
    }
  }

  // Convert to array and sort by frequency
  return Array.from(keywordMap.values())
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 30) // Top 30 keywords
    .map(keyword => ({
      ...keyword,
      examples: keyword.examples.slice(0, 3) // Limit examples
    }))
}

async function processIssues(allIssues: any[]) {
  console.log(`🔄 Processing ${allIssues.length} issues`)

  if (allIssues.length === 0) {
    return []
  }

  // Group similar issues and aggregate frequency
  const issueMap = new Map()

  for (const issue of allIssues) {
    const key = issue.title?.toLowerCase()
    if (key) {
      if (issueMap.has(key)) {
        const existing = issueMap.get(key)
        existing.frequency += issue.frequency || 1
        existing.quotes.push(...(issue.quotes || []))
        existing.suggestions.push(...(issue.suggestions || []))
      } else {
        issueMap.set(key, {
          title: issue.title,
          description: issue.description,
          severity: issue.severity || 'medium',
          frequency: issue.frequency || 1,
          quotes: issue.quotes || [],
          suggestions: issue.suggestions || []
        })
      }
    }
  }

  // Convert to array and sort by severity and frequency
  const severityOrder = { high: 3, medium: 2, low: 1 }
  
  return Array.from(issueMap.values())
    .sort((a, b) => {
      const severityDiff = (severityOrder[b.severity] || 2) - (severityOrder[a.severity] || 2)
      if (severityDiff !== 0) return severityDiff
      return b.frequency - a.frequency
    })
    .slice(0, 20) // Top 20 issues
    .map(issue => ({
      ...issue,
      quotes: issue.quotes.slice(0, 3), // Limit quotes
      suggestions: [...new Set(issue.suggestions)].slice(0, 3) // Dedupe and limit suggestions
    }))
}



function ruleBasedMerge(allThemes: any[]) {
  console.log(`🔧 Using enhanced rule-based merge for ${allThemes.length} themes`)

  // Step 0: Pre-filter and clean themes
  const cleanedThemes = allThemes
    .filter(theme => theme && theme.title && theme.title.trim().length > 0)
    .map(theme => ({
      ...theme,
      title: theme.title.trim(),
      description: theme.description?.trim() || 'No description available',
      quotes: Array.isArray(theme.quotes) ? theme.quotes.filter(q => q && q.trim().length > 0) : [],
      suggestions: Array.isArray(theme.suggestions) ? theme.suggestions.filter(s => s && s.trim().length > 0) : []
    }))

  console.log(`🧹 Cleaned themes: ${allThemes.length} → ${cleanedThemes.length}`)

  // Step 1: Advanced grouping with multiple similarity checks
  const themeGroups = []
  const processed = new Set()

  for (let i = 0; i < cleanedThemes.length; i++) {
    if (processed.has(i)) continue

    const currentTheme = cleanedThemes[i]
    const group = {
      themes: [currentTheme],
      indices: [i],
      primaryTitle: currentTheme.title
    }

    // Find similar themes using multiple criteria
    for (let j = i + 1; j < cleanedThemes.length; j++) {
      if (processed.has(j)) continue

      const otherTheme = cleanedThemes[j]

      if (areThemesAdvancedSimilar(currentTheme, otherTheme)) {
        group.themes.push(otherTheme)
        group.indices.push(j)
        processed.add(j)
      }
    }

    themeGroups.push(group)
    processed.add(i)
  }

  console.log(`📊 Advanced grouping: ${cleanedThemes.length} themes → ${themeGroups.length} groups`)

  // Step 1.5: Second pass - merge groups that are similar to each other
  const finalGroups = mergeRelatedGroups(themeGroups)
  console.log(`🔗 Group consolidation: ${themeGroups.length} groups → ${finalGroups.length} groups`)

  // Step 2: Merge themes within each group
  const mergedThemes = finalGroups.map(group => {
    if (group.themes.length === 1) {
      // Single theme - just clean it up
      const theme = group.themes[0]
      return {
        title: theme.title,
        description: theme.description || 'No description available',
        quotes: Array.isArray(theme.quotes) ? theme.quotes.slice(0, 5) : [],
        suggestions: Array.isArray(theme.suggestions) ? theme.suggestions.slice(0, 5) : [],
        importance_score: calculateImportanceScore(theme)
      }
    } else {
      // Multiple themes - merge them intelligently
      return mergeThemeGroup(group.themes)
    }
  })

  // Step 3: Final deduplication pass (catch any remaining duplicates)
  const dedupedThemes = performFinalDeduplication(mergedThemes)
  console.log(`🔍 Final deduplication: ${mergedThemes.length} → ${dedupedThemes.length} themes`)

  // Step 4: Sort by importance and limit to 50
  const finalThemes = dedupedThemes
    .filter((theme: any) => theme && theme.title && theme.title.length > 0)
    .sort((a: any, b: any) => (b.importance_score || 0) - (a.importance_score || 0))
    .slice(0, 50)
    .map((theme: any) => ({
      title: theme.title,
      description: theme.description,
      quotes: theme.quotes || [],
      suggestions: theme.suggestions || []
    }))

  console.log(`✅ Enhanced rule-based merge completed: ${finalThemes.length} final themes`)
  console.log(`📊 Deduplication summary: ${allThemes.length} input → ${finalThemes.length} output (${((1 - finalThemes.length / allThemes.length) * 100).toFixed(1)}% reduction)`)
  return finalThemes
}

// Enhanced similarity detection that considers multiple factors
function areThemesAdvancedSimilar(theme1: any, theme2: any): boolean {
  if (!theme1?.title || !theme2?.title) return false

  // First check title similarity
  const titleSimilarity = calculateTitleSimilarity(theme1.title, theme2.title)
  if (titleSimilarity >= 0.8) return true // High title similarity

  // If moderate title similarity, check content overlap
  if (titleSimilarity >= 0.5) {
    const contentSimilarity = calculateContentSimilarity(theme1, theme2)
    if (contentSimilarity >= 0.6) return true
  }

  // Check for semantic similarity (common patterns)
  if (areThemesSemanticallySimilar(theme1.title, theme2.title)) return true

  return false
}

// Calculate title similarity with multiple methods
function calculateTitleSimilarity(title1: string, title2: string): number {
  const normalize = (str: string) => str.toLowerCase().trim()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const norm1 = normalize(title1)
  const norm2 = normalize(title2)

  // Exact match
  if (norm1 === norm2) return 1.0

  // Substring match (with length consideration)
  if (norm1.length >= 5 && norm2.length >= 5) {
    if (norm1.includes(norm2) || norm2.includes(norm1)) {
      const shorter = Math.min(norm1.length, norm2.length)
      const longer = Math.max(norm1.length, norm2.length)
      return shorter / longer // Penalize length differences
    }
  }

  // Word overlap similarity (Jaccard index)
  const words1 = new Set(norm1.split(' ').filter(w => w.length > 2))
  const words2 = new Set(norm2.split(' ').filter(w => w.length > 2))

  if (words1.size === 0 || words2.size === 0) return 0

  const intersection = new Set([...words1].filter(w => words2.has(w)))
  const union = new Set([...words1, ...words2])

  return intersection.size / union.size
}

// Check content similarity based on quotes and descriptions
function calculateContentSimilarity(theme1: any, theme2: any): number {
  let similarity = 0
  let factors = 0

  // Compare descriptions
  if (theme1.description && theme2.description) {
    const descSim = calculateTitleSimilarity(theme1.description, theme2.description)
    similarity += descSim
    factors++
  }

  // Compare quotes overlap
  if (theme1.quotes?.length > 0 && theme2.quotes?.length > 0) {
    const quotes1 = new Set(theme1.quotes.map(q => q.toLowerCase().trim()))
    const quotes2 = new Set(theme2.quotes.map(q => q.toLowerCase().trim()))

    const commonQuotes = new Set([...quotes1].filter(q => quotes2.has(q)))
    const totalQuotes = new Set([...quotes1, ...quotes2])

    if (totalQuotes.size > 0) {
      similarity += commonQuotes.size / totalQuotes.size
      factors++
    }
  }

  return factors > 0 ? similarity / factors : 0
}

// Check for semantic similarity using common patterns
function areThemesSemanticallySimilar(title1: string, title2: string): boolean {
  const patterns = [
    // Performance/Speed related
    ['performance', 'speed', 'slow', 'fast', 'lag', 'optimization'],
    // UI/UX related
    ['interface', 'design', 'ui', 'ux', 'layout', 'visual'],
    // Bug/Error related
    ['bug', 'error', 'crash', 'issue', 'problem', 'glitch'],
    // Feature requests
    ['feature', 'request', 'add', 'need', 'want', 'missing'],
    // Pricing/Cost related
    ['price', 'cost', 'expensive', 'cheap', 'subscription', 'payment'],
    // Support/Help related
    ['support', 'help', 'customer', 'service', 'response'],
    // Security/Privacy related
    ['security', 'privacy', 'safe', 'protection', 'data'],
    // Integration/Compatibility
    ['integration', 'compatibility', 'sync', 'connect', 'api']
  ]

  const norm1 = title1.toLowerCase()
  const norm2 = title2.toLowerCase()

  for (const pattern of patterns) {
    const matches1 = pattern.filter(word => norm1.includes(word)).length
    const matches2 = pattern.filter(word => norm2.includes(word)).length

    // If both titles have words from the same semantic category
    if (matches1 > 0 && matches2 > 0) {
      return true
    }
  }

  return false
}

// Legacy function for backward compatibility
function areThemesSimilar(title1: string, title2: string): boolean {
  return calculateTitleSimilarity(title1, title2) >= 0.7
}

// Merge groups that are similar to each other (second-level deduplication)
function mergeRelatedGroups(groups: any[]): any[] {
  const finalGroups = []
  const processed = new Set()

  for (let i = 0; i < groups.length; i++) {
    if (processed.has(i)) continue

    const currentGroup = groups[i]
    const mergedGroup = {
      themes: [...currentGroup.themes],
      indices: [...currentGroup.indices],
      primaryTitle: currentGroup.primaryTitle
    }

    // Look for other groups to merge with this one
    for (let j = i + 1; j < groups.length; j++) {
      if (processed.has(j)) continue

      const otherGroup = groups[j]

      // Check if groups should be merged
      if (shouldMergeGroups(currentGroup, otherGroup)) {
        mergedGroup.themes.push(...otherGroup.themes)
        mergedGroup.indices.push(...otherGroup.indices)
        processed.add(j)
      }
    }

    finalGroups.push(mergedGroup)
    processed.add(i)
  }

  return finalGroups
}

// Determine if two groups should be merged
function shouldMergeGroups(group1: any, group2: any): boolean {
  // Check if primary titles are similar
  const titleSim = calculateTitleSimilarity(group1.primaryTitle, group2.primaryTitle)
  if (titleSim >= 0.6) return true

  // Check if any theme in group1 is similar to any theme in group2
  for (const theme1 of group1.themes) {
    for (const theme2 of group2.themes) {
      if (areThemesAdvancedSimilar(theme1, theme2)) {
        return true
      }
    }
  }

  return false
}

// Enhanced theme group merging with better deduplication
function mergeThemeGroup(themes: any[]): any {
  if (themes.length === 0) return null

  // Choose the best title using multiple criteria
  const bestTitle = selectBestTitle(themes)

  // Combine descriptions intelligently
  const bestDescription = selectBestDescription(themes)

  // Advanced quote deduplication and selection
  const uniqueQuotes = deduplicateQuotes(themes)

  // Advanced suggestion deduplication and selection
  const uniqueSuggestions = deduplicateSuggestions(themes)

  const mergedTheme = {
    title: bestTitle,
    description: bestDescription,
    quotes: uniqueQuotes.slice(0, 10), // Increased limit for better coverage
    suggestions: uniqueSuggestions.slice(0, 8), // Increased limit
    importance_score: themes.reduce((sum, theme) => sum + calculateImportanceScore(theme), 0),
    merged_count: themes.length // Track how many themes were merged
  }

  console.log(`🔗 Merged ${themes.length} themes into: "${bestTitle}" (${mergedTheme.quotes.length} quotes, ${mergedTheme.suggestions.length} suggestions)`)
  return mergedTheme
}

// Select the best title from a group of themes
function selectBestTitle(themes: any[]): string {
  const titles = themes
    .map(t => t.title)
    .filter(title => title && title.trim().length > 0)

  if (titles.length === 0) return 'Untitled Theme'
  if (titles.length === 1) return titles[0]

  // Score titles based on multiple criteria
  const scoredTitles = titles.map(title => ({
    title,
    score: scoreTitleQuality(title, titles)
  }))

  return scoredTitles.sort((a, b) => b.score - a.score)[0].title
}

// Score title quality for selection
function scoreTitleQuality(title: string, allTitles: string[]): number {
  let score = 0

  // Prefer titles that are not too short or too long
  const length = title.length
  if (length >= 10 && length <= 50) score += 2
  else if (length >= 5 && length <= 80) score += 1

  // Prefer titles with meaningful words (not just generic terms)
  const meaningfulWords = ['issue', 'problem', 'feature', 'bug', 'performance', 'design', 'user', 'interface']
  const titleLower = title.toLowerCase()
  meaningfulWords.forEach(word => {
    if (titleLower.includes(word)) score += 1
  })

  // Prefer titles that are more specific (contain more unique words)
  const words = title.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  score += Math.min(words.length, 5) * 0.5

  // Penalize very generic titles
  const genericTerms = ['general', 'misc', 'other', 'various', 'multiple']
  genericTerms.forEach(term => {
    if (titleLower.includes(term)) score -= 2
  })

  return score
}

// Select the best description
function selectBestDescription(themes: any[]): string {
  const descriptions = themes
    .map(t => t.description)
    .filter(desc => desc && desc.trim().length > 10)

  if (descriptions.length === 0) return 'No description available'

  // Prefer longer, more detailed descriptions
  return descriptions.sort((a, b) => b.length - a.length)[0]
}

// Advanced quote deduplication
function deduplicateQuotes(themes: any[]): string[] {
  const quotesMap = new Map() // Use Map to track quote frequency

  themes.forEach(theme => {
    if (Array.isArray(theme.quotes)) {
      theme.quotes.forEach(quote => {
        if (quote && typeof quote === 'string' && quote.length > 10 && quote.length < 1000) {
          const trimmedQuote = quote.trim()

          // Skip AI-generated looking quotes
          if (isUserGeneratedQuote(trimmedQuote)) {
            const normalizedQuote = normalizeQuoteForDedup(trimmedQuote)

            if (!quotesMap.has(normalizedQuote)) {
              quotesMap.set(normalizedQuote, {
                original: trimmedQuote,
                count: 1,
                length: trimmedQuote.length
              })
            } else {
              const existing = quotesMap.get(normalizedQuote)
              existing.count++
              // Keep the longer version if it's more detailed
              if (trimmedQuote.length > existing.length) {
                existing.original = trimmedQuote
                existing.length = trimmedQuote.length
              }
            }
          }
        }
      })
    }
  })

  // Sort by frequency and quality, then return the original quotes
  return Array.from(quotesMap.values())
    .sort((a, b) => {
      // First by frequency (more common = more important)
      if (b.count !== a.count) return b.count - a.count
      // Then by length (more detailed = better)
      return b.length - a.length
    })
    .map(item => item.original)
}

// Check if a quote looks like user-generated content
function isUserGeneratedQuote(quote: string): boolean {
  const aiPatterns = [
    /^(Users|Many users|Several users|Some users) (report|mention|state|indicate)/i,
    /analysis shows/i,
    /feedback indicates/i,
    /according to (users|reviews|feedback)/i,
    /commonly reported/i,
    /frequently mentioned/i
  ]

  return !aiPatterns.some(pattern => pattern.test(quote))
}

// Normalize quote for deduplication (remove minor variations)
function normalizeQuoteForDedup(quote: string): string {
  return quote
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
}

// Advanced suggestion deduplication
function deduplicateSuggestions(themes: any[]): string[] {
  const suggestionsMap = new Map()

  themes.forEach(theme => {
    if (Array.isArray(theme.suggestions)) {
      theme.suggestions.forEach(suggestion => {
        if (suggestion && suggestion.length > 5) {
          const trimmedSuggestion = suggestion.trim()
          const normalizedSuggestion = normalizeSuggestionForDedup(trimmedSuggestion)

          if (!suggestionsMap.has(normalizedSuggestion)) {
            suggestionsMap.set(normalizedSuggestion, {
              original: trimmedSuggestion,
              count: 1,
              length: trimmedSuggestion.length
            })
          } else {
            const existing = suggestionsMap.get(normalizedSuggestion)
            existing.count++
            // Keep the more detailed version
            if (trimmedSuggestion.length > existing.length) {
              existing.original = trimmedSuggestion
              existing.length = trimmedSuggestion.length
            }
          }
        }
      })
    }
  })

  return Array.from(suggestionsMap.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return b.length - a.length
    })
    .map(item => item.original)
}

// Normalize suggestion for deduplication
function normalizeSuggestionForDedup(suggestion: string): string {
  return suggestion
    .toLowerCase()
    .replace(/^(add|implement|create|develop|improve|fix|update|enhance)\s+/i, '') // Remove action verbs
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Final deduplication pass to catch any remaining duplicates
function performFinalDeduplication(themes: any[]): any[] {
  const finalThemes: any[] = []
  const seenTitles = new Set<string>()

  for (const theme of themes) {
    if (!theme || !theme.title) continue

    const normalizedTitle = theme.title.toLowerCase().trim()
    let isDuplicate = false

    // Check against all previously seen titles
    for (const seenTitle of seenTitles) {
      if (calculateTitleSimilarity(normalizedTitle, seenTitle as string) >= 0.85) {
        isDuplicate = true
        console.log(`🔍 Final dedup: Skipping "${theme.title}" (similar to existing theme)`)
        break
      }
    }

    if (!isDuplicate) {
      finalThemes.push(theme)
      seenTitles.add(normalizedTitle)
    }
  }

  return finalThemes
}

// Helper function to calculate importance score for a theme
function calculateImportanceScore(theme: any): number {
  let score = 0
  
  // Score based on number of quotes (main indicator of theme importance)
  score += (theme.quotes?.length || 0) * 3
  
  // Score based on number of suggestions
  score += (theme.suggestions?.length || 0) * 2
  
  // Score based on title length (longer titles might be more specific/important)
  if (theme.title) {
    score += Math.min(theme.title.length / 10, 5)
  }
  
  // Score based on description quality
  if (theme.description && theme.description.length > 20) {
    score += 2
  }
  
  return score
}

async function logSystemMetric(
  supabaseClient: any, 
  metricName: string, 
  metricValue: number, 
  metricUnit: string, 
  tags: any = {}
) {
  try {
    await supabaseClient
      .from('system_metrics')
      .insert({
        metric_type: metricName,
        metric_value: metricValue,
        metric_unit: metricUnit,
        details: tags,
        created_at: new Date().toISOString()
      })
  } catch (error) {
    console.warn('Failed to log system metric:', error)
  }
}

async function savePlatformThemes(reportId: string, platformThemes: any, supabaseClient: any) {
  try {
    const totalThemes = (platformThemes.reddit_themes?.length || 0) + 
                       (platformThemes.app_store_themes?.length || 0) + 
                       (platformThemes.google_play_themes?.length || 0)
                       
    console.log(`💾 Saving ${totalThemes} themes across all platforms for report ${reportId}`)

    if (totalThemes === 0) {
      console.log('⚠️ No themes to save')
      return
    }

    // First, delete existing themes for this report
    const { error: deleteError } = await supabaseClient
      .from('themes')
      .delete()
      .eq('report_id', reportId)

    if (deleteError) {
      console.warn('Warning deleting existing themes:', deleteError)
    }

    // Prepare theme inserts with platform information
    const themeInserts = []
    let index = 0

    // Add Reddit themes
    if (platformThemes.reddit_themes && platformThemes.reddit_themes.length > 0) {
      for (const theme of platformThemes.reddit_themes) {
        themeInserts.push({
          report_id: reportId,
          title: theme.title || `Reddit Theme ${index + 1}`,
          description: theme.description || 'No description available',
          platform: 'reddit',
          created_at: new Date().toISOString()
        })
        index++
      }
    }

    // Add App Store themes
    if (platformThemes.app_store_themes && platformThemes.app_store_themes.length > 0) {
      for (const theme of platformThemes.app_store_themes) {
        themeInserts.push({
          report_id: reportId,
          title: theme.title || `App Store Theme ${index + 1}`,
          description: theme.description || 'No description available',
          platform: 'app_store',
          created_at: new Date().toISOString()
        })
        index++
      }
    }

    // Add Google Play themes
    if (platformThemes.google_play_themes && platformThemes.google_play_themes.length > 0) {
      for (const theme of platformThemes.google_play_themes) {
        themeInserts.push({
          report_id: reportId,
          title: theme.title || `Google Play Theme ${index + 1}`,
          description: theme.description || 'No description available',
          platform: 'google_play',
          created_at: new Date().toISOString()
        })
        index++
      }
    }

    if (themeInserts.length === 0) {
      console.log('⚠️ No theme inserts prepared')
      return
    }

    // Save to themes table
    const { data: insertedThemes, error: themesError } = await supabaseClient
      .from('themes')
      .insert(themeInserts)
      .select('id, title, platform')

    if (themesError) {
      console.error('Error saving themes:', themesError)
      throw new Error(`Failed to save themes: ${themesError.message}`)
    }

    console.log(`✅ Saved ${themeInserts.length} themes`)
    console.log(`  - Reddit: ${platformThemes.reddit_themes?.length || 0} themes`)
    console.log(`  - App Store: ${platformThemes.app_store_themes?.length || 0} themes`)
    console.log(`  - Google Play: ${platformThemes.google_play_themes?.length || 0} themes`)

    // Save quotes and suggestions for each platform
    await savePlatformQuotesAndSuggestions(insertedThemes, platformThemes, supabaseClient)

  } catch (error) {
    console.error('Error in savePlatformThemes:', error)
    throw error
  }
}

async function savePlatformQuotesAndSuggestions(insertedThemes: any[], platformThemes: any, supabaseClient: any) {
  try {
    const quoteInserts = []
    const suggestionInserts = []

    // Map themes by title and platform for lookup
    const themeMap = new Map()
    for (const theme of insertedThemes) {
      const key = `${theme.title}_${theme.platform}`
      themeMap.set(key, theme.id)
    }

    // Process each platform
    const platforms = [
      { key: 'reddit_themes', platform: 'reddit' },
      { key: 'app_store_themes', platform: 'app_store' },
      { key: 'google_play_themes', platform: 'google_play' }
    ]

    for (const { key, platform } of platforms) {
      const themes = platformThemes[key] || []
      
      for (const theme of themes) {
        const themeKey = `${theme.title}_${platform}`
        const themeId = themeMap.get(themeKey)
        
        if (!themeId) {
          console.warn(`Could not find theme ID for ${themeKey}`)
          continue
        }

        // Add quotes
        if (Array.isArray(theme.quotes)) {
          for (const quote of theme.quotes) {
            if (quote && typeof quote === 'string' && quote.trim().length > 0) {
              quoteInserts.push({
                theme_id: themeId,
                text: quote.trim(),
                source: platform,
                review_date: new Date().toISOString().split('T')[0], // Today's date as fallback
                created_at: new Date().toISOString()
              })
            }
          }
        }

        // Add suggestions
        if (Array.isArray(theme.suggestions)) {
          for (const suggestion of theme.suggestions) {
            if (suggestion && typeof suggestion === 'string' && suggestion.trim().length > 0) {
              suggestionInserts.push({
                theme_id: themeId,
                text: suggestion.trim(),
                created_at: new Date().toISOString()
              })
            }
          }
        }
      }
    }

    // Batch insert quotes
    if (quoteInserts.length > 0) {
      const { error: quotesError } = await supabaseClient
        .from('quotes')
        .insert(quoteInserts)

      if (quotesError) {
        console.error('Error saving quotes:', quotesError)
      } else {
        console.log(`✅ Saved ${quoteInserts.length} quotes`)
      }
    }

    // Batch insert suggestions
    if (suggestionInserts.length > 0) {
      const { error: suggestionsError } = await supabaseClient
        .from('suggestions')
        .insert(suggestionInserts)

      if (suggestionsError) {
        console.error('Error saving suggestions:', suggestionsError)
      } else {
        console.log(`✅ Saved ${suggestionInserts.length} suggestions`)
      }
    }

  } catch (error) {
    console.error('Error saving quotes and suggestions:', error)
  }
}