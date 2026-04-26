// app/api/reports/weekly/run/route.ts
//
// Wave 23 (AWS port). Trigger the weekly EHR report job. Auth: cron
// secret bearer. The report itself reads from RDS and dispatches
// email via SES (Wave 5). Carrier-side SMS digest is on Bucket 1.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { rows } = await pool.query(
      `SELECT id FROM practices
        WHERE provisioning_state = 'active'
          AND deleted_at IS NULL`,
    )
    await auditSystemEvent({
      action: 'reports.weekly.queued',
      severity: 'info',
      details: { count: rows.length },
    })
    return NextResponse.json({
      ok: true,
      queued: rows.length,
      dispatch_pending: 'weekly_report_worker',
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
