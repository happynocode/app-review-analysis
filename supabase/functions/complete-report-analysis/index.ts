import { createClient } from 'npm:@supabase/supabase-js@2'

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

    // Start the completion process
    EdgeRuntime.waitUntil(completeReportAnalysis(reportId, supabaseClient))

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Report completion started',
        reportId
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

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

    // Get report information
    const { data: report, error: reportError } = await supabaseClient
      .from('reports')
      .select('app_name')
      .eq('id', reportId)
      .single()

    if (reportError || !report) {
      throw new Error('Failed to fetch report information')
    }

    // Get all completed analysis tasks for this report
    const { data: completedTasks, error: tasksError } = await supabaseClient
      .from('analysis_tasks')
      .select('themes_data, batch_index')
      .eq('report_id', reportId)
      .eq('status', 'completed')
      .order('batch_index', { ascending: true })

    if (tasksError) {
      throw new Error(`Failed to fetch completed tasks: ${tasksError.message}`)
    }

    if (!completedTasks || completedTasks.length === 0) {
      throw new Error('No completed analysis tasks found')
    }

    console.log(`📊 Found ${completedTasks.length} completed analysis tasks`)

    // Aggregate all themes from completed tasks
    const allThemes = []
    for (const task of completedTasks) {
      if (task.themes_data && task.themes_data.themes) {
        allThemes.push(...task.themes_data.themes)
      }
    }

    console.log(`📋 Total themes before merging: ${allThemes.length}`)

    // Merge and deduplicate themes
    const finalThemes = await mergeAndDeduplicateThemes(report.app_name, allThemes)
    
    console.log(`🎯 Final themes after merging: ${finalThemes.length}`)

    // Save final themes to database
    await saveFinalThemes(reportId, finalThemes, supabaseClient)

    // Mark report as completed
    await supabaseClient
      .from('reports')
      .update({ 
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', reportId)

    const totalTime = Date.now() - startTime
    console.log(`✅ Report ${reportId} completed successfully in ${Math.round(totalTime / 1000)}s`)

  } catch (error) {
    console.error(`❌ Error completing report ${reportId}:`, error)
    
    // Mark report as error
    await supabaseClient
      .from('reports')
      .update({ status: 'error' })
      .eq('id', reportId)
  }
}

async function mergeAndDeduplicateThemes(appName: string, allThemes: any[]) {
  console.log(`🔄 Merging and deduplicating ${allThemes.length} themes for ${appName}`)

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

async function intelligentMergeWithDeepSeek(appName: string, allThemes: any[]) {
  const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY')
  
  if (!deepseekApiKey) {
    console.log('⚠️ DeepSeek API key not available, falling back to rule-based merge')
    return ruleBasedMerge(allThemes)
  }

  try {
    // Limit themes for API call
    const limitedThemes = allThemes.slice(0, 80) // Limit to prevent token overflow

    const prompt = `Merge and deduplicate these themes for "${appName}". Return exactly 25 final themes.

Input themes (${limitedThemes.length}):
${JSON.stringify(limitedThemes, null, 2)}

Instructions:
1. Merge similar themes together
2. Remove duplicates
3. Prioritize themes by importance and frequency
4. Ensure each final theme is distinct and meaningful
5. Combine quotes and suggestions from merged themes
6. Return exactly 25 themes, ranked by importance

Return JSON only:
{
  "themes": [
    {
      "title": "Clear theme title (2-5 words)",
      "description": "Detailed description (2-3 sentences)",
      "quotes": [
        {
          "text": "Representative quote",
          "source": "App Store|Google Play|Reddit",
          "date": "2025-01-10"
        }
      ],
      "suggestions": [
        "Specific actionable suggestion",
        "Another concrete recommendation"
      ]
    }
  ]
}`

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
            content: 'You are an expert product analyst specializing in theme consolidation. Always respond with valid JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.2,
        max_tokens: 8000
      })
    })

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`)
    }

    const result = await response.json()
    let content = result.choices[0].message.content.trim()

    // Clean up the response
    content = content.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim()

    const mergedResult = JSON.parse(content)
    
    if (!mergedResult.themes || !Array.isArray(mergedResult.themes)) {
      throw new Error('Invalid merged result structure')
    }

    console.log(`✅ DeepSeek merge completed: ${mergedResult.themes.length} final themes`)
    return mergedResult.themes.slice(0, 25) // Ensure exactly 25 themes

  } catch (error) {
    console.error('❌ DeepSeek merge failed:', error.message)
    console.log('🔄 Falling back to rule-based merge')
    return ruleBasedMerge(allThemes)
  }
}

function ruleBasedMerge(allThemes: any[]) {
  console.log(`🔧 Performing rule-based merge on ${allThemes.length} themes`)

  // Group themes by similar titles
  const themeGroups = new Map()
  
  for (const theme of allThemes) {
    const normalizedTitle = theme.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((word: string) => word.length > 2)
      .slice(0, 3) // Take first 3 significant words
      .sort()
      .join('_')
    
    if (!themeGroups.has(normalizedTitle)) {
      themeGroups.set(normalizedTitle, [])
    }
    themeGroups.get(normalizedTitle).push(theme)
  }
  
  // Merge themes within each group
  const mergedThemes = []
  for (const [groupKey, groupThemes] of themeGroups) {
    if (groupThemes.length === 1) {
      mergedThemes.push(groupThemes[0])
    } else {
      // Merge multiple themes in the group
      const mergedTheme = {
        title: groupThemes[0].title,
        description: groupThemes[0].description,
        quotes: [],
        suggestions: []
      }
      
      // Collect all quotes and suggestions
      for (const theme of groupThemes) {
        if (theme.quotes) mergedTheme.quotes.push(...theme.quotes)
        if (theme.suggestions) mergedTheme.suggestions.push(...theme.suggestions)
      }
      
      // Deduplicate and limit
      mergedTheme.quotes = Array.from(new Set(mergedTheme.quotes.map(q => q.text)))
        .slice(0, 3)
        .map(text => ({ text, source: 'App Store', date: '2025-01-10' }))
      
      mergedTheme.suggestions = Array.from(new Set(mergedTheme.suggestions)).slice(0, 3)
      
      mergedThemes.push(mergedTheme)
    }
  }
  
  // Sort by quality indicators and limit to 25
  const finalThemes = mergedThemes
    .sort((a, b) => {
      const scoreA = (a.quotes?.length || 0) + (a.suggestions?.length || 0)
      const scoreB = (b.quotes?.length || 0) + (b.suggestions?.length || 0)
      return scoreB - scoreA
    })
    .slice(0, 25)
  
  console.log(`✅ Rule-based merge completed: ${finalThemes.length} final themes`)
  return finalThemes
}

async function saveFinalThemes(reportId: string, themes: any[], supabaseClient: any) {
  console.log(`💾 Saving ${themes.length} final themes to database...`)

  try {
    for (const theme of themes) {
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
              source: quote.source || 'App Store',
              review_date: quote.date || '2025-01-10'
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

    console.log(`✅ Successfully saved all ${themes.length} themes to database`)

  } catch (error) {
    console.error('❌ Error saving final themes:', error)
    throw error
  }
}