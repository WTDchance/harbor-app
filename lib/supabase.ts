// Cognito-era stub: this file used to wire up live Supabase clients.
// All Supabase usage in Harbor has been or is being migrated to AWS RDS
// via lib/aws/db.ts. Until each remaining caller is ported, this file
// returns a chain-compatible no-op stub so legacy imports don't crash.
//
// Real reads/writes happen via:
//   - server: import { pool } from '@/lib/aws/db'
//   - browser: fetch('/api/...') against AWS API routes
//
// supabaseAdmin / supabaseClient .from(...).select(...) returns empty data
// instead of throwing. Code that depends on real data should be ported to
// pool.query() — see app/api/admin/signups/route.ts for an example.

import type { SupabaseClient } from '@supabase/supabase-js'

type Resp<T = unknown> = { data: T | null; error: { message: string } | null }

function makeQuery(): any {
  const q: any = {
    select: () => q,
    insert: () => q,
    update: () => q,
    delete: () => q,
    upsert: () => q,
    eq: () => q,
    neq: () => q,
    in: () => q,
    is: () => q,
    gt: () => q,
    gte: () => q,
    lt: () => q,
    lte: () => q,
    ilike: () => q,
    like: () => q,
    or: () => q,
    order: () => q,
    limit: () => q,
    range: () => q,
    not: () => q,
    contains: () => q,
    overlaps: () => q,
    match: () => q,
    filter: () => q,
    single: () =>
      Promise.resolve({ data: null, error: { message: 'supabase disabled (aws migration)' } }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    csv: () => Promise.resolve({ data: '', error: null }),
    then: (resolve: (v: Resp<unknown[]>) => void) => resolve({ data: [], error: null }),
  }
  return q
}

const stub: any = {
  auth: {
    getUser: async () => ({
      data: { user: { id: 'aws-stub', email: '' as string, aud: 'authenticated' } },
      error: null,
    }),
    getSession: async () => ({
      data: {
        session: {
          access_token: '',
          user: { id: 'aws-stub', email: '' as string, aud: 'authenticated' },
        },
      },
      error: null,
    }),
    signInWithPassword: async () => ({ data: { user: null, session: null }, error: { message: 'use cognito' } }),
    signOut: async () => ({ error: null }),
    resetPasswordForEmail: async () => ({ data: null, error: { message: 'use cognito' } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    admin: {
      createUser: async () => ({ data: { user: null }, error: { message: 'use cognito' } }),
      deleteUser: async () => ({ data: null, error: { message: 'use cognito' } }),
      listUsers: async () => ({ data: { users: [] }, error: null }),
      updateUserById: async () => ({ data: { user: null }, error: { message: 'use cognito' } }),
    },
  },
  from: (_table: string) => makeQuery(),
  rpc: async (_fn: string, _args?: unknown) => ({ data: null, error: { message: 'supabase disabled' } }),
  storage: {
    from: (_bucket: string) => ({
      upload: async () => ({ data: null, error: { message: 'use s3' } }),
      download: async () => ({ data: null, error: { message: 'use s3' } }),
      remove: async () => ({ data: null, error: { message: 'use s3' } }),
      createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }),
      getPublicUrl: () => ({ data: { publicUrl: '' } }),
      list: async () => ({ data: [], error: null }),
    }),
  },
  channel: () => ({
    on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
    subscribe: () => ({ unsubscribe: () => {} }),
    unsubscribe: () => {},
  }),
}

// ---------------------------------------------------------------------------
// Public surface — kept for backwards compat with existing imports.
// ---------------------------------------------------------------------------

export const supabaseClient = stub as unknown as SupabaseClient
export const supabaseAdmin = stub as unknown as SupabaseClient

export function getSupabaseClient(): SupabaseClient {
  return stub as unknown as SupabaseClient
}
export function getSupabaseAdmin(): SupabaseClient {
  return stub as unknown as SupabaseClient
}

export async function getCurrentSession() {
  return null
}

export async function getCurrentUser() {
  return null
}

export async function signOut() {
  return
}
