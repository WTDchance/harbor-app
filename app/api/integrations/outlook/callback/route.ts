// app/api/integrations/outlook/callback/route.ts
//
// W51 D3 — Outlook OAuth callback. Exchanges the code for tokens,
// encrypts them via AWS KMS / AES-GCM (lib/aws/token-encryption), and
// upserts a practice_calendar_integrations row.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'
import { encryptToken } from '@/lib/aws/token-encryption'
import { exchangeCodeForTokens, fetchAccountEmail } from '@/lib/outlookCalendar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const code = sp.get('code')
  const stateRaw = sp.get('state')
  const error = sp.get('error')
  const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')

  if (error) {
    return NextResponse.redirect(new URL(`/dashboard/settings/calendar?error=${encodeURIComponent(error)}`, req.url))
  }
  if (!code || !stateRaw) {
    return NextResponse.redirect(new URL(`/dashboard/settings/calendar?error=missing_params`, req.url))
  }

  let state: { practiceId: string; therapistId: string | null }
  try { state = JSON.parse(Buffer.from(stateRaw, 'base64url').toString()) }
  catch { return NextResponse.redirect(new URL(`/dashboard/settings/calendar?error=bad_state`, req.url)) }

  const redirectUri = `${appUrl}/api/integrations/outlook/callback`
  let tokens
  try {
    tokens = await exchangeCodeForTokens(code, redirectUri)
  } catch (e) {
    return NextResponse.redirect(new URL(`/dashboard/settings/calendar?error=token_exchange`, req.url))
  }

  const accountEmail = (await fetchAccountEmail(tokens.access_token).catch(() => null)) || 'unknown@outlook'

  const refreshEnc = await encryptToken(tokens.refresh_token ?? '')
  const accessEnc  = await encryptToken(tokens.access_token)
  const expiresAt = new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString()
  const scopes = (tokens.scope || '').split(' ').filter(Boolean)

  await pool.query(
    `INSERT INTO practice_calendar_integrations
       (practice_id, therapist_id, provider, account_email,
        refresh_token_encrypted, access_token_encrypted,
        access_token_expires_at, scopes, status)
     VALUES ($1, $2, 'outlook', $3, $4, $5, $6, $7::text[], 'active')
     ON CONFLICT (practice_id, therapist_id, provider, account_email)
       DO UPDATE SET
         refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
         access_token_encrypted  = EXCLUDED.access_token_encrypted,
         access_token_expires_at = EXCLUDED.access_token_expires_at,
         scopes                  = EXCLUDED.scopes,
         status                  = 'active'`,
    [state.practiceId, state.therapistId, accountEmail, refreshEnc, accessEnc, expiresAt, scopes],
  )

  // Dual-write to legacy calendar_connections so existing /dashboard/settings
  // flows that read from that table keep working. PLAINTEXT here matches the
  // legacy schema; the source-of-truth KMS-encrypted copy is on
  // practice_calendar_integrations above.
  await pool.query(
    `INSERT INTO calendar_connections
       (practice_id, provider, label, access_token, refresh_token, token_expires_at, sync_enabled)
     VALUES ($1, 'outlook', $2, $3, $4, $5, true)
     ON CONFLICT (practice_id, provider) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       token_expires_at = EXCLUDED.token_expires_at,
       label = EXCLUDED.label`,
    [state.practiceId, accountEmail, tokens.access_token, tokens.refresh_token ?? null, expiresAt],
  ).catch(() => null)

  await writeAuditLog({
    practice_id: state.practiceId,
    action: 'calendar_integration.connected',
    resource_type: 'practice_calendar_integration',
    severity: 'info',
    details: { provider: 'outlook', account_email: accountEmail },
  })

  return NextResponse.redirect(new URL(`/dashboard/settings/calendar?connected=outlook`, req.url))
}
