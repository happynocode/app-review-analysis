import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Debug logging
console.log('Environment variables debug:')
console.log('VITE_SUPABASE_URL:', supabaseUrl)
console.log('VITE_SUPABASE_ANON_KEY:', supabaseAnonKey ? `${supabaseAnonKey.substring(0, 10)}...` : 'undefined')
console.log('All env vars:', import.meta.env)

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(`Missing Supabase environment variables. VITE_SUPABASE_URL: ${supabaseUrl}, VITE_SUPABASE_ANON_KEY: ${supabaseAnonKey ? 'present' : 'missing'}. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.`)
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

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
          status: 'pending' | 'scraping' | 'scraping_completed' | 'analyzing' | 'completing' | 'completed' | 'failed' | 'error'
          created_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          app_name: string
          status?: 'pending' | 'scraping' | 'scraping_completed' | 'analyzing' | 'completing' | 'completed' | 'failed' | 'error'
          created_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          app_name?: string
          status?: 'pending' | 'scraping' | 'scraping_completed' | 'analyzing' | 'completing' | 'completed' | 'failed' | 'error'
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