// Cognito-era stub: client components use cookie-based fetches to /api/* (which
// gate on Cognito). Any direct supabase.from()/auth.getUser() call from
// client code now no-ops gracefully so old code paths don't crash. Server
// components/route handlers do NOT use this — they go through lib/aws/db.ts.

type Sub = { subscription: { unsubscribe: () => void } }
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
    single: () => Promise.resolve({ data: null, error: { message: 'supabase disabled (cognito mode)' } }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: (v: Resp<unknown[]>) => void) => resolve({ data: [], error: null }),
  }
  return q
}

const stub = {
  auth: {
    getUser: async (): Promise<Resp<{ user: null }>> => ({ data: { user: null }, error: null }),
    getSession: async (): Promise<Resp<{ session: null }>> => ({ data: { session: null }, error: null }),
    signInWithPassword: async () => ({ data: { user: null, session: null }, error: { message: 'use cognito' } }),
    signOut: async () => ({ error: null }),
    resetPasswordForEmail: async () => ({ data: null, error: { message: 'use cognito' } }),
    onAuthStateChange: (_cb: unknown): { data: Sub } => ({
      data: { subscription: { unsubscribe: () => {} } },
    }),
    mfa: {
      listFactors: async () => ({ data: { totp: [], all: [] }, error: null }),
      enroll: async () => ({ data: null, error: { message: 'use cognito' } }),
      challenge: async () => ({ data: null, error: { message: 'use cognito' } }),
      verify: async () => ({ data: null, error: { message: 'use cognito' } }),
      unenroll: async () => ({ data: null, error: { message: 'use cognito' } }),
    },
  },
  from: (_table: string) => makeQuery(),
  storage: {
    from: (_bucket: string) => ({
      upload: async () => ({ data: null, error: { message: 'use cognito' } }),
      download: async () => ({ data: null, error: { message: 'use cognito' } }),
      remove: async () => ({ data: null, error: { message: 'use cognito' } }),
      createSignedUrl: async () => ({ data: null, error: { message: 'use cognito' } }),
      getPublicUrl: () => ({ data: { publicUrl: '' } }),
    }),
  },
  channel: () => ({
    on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
    subscribe: () => ({ unsubscribe: () => {} }),
    unsubscribe: () => {},
  }),
}

export function createClient(): any {
  return stub
}
