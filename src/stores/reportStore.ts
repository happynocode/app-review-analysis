import { create } from 'zustand'
import { getUserReports, getReport, createReport } from '../lib/database'
import { supabase } from '../lib/supabase'

export interface Quote {
  id: string
  text: string
  source: string
  review_date: string
}

export interface Suggestion {
  id: string
  text: string
}

export interface Theme {
  id: string
  title: string
  description: string
  platform: 'reddit' | 'app_store' | 'google_play'
  quotes: Quote[]
  suggestions: Suggestion[]
}

export interface PlatformThemes {
  reddit: Theme[]
  app_store: Theme[]
  google_play: Theme[]
}

export interface Report {
  id: string
  user_id: string
  app_name: string
  user_search_term?: string
  selected_app_name?: string
  enabled_platforms?: string[]
  time_filter_days?: number
  status: 'pending' | 'scraping' | 'scraping_completed' | 'analyzing' | 'completing' | 'completed' | 'failed' | 'error'
  created_at: string
  completed_at: string | null
  themes?: Theme[]
  platformThemes?: PlatformThemes
  error_message?: string
  failure_stage?: 'scraping' | 'analysis' | 'completion'
  failure_details?: any
}

interface ReportState {
  currentReport: Report | null
  reports: Report[]
  loading: boolean
  error: string | null
  setCurrentReport: (report: Report | null) => void
  setReports: (reports: Report[]) => void
  setLoading: (loading: boolean) => void
  addReport: (report: Report) => void
  updateReport: (reportId: string, updates: Partial<Report>) => void
  fetchUserReports: (userId: string) => Promise<void>
  fetchReport: (reportId: string) => Promise<void>
  createNewReport: (
    userId: string, 
    appName: string, 
    userSearchTerm?: string, 
    selectedAppName?: string, 
    enabledPlatforms?: string[],
    timeFilterDays?: number
  ) => Promise<Report>
}

export const useReportStore = create<ReportState>((set, get) => ({
  currentReport: null,
  reports: [],
  loading: false,
  error: null,

  setCurrentReport: (report) => set({ currentReport: report }),
  setReports: (reports) => set({ reports }),
  setLoading: (loading) => set({ loading }),
  
  addReport: (report) => set((state) => ({ 
    reports: [report, ...state.reports] 
  })),
  
  updateReport: (reportId, updates) => set((state) => ({
    reports: state.reports.map(report => 
      report.id === reportId ? { ...report, ...updates } : report
    ),
    currentReport: state.currentReport?.id === reportId 
      ? { ...state.currentReport, ...updates } 
      : state.currentReport
  })),

  fetchUserReports: async (userId: string) => {
    set({ loading: true })
    try {
      const reports = await getUserReports(userId)
      set({ reports, loading: false })
    } catch (error) {
      console.error('Error fetching reports:', error)
      set({ loading: false })
    }
  },

  fetchReport: async (reportId: string) => {
    set({ loading: true, error: null })
    
    try {
      // Fetch report data
      const { data: report, error: reportError } = await supabase
        .from('reports')
        .select('*')
        .eq('id', reportId)
        .single()

      if (reportError) throw reportError

      // Fetch themes with platform information
      const { data: themes, error: themesError } = await supabase
        .from('themes')
        .select(`
          id,
          title,
          description,
          platform,
          quotes (
            id,
            text,
            source,
            review_date
          ),
          suggestions (
            id,
            text
          )
        `)
        .eq('report_id', reportId)
        .order('created_at', { ascending: true })

      if (themesError) throw themesError

      // Group themes by platform
      const platformThemes: PlatformThemes = {
        reddit: [],
        app_store: [],
        google_play: []
      }

      if (themes) {
        for (const theme of themes) {
          const themeWithDetails = {
            ...theme,
            quotes: theme.quotes || [],
            suggestions: theme.suggestions || []
          }

          if (theme.platform === 'reddit') {
            platformThemes.reddit.push(themeWithDetails)
          } else if (theme.platform === 'app_store') {
            platformThemes.app_store.push(themeWithDetails)
          } else if (theme.platform === 'google_play') {
            platformThemes.google_play.push(themeWithDetails)
          }
        }
      }

      // For backward compatibility, also set the themes array
      const allThemes = [...platformThemes.reddit, ...platformThemes.app_store, ...platformThemes.google_play]

      set({ 
        currentReport: {
          ...report,
          themes: allThemes,
          platformThemes
        },
        loading: false 
      })
    } catch (error: any) {
      set({ error: error.message, loading: false })
    }
  },

  createNewReport: async (
    userId: string, 
    appName: string, 
    userSearchTerm?: string, 
    selectedAppName?: string, 
    enabledPlatforms?: string[],
    timeFilterDays?: number
  ) => {
    try {
      const report = await createReport(userId, appName, userSearchTerm, selectedAppName, enabledPlatforms, timeFilterDays)
      get().addReport(report)
      return report
    } catch (error) {
      console.error('Error creating report:', error)
      throw error
    }
  }
}))