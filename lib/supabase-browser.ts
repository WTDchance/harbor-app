// Client-side Supabase instance for use in 'use client' components
//
// Gracefully handles missing env vars during `next build` page data
// collection — createBrowserClient throws if URL is empty, which crashes
// the build even though these pages are only used at runtime.
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !key) {
    // Return a no-op proxy during build so module evaluation doesn't crash.
    // These calls never execute at runtime (pages redirect unauthenticated users).
    return new Proxy({} as ReturnType<typeof createBrowserClient>, {
      get() {
        return () => ({ data: null, error: { message: 'Supabase not configured' } })
      },
    }) as any
  }
  return createBrowserClient(url, key)
}
