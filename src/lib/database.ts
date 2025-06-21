import { supabase } from './supabase'
import { Database } from './supabase'

type Tables = Database['public']['Tables']

// User operations
export const createUserProfile = async (userId: string, email: string) => {
  const { data, error } = await supabase
    .from('users')
    .insert({ id: userId, email })
    .select()
    .single()

  if (error) throw error
  return data
}

export const getUserProfile = async (userId: string) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) throw error
  return data
}

// Report operations
export const createReport = async (
  userId: string, 
  appName: string, 
  userSearchTerm?: string, 
  selectedAppName?: string, 
  enabledPlatforms?: string[]
) => {
  const { data, error } = await supabase
    .from('reports')
    .insert({
      user_id: userId,
      app_name: appName,
      user_search_term: userSearchTerm,
      selected_app_name: selectedAppName,
      enabled_platforms: enabledPlatforms || ['app_store', 'google_play', 'reddit'],
      status: 'pending'
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export const getUserReports = async (userId: string) => {
  const { data, error } = await supabase
    .from('reports')
    .select('*, user_search_term, selected_app_name, enabled_platforms')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export const getReport = async (reportId: string) => {
  const { data, error } = await supabase
    .from('reports')
    .select(`
      *,
      themes (
        *,
        quotes (*),
        suggestions (*)
      )
    `)
    .eq('id', reportId)
    .single()

  if (error) throw error
  return data
}

export const getReportWithScrapedData = async (reportId: string) => {
  const { data, error } = await supabase
    .from('reports')
    .select(`
      *,
      themes (
        *,
        quotes (*),
        suggestions (*)
      ),
      scraping_sessions (
        *,
        scraped_reviews (*)
      )
    `)
    .eq('id', reportId)
    .single()

  if (error) throw error
  return data
}

export const updateReportStatus = async (
  reportId: string, 
  status: 'pending' | 'processing' | 'completed' | 'error',
  completedAt?: string
) => {
  const updates: any = { status }
  if (completedAt) updates.completed_at = completedAt

  const { data, error } = await supabase
    .from('reports')
    .update(updates)
    .eq('id', reportId)
    .select()
    .single()

  if (error) throw error
  return data
}

// Scraping session operations
export const createScrapingSession = async (reportId: string, appName: string) => {
  const { data, error } = await supabase
    .from('scraping_sessions')
    .insert({
      report_id: reportId,
      app_name: appName,
      status: 'pending'
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export const updateScrapingSession = async (
  sessionId: string,
  updates: {
    status?: 'pending' | 'running' | 'completed' | 'error'
    total_reviews_found?: number
    app_store_reviews?: number
    google_play_reviews?: number
    reddit_posts?: number
    error_message?: string
    completed_at?: string
  }
) => {
  const { data, error } = await supabase
    .from('scraping_sessions')
    .update(updates)
    .eq('id', sessionId)
    .select()
    .single()

  if (error) throw error
  return data
}

export const saveScrapedReviews = async (
  sessionId: string,
  reviews: Array<{
    platform: 'app_store' | 'google_play' | 'reddit'
    review_text: string
    rating?: number
    review_date?: string
    author_name?: string
    source_url?: string
    additional_data?: any
  }>
) => {
  const reviewsToInsert = reviews.map(review => ({
    scraping_session_id: sessionId,
    ...review
  }))

  const { data, error } = await supabase
    .from('scraped_reviews')
    .insert(reviewsToInsert)
    .select()

  if (error) throw error
  return data
}

export const getScrapingSession = async (sessionId: string) => {
  const { data, error } = await supabase
    .from('scraping_sessions')
    .select(`
      *,
      scraped_reviews (*)
    `)
    .eq('id', sessionId)
    .single()

  if (error) throw error
  return data
}

// Theme operations
export const createTheme = async (
  reportId: string,
  title: string,
  description: string
) => {
  const { data, error } = await supabase
    .from('themes')
    .insert({
      report_id: reportId,
      title,
      description
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// Quote operations
export const createQuote = async (
  themeId: string,
  text: string,
  source: string,
  reviewDate: string
) => {
  const { data, error } = await supabase
    .from('quotes')
    .insert({
      theme_id: themeId,
      text,
      source,
      review_date: reviewDate
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// Suggestion operations
export const createSuggestion = async (themeId: string, text: string) => {
  const { data, error } = await supabase
    .from('suggestions')
    .insert({
      theme_id: themeId,
      text
    })
    .select()
    .single()

  if (error) throw error
  return data
}