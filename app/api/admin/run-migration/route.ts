// Admin endpoint to apply the patient intake columns migration
// Requires CRON_SECRET bearer token
// POST /api/admin/run-migration

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Each statement is a single ALTER TABLE that Supabase can run via the PostgREST
// SQL execution (using .rpc or raw postgres). We use a workaround: attempt to
// insert a row with the new column name. If it fails with "column does not exist",
// we know we need to add it.
//
// Since supabase-js doesn't support raw SQL, we use the approach of attempting
// updates that reference new columns. The actual migration SQL should be run
// via Supabase Dashboard SQL Editor.

const REQUIRED_COLUMNS = [
  'pronouns',
  'address',
  'emergency_contact_name',
  'emergency_contact_phone',
  'referral_source',
  'insurance_provider',
  'insurance_member_id',
  'insurance_group_number',
  'intake_completed',
  'intake_completed_at',
  'updated_at',
  'telehealth_preference',
  'preferred_times',
]

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || ''
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check which columns exist by trying to select them
  const results: { column: string; exists: boolean; error?: string }[] = []

  for (const col of REQUIRED_COLUMNS) {
    try {
      const { error } = await supabaseAdmin
        .from('patients')
        .select(col)
        .limit(1)

      if (error && error.message.includes('column') && error.message.includes('does not exist')) {
        results.push({ column: col, exists: false })
      } else if (error) {
        results.push({ column: col, exists: false, error: error.message })
      } else {
        results.push({ column: col, exists: true })
      }
    } catch (err: any) {
      results.push({ column: col, exists: false, error: err?.message })
    }
  }

  const missing = results.filter(r => !r.exists).map(r => r.column)

  return NextResponse.json({
    total_checked: REQUIRED_COLUMNS.length,
    existing: results.filter(r => r.exists).length,
    missing: missing.length,
    missing_columns: missing,
    details: results,
    migration_sql: missing.length > 0
      ? 'Run in Supabase SQL Editor:\n\n' + generateMigrationSQL(missing)
      : 'All columns exist — no migration needed.',
  })
}

function generateMigrationSQL(missing: string[]): string {
  const typeMap: Record<string, string> = {
    pronouns: 'TEXT',
    address: 'TEXT',
    emergency_contact_name: 'TEXT',
    emergency_contact_phone: 'TEXT',
    referral_source: 'TEXT',
    insurance_provider: 'TEXT',
    insurance_member_id: 'TEXT',
    insurance_group_number: 'TEXT',
    intake_completed: 'BOOLEAN DEFAULT FALSE',
    intake_completed_at: 'TIMESTAMP WITH TIME ZONE',
    updated_at: 'TIMESTAMP WITH TIME ZONE',
    telehealth_preference: 'TEXT',
    preferred_times: 'TEXT',
  }

  return missing
    .map(col => `ALTER TABLE patients ADD COLUMN IF NOT EXISTS ${col} ${typeMap[col] || 'TEXT'};`)
    .join('\n')
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || ''
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Attempt to add columns using Supabase's postgres connection
  // This uses a workaround — we call a postgres function if available
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 })
  }

  // Use Supabase's SQL API (available on all plans)
  const migrationSQL = `
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS pronouns TEXT;
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS address TEXT;
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS referral_source TEXT;
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_provider TEXT;
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_member_id TEXT;
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_group_number TEXT;
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS intake_completed BOOLEAN DEFAULT FALSE;
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS intake_completed_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS telehealth_preference TEXT;
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS preferred_times TEXT;
  `

  // Try the Supabase SQL endpoint
  const projectRef = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '')
  const sqlUrl = `${SUPABASE_URL}/rest/v1/rpc/exec_sql`

  // Fallback: try direct postgres via pg_net if available, or return the SQL for manual execution
  try {
    // Method 1: Try supabase.rpc with a known function
    const { error: rpcError } = await supabaseAdmin.rpc('exec_sql', { sql: migrationSQL })

    if (!rpcError) {
      return NextResponse.json({ ok: true, method: 'rpc', message: 'Migration applied via exec_sql' })
    }

    // Method 2: Return the SQL for manual execution
    return NextResponse.json({
      ok: false,
      message: 'Auto-migration not available. Run this SQL in Supabase Dashboard → SQL Editor:',
      sql: migrationSQL,
      dashboard_url: `https://supabase.com/dashboard/project/${projectRef}/sql/new`,
    })
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      message: 'Run this SQL manually in Supabase Dashboard → SQL Editor:',
      sql: migrationSQL,
      error: err?.message,
    })
  }
}
