// app/api/admin/attach-vapi/route.ts
//
// Wave 41 — Vapi removed. Retell is now the receptionist. Practices that
// previously needed `attach-vapi` to retrofit a per-practice Vapi
// assistant should be re-provisioned through /api/admin/reprovision,
// which routes through lib/aws/provisioning/provision-practice (the
// SignalWire + Retell pipeline).
//
// We keep this URL alive as a 410 Gone so any documented runbook calling
// it gets a deterministic, audited tombstone instead of a generic 404.
// Audit rows make it possible to track whether anyone is still hitting
// the old path before deleting the file in a future wave.

import { NextRequest, NextResponse } from 'next/server'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  // Audit even unauthenticated probes — useful for detecting stale runbooks.
  await auditSystemEvent({
    action: 'vapi.attach.deprecated_hit',
    severity: 'warn',
    details: {
      authorized: !!process.env.CRON_SECRET && auth === expected,
      ua: req.headers.get('user-agent') ?? null,
    },
  }).catch(() => {})

  return NextResponse.json(
    {
      error: 'gone',
      reason: 'vapi_removed_wave_41',
      replacement: '/api/admin/reprovision',
      docs: 'Vapi was retired in Wave 41. Re-provision the practice via POST /api/admin/reprovision { practice_id } to bind a SignalWire number + Retell agent.',
    },
    { status: 410 },
  )
}
