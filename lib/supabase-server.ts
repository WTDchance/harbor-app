// Cognito-era stub: server-side Supabase client is no longer wired up.
// All server reads/writes go through lib/aws/db.ts (RDS pool) and Cognito
// session cookies. Auth checks use requireApiSession / requireEhrApiSession
// from lib/aws/api-auth.ts.
//
// This stub keeps legacy `createServerSupabase()` / `createClient()` imports
// from crashing while we finish porting their callers. Returns an object
// whose .from() and .auth methods resolve to empty / null shapes.

import { supabaseAdmin } from './supabase'

export async function createServerSupabase() {
  return supabaseAdmin
}

export const createClient = createServerSupabase
