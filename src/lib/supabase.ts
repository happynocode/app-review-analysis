import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Debug logging for environment variables (only in development)
if (import.meta.env.DEV) {
  console.log('Environment check:', {
    hasUrl: !!supabaseUrl,
    hasKey: !!supabaseAnonKey,
    url: supabaseUrl ? `${supabaseUrl.substring(0, 20)}...` : 'undefined',
    key: supabaseAnonKey ? `${supabaseAnonKey.substring(0, 20)}...` : 'undefined'
  })
}

// Export configuration status
export const isConfigured = !!(supabaseUrl && supabaseAnonKey)

export const configError = !isConfigured ? `Missing Supabase environment variables:
  VITE_SUPABASE_URL: ${supabaseUrl ? 'SET' : 'MISSING'}
  VITE_SUPABASE_ANON_KEY: ${supabaseAnonKey ? 'SET' : 'MISSING'}
  
  For GitHub Pages deployment, make sure you have added these as repository secrets:
  - VITE_SUPABASE_URL
  - VITE_SUPABASE_ANON_KEY
  
  For local development, create a .env.local file with these variables.` : null

// Create supabase client with fallback values
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key'
)

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          created_at: string
        }
        Insert: {
          id?: string
          email: string
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          created_at?: string
        }
      }
      reports: {
        Row: {
          id: string
          user_id: string
          app_name: string
          status: 'pending' | 'processing' | 'completed' | 'error'
          created_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          app_name: string
          status?: 'pending' | 'processing' | 'completed' | 'error'
          created_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          app_name?: string
          status?: 'pending' | 'processing' | 'completed' | 'error'
          created_at?: string
          completed_at?: string | null
        }
      }
      themes: {
        Row: {
          id: string
          report_id: string
          title: string
          description: string
          created_at: string
        }
        Insert: {
          id?: string
          report_id: string
          title: string
          description: string
          created_at?: string
        }
        Update: {
          id?: string
          report_id?: string
          title?: string
          description?: string
          created_at?: string
        }
      }
      quotes: {
        Row: {
          id: string
          theme_id: string
          text: string
          source: string
          review_date: string
          created_at: string
        }
        Insert: {
          id?: string
          theme_id: string
          text: string
          source: string
          review_date: string
          created_at?: string
        }
        Update: {
          id?: string
          theme_id?: string
          text?: string
          source?: string
          review_date?: string
          created_at?: string
        }
      }
      suggestions: {
        Row: {
          id: string
          theme_id: string
          text: string
          created_at: string
        }
        Insert: {
          id?: string
          theme_id: string
          text: string
          created_at?: string
        }
        Update: {
          id?: string
          theme_id?: string
          text?: string
          created_at?: string
        }
      }
    }
  }
}