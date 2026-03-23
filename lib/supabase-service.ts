import { createClient } from '@supabase/supabase-js'

// Service role client — bypasses RLS for server-side operations
// Use ONLY for unauthenticated flows (e.g., patient intake form submission)
// Never expose the service role key to the browser

export function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase service role environment variables')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
