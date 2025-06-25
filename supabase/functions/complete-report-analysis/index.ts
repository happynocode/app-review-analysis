import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const { error: completionError } = await supabaseClient
      .from('reports')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', reportId)
      .eq('status', 'completing') // Only complete if in 'completing' state

    if (completionError) {
      console.error(`❌ Failed to mark report as completed: ${completionError.message}`)
      throw new Error(`Failed to mark report as completed: ${completionError.message}`)
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

  // Use intelligent merging with DeepSeek if we have many themes
  if (allThemes.length > 50) {
    console.log(`📊 Large theme set detected (${allThemes.length}), using DeepSeek for intelligent merging`)
    return await intelligentMergeWithDeepSeek(appName, allThemes)
  } else {
    console.log(`📊 Moderate theme set (${allThemes.length}), using rule-based merging`)
    return ruleBasedMerge(allThemes)
  }
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

async function intelligentMergeWithDeepSeek(appName: string, allThemes: any[]) {
  const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY')
  
  if (!deepseekApiKey) {
    console.log('⚠️ DeepSeek API key not available, falling back to rule-based merge')
    return ruleBasedMerge(allThemes)
  }

  try {
    // Limit themes for API call
    const limitedThemes = allThemes.slice(0, 80) // Limit to prevent token overflow

    // Extract all original quotes for validation
    const originalQuotes = new Set()
    limitedThemes.forEach(theme => {
      if (Array.isArray(theme.quotes)) {
        theme.quotes.forEach(quote => {
          if (quote && typeof quote === 'string') {
            originalQuotes.add(quote.trim())
          }
        })
      }
    })

    const prompt = `Merge and deduplicate these themes for "${appName}". Return between 30-50 final themes based on what makes most sense for the data quality and diversity.

Input themes (${limitedThemes.length}):
${JSON.stringify(limitedThemes, null, 2)}

CRITICAL INSTRUCTIONS:
1. Merge similar themes together
2. Remove duplicates
3. Prioritize themes by importance and frequency
4. Ensure each final theme is distinct and meaningful
5. ONLY use quotes that exist in the input themes - DO NOT generate new quotes
6. When merging themes, combine the existing quotes from the input themes
7. Return 30-50 themes based on data quality - use your judgment to determine the optimal number

QUOTE HANDLING RULES:
- NEVER create, modify, or paraphrase quotes
- ONLY select from the exact quotes provided in the input themes
- When merging themes, combine the original quotes from those themes
- If no suitable quotes exist in input, use empty quotes array []
- Quotes must be verbatim from user reviews, not AI-generated summaries

Return JSON only:
{
  "themes": [
    {
      "title": "Clear theme title (2-5 words)",
      "description": "Detailed description (2-3 sentences)",
      "quotes": ["Exact quote from input themes only", "Another exact quote from input themes only"],
      "suggestions": ["Actionable suggestion 1", "Actionable suggestion 2"]
    }
  ]
}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 120000) // 2 minute timeout

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        max_tokens: 4000,
        temperature: 0.7,
      }),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      throw new Error('No content in DeepSeek response')
    }

    // Clean the content by removing markdown code blocks and other formatting
    let cleanContent = content.trim()
    
    // Remove ```json and ``` markers
    cleanContent = cleanContent.replace(/^```json\s*/i, '')
    cleanContent = cleanContent.replace(/```\s*$/, '')
    
    // Remove any leading/trailing whitespace and non-JSON content
    cleanContent = cleanContent.trim()
    
    // Find JSON content between { and }
    const jsonStart = cleanContent.indexOf('{')
    const jsonEnd = cleanContent.lastIndexOf('}')
    
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      cleanContent = cleanContent.slice(jsonStart, jsonEnd + 1)
    }
    
    console.log('🧹 Cleaned DeepSeek response for JSON parsing')
    
    const result = JSON.parse(cleanContent)
    if (result.themes && Array.isArray(result.themes)) {
      // VALIDATE QUOTES: Ensure all quotes exist in original input
      let invalidQuotesCount = 0
      const validatedThemes = result.themes.map(theme => {
        if (Array.isArray(theme.quotes)) {
          const validQuotes = theme.quotes.filter(quote => {
            const isValid = originalQuotes.has(quote?.trim())
            if (!isValid && quote) {
              invalidQuotesCount++
              console.warn(`🚨 Invalid quote detected (not in original): "${quote.substring(0, 100)}..."`)
            }
            return isValid
          })
          return {
            ...theme,
            quotes: validQuotes
          }
        }
        return theme
      })

      if (invalidQuotesCount > 0) {
        console.warn(`⚠️ Removed ${invalidQuotesCount} invalid quotes that were not in original input`)
      }

      console.log(`✅ DeepSeek merge successful: ${validatedThemes.length} final themes`)
      console.log(`🔍 Quote validation: Original had ${originalQuotes.size} unique quotes`)
      return validatedThemes
    } else {
      throw new Error('Invalid themes format in API response')
    }

  } catch (error) {
    console.error('DeepSeek merge failed:', error)
    console.log('🔄 Falling back to rule-based merge')
    return ruleBasedMerge(allThemes)
  }
}

function ruleBasedMerge(allThemes: any[]) {
  console.log(`🔧 Using enhanced rule-based merge for ${allThemes.length} themes`)

  // Step 1: Group similar themes based on title similarity
  const themeGroups = []
  const processed = new Set()

  for (let i = 0; i < allThemes.length; i++) {
    if (processed.has(i)) continue
    
    const currentTheme = allThemes[i]
    if (!currentTheme.title) continue
    
    const group = {
      themes: [currentTheme],
      indices: [i]
    }
    
    // Find similar themes to merge
    for (let j = i + 1; j < allThemes.length; j++) {
      if (processed.has(j)) continue
      
      const otherTheme = allThemes[j]
      if (!otherTheme.title) continue
      
      if (areThemesSimilar(currentTheme.title, otherTheme.title)) {
        group.themes.push(otherTheme)
        group.indices.push(j)
        processed.add(j)
      }
    }
    
    themeGroups.push(group)
    processed.add(i)
  }

  console.log(`📊 Grouped ${allThemes.length} themes into ${themeGroups.length} groups`)

  // Step 2: Merge themes within each group
  const mergedThemes = themeGroups.map(group => {
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

  // Step 3: Sort by importance and limit to 50
  const finalThemes = mergedThemes
    .filter(theme => theme.title && theme.title.length > 0)
    .sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0))
    .slice(0, 50)
    .map(theme => ({
      title: theme.title,
      description: theme.description,
      quotes: theme.quotes,
      suggestions: theme.suggestions
    }))

  console.log(`✅ Rule-based merge completed: ${finalThemes.length} final themes`)
  return finalThemes
}

// Helper function to check if two theme titles are similar
function areThemesSimilar(title1: string, title2: string): boolean {
  if (!title1 || !title2) return false
  
  const normalize = (str: string) => str.toLowerCase().trim()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  
  const norm1 = normalize(title1)
  const norm2 = normalize(title2)
  
  // Exact match
  if (norm1 === norm2) return true
  
  // Check if one contains the other (with minimum length)
  if (norm1.length >= 5 && norm2.length >= 5) {
    if (norm1.includes(norm2) || norm2.includes(norm1)) return true
  }
  
  // Check word overlap (at least 70% common words)
  const words1 = new Set(norm1.split(' ').filter(w => w.length > 2))
  const words2 = new Set(norm2.split(' ').filter(w => w.length > 2))
  
  if (words1.size === 0 || words2.size === 0) return false
  
  const intersection = new Set([...words1].filter(w => words2.has(w)))
  const union = new Set([...words1, ...words2])
  
  const similarity = intersection.size / union.size
  return similarity >= 0.7
}

// Helper function to merge a group of similar themes
function mergeThemeGroup(themes: any[]): any {
  // Choose the best title (longest meaningful one)
  const bestTitle = themes
    .map(t => t.title)
    .filter(title => title && title.length > 0)
    .sort((a, b) => b.length - a.length)[0] || themes[0].title
  
  // Combine descriptions (take the most detailed one)
  const bestDescription = themes
    .map(t => t.description)
    .filter(desc => desc && desc.length > 10)
    .sort((a, b) => b.length - a.length)[0] || 'No description available'
  
  // Combine all quotes and deduplicate (ONLY use existing quotes from input themes)
  const allQuotes = new Set()
  themes.forEach(theme => {
    if (Array.isArray(theme.quotes)) {
      theme.quotes.forEach(quote => {
        // Only add quotes that are actual user review content (length check + content validation)
        if (quote && typeof quote === 'string' && quote.length > 10 && quote.length < 1000) {
          // Additional validation: ensure it looks like user-generated content
          const trimmedQuote = quote.trim()
          // Avoid adding quotes that look like AI-generated summaries
          if (!trimmedQuote.startsWith('Users report') && 
              !trimmedQuote.startsWith('Many users') && 
              !trimmedQuote.startsWith('Several users') &&
              !trimmedQuote.includes('analysis shows') &&
              !trimmedQuote.includes('feedback indicates')) {
            allQuotes.add(trimmedQuote)
          }
        }
      })
    }
  })
  
  console.log(`🔍 Merged quotes: found ${allQuotes.size} unique quotes from ${themes.length} themes`)
  
  // Combine all suggestions and deduplicate
  const allSuggestions = new Set()
  themes.forEach(theme => {
    if (Array.isArray(theme.suggestions)) {
      theme.suggestions.forEach(suggestion => {
        if (suggestion && suggestion.length > 5) {
          allSuggestions.add(suggestion.trim())
        }
      })
    }
  })
  
  const mergedTheme = {
    title: bestTitle,
    description: bestDescription,
    quotes: Array.from(allQuotes).slice(0, 8), // Increase quote limit for merged themes
    suggestions: Array.from(allSuggestions).slice(0, 6), // Increase suggestion limit
    importance_score: themes.reduce((sum, theme) => sum + calculateImportanceScore(theme), 0)
  }
  
  console.log(`🔗 Merged ${themes.length} themes into: "${bestTitle}" (${mergedTheme.quotes.length} quotes, ${mergedTheme.suggestions.length} suggestions)`)
  return mergedTheme
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