// Supabase client configuration for both server and client
// This handles database connections with proper RLS enforcement
//
// IMPORTANT: Clients are lazily initialized to avoid crashing during
// `next build` when environment variables aren't available. The Supabase
// SDK throws if supabaseUrl is empty, which breaks page data collection.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

// ---------------------------------------------------------------------------
// Lazy singleton pattern — clients are created on first access, not at
// module evaluation time.  This prevents build-time crashes when env vars
// aren't set (e.g. during `next build` in CI).
// ---------------------------------------------------------------------------

let _supabaseClient: SupabaseClient<Database> | null = null
let _supabaseAdmin: SupabaseClient<Database> | null = null

/**
 * Client-side Supabase client (anon key — respects RLS automatically).
 * Lazily created on first call.
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (!_supabaseClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    if (!url || !anonKey) {
      throw new Error(
        'Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY) are not configured.'
      )
    }
    _supabaseClient = createClient<Database>(url, anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInBrowser: true,
      },
    })
  }
  return _supabaseClient
}

/**
 * Server-side Supabase client with service role (bypasses RLS).
 * Use in API routes — always add practice_id filters!
 * Lazily created on first call.
 */
export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (!_supabaseAdmin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    if (!url || !serviceKey) {
      throw new Error(
        'Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) are not configured.'
      )
    }
    _supabaseAdmin = createClient<Database>(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }
  return _supabaseAdmin
}

// ---------------------------------------------------------------------------
// Backward-compatible named exports.
//
// These look like constants but are backed by getters so the actual Supabase
// client creation is deferred until first property access at runtime.
// Every existing `import { supabaseAdmin } from "@/lib/supabase"` keeps
// working — the value is resolved lazily when the import binding is read.
// ---------------------------------------------------------------------------

// Build-safe no-op: returns a function that resolves with an error shape,
// so code that destructures { data, error } won't blow up during static gen.
const _buildStub = () => ({ data: null, error: { message: 'Supabase not configured' } })

export const supabaseClient = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    try { return (getSupabaseClient() as any)[prop] }
    catch { return _buildStub }
  },
})

export const supabaseAdmin = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    try { return (getSupabaseAdmin() as any)[prop] }
    catch { return _buildStub }
  },
})

// Helper to get the current session (client-side)
export async function getCurrentSession() {
  const { data, error } = await getSupabaseClient().auth.getSession()
  if (error) {
    console.error('Error getting session:', error)
    return null
  }
  return data.session
}

// Helper to get current user (client-side)
export async function getCurrentUser() {
  const { data, error } = await getSupabaseClient().auth.getUser()
  if (error) {
    console.error('Error getting user:', error)
    return null
  }
  return data.user
}

// Helper to sign out (client-side)
export async function signOut() {
  const { error } = await getSupabaseClient().auth.signOut()
  if (error) {
    console.error('Error signing out:', error)
    throw error
  }
}
