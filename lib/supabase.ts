// Supabase client configuration for both server and client
// This handles database connections with proper RLS enforcement

import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('⚠️ Supabase environment variables not configured. Database operations will fail.')
}

// Client-side Supabase client
// Uses anon key - respects RLS policies automatically
export const supabaseClient = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInBrowser: true,
    },
  }
)

// Server-side Supabase client with service role
// Use this in API routes to bypass RLS (but always add practice_id filters!)
export const supabaseAdmin = createClient<Database>(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)

// Helper to get the current session (client-side)
export async function getCurrentSession() {
  const { data, error } = await supabaseClient.auth.getSession()
  if (error) {
    console.error('Error getting session:', error)
    return null
  }
  return data.session
}

// Helper to get current user (client-side)
export async function getCurrentUser() {
  const { data, error } = await supabaseClient.auth.getUser()
  if (error) {
    console.error('Error getting user:', error)
    return null
  }
  return data.user
}

// Helper to sign out (client-side)
export async function signOut() {
  const { error } = await supabaseClient.auth.signOut()
  if (error) {
    console.error('Error signing out:', error)
    throw error
  }
}
