import { create } from 'zustand'
import { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { createUserProfile } from '../lib/database'

interface AuthState {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  initialize: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,

  signIn: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
    set({ user: data.user })
  },

  signUp: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })
    if (error) throw error

    // User profile will be created automatically by the database trigger
    set({ user: data.user })
  },

  signInWithGoogle: async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/feedbacklens`
      }
    })
    if (error) throw error
  },

  signOut: async () => {
    try {
      // Check if user is already signed out
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        // User is already signed out, just update state
        set({ user: null })
        return
      }

      const { error } = await supabase.auth.signOut()
      if (error) {
        // If it's a session missing error, just update state
        if (error.message?.includes('session') || error.message?.includes('Auth session missing')) {
          console.warn('Session already expired, updating state')
          set({ user: null })
          return
        }
        throw error
      }
      set({ user: null })
    } catch (error) {
      console.error('Sign out error:', error)
      // Even if signOut fails, clear the local state
      set({ user: null })
      // Don't throw the error to prevent UI crashes
    }
  },

  initialize: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      set({ user: session?.user ?? null, loading: false })

      supabase.auth.onAuthStateChange(async (event, session) => {
        set({ user: session?.user ?? null, loading: false })
      })
    } catch (error) {
      console.error('Auth initialization error:', error)
      set({ loading: false })
    }
  },
}))