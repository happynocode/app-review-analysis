import { create } from 'zustand'
import { getUserReports, getReport, createReport } from '../lib/database'

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
  quotes: Quote[]
  suggestions: Suggestion[]
}

export interface Report {
  id: string
  user_id: string
  app_name: string
  status: 'pending' | 'processing' | 'completed' | 'error'
  created_at: string
  completed_at: string | null
  themes?: Theme[]
}

interface ReportState {
  currentReport: Report | null
  reports: Report[]
  loading: boolean
  setCurrentReport: (report: Report | null) => void
  setReports: (reports: Report[]) => void
  setLoading: (loading: boolean) => void
  addReport: (report: Report) => void
  updateReport: (reportId: string, updates: Partial<Report>) => void
  fetchUserReports: (userId: string) => Promise<void>
  fetchReport: (reportId: string) => Promise<void>
  createNewReport: (userId: string, appName: string) => Promise<Report>
}

export const useReportStore = create<ReportState>((set, get) => ({
  currentReport: null,
  reports: [],
  loading: false,

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
    set({ loading: true })
    try {
      const report = await getReport(reportId)
      set({ currentReport: report, loading: false })
    } catch (error) {
      console.error('Error fetching report:', error)
      set({ loading: false })
    }
  },

  createNewReport: async (userId: string, appName: string) => {
    try {
      const report = await createReport(userId, appName)
      get().addReport(report)
      return report
    } catch (error) {
      console.error('Error creating report:', error)
      throw error
    }
  }
}))