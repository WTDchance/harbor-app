// app/api/intake/documents/templates/route.ts
//
// Wave 23 (AWS port). One-click intake-document templates. GET lists
// available templates; POST adopts selected templates into the
// practice's intake_documents table. Cognito + pool.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { getEffectivePracticeId } from '@/lib/active-practice'

type Template = {
  slug: string
  name: string
  description: string
  requires_signature: boolean
  content_url: string
}

const TEMPLATES: Template[] = [
  {
    slug: 'hipaa-notice',
    name: 'HIPAA Notice of Privacy Practices',
    description:
      'Standard notice describing how protected health information may be used and disclosed. Customize in your dashboard before going live.',
    requires_signature: true,
    content_url: '/templates/hipaa-notice.html',
  },
  {
    slug: 'informed-consent',
    name: 'Informed Consent for Therapy Services',
    description:
      'Generic informed consent covering the nature of therapy, confidentiality, and risks/benefits.',
    requires_signature: true,
    content_url: '/templates/informed-consent.html',
  },
  {
    slug: 'telehealth-consent',
    name: 'Telehealth Informed Consent',
    description: 'Consent for video and phone-based therapy sessions.',
    requires_signature: true,
    content_url: '/templates/telehealth-consent.html',
  },
  {
    slug: 'cancellation-policy',
    name: 'Cancellation & No-Show Policy',
    description: '24-hour cancellation policy with standard fee acknowledgment.',
    requires_signature: true,
    content_url: '/templates/cancellation-policy.html',
  },
]

export async function GET() {
  return NextResponse.json({ templates: TEMPLATES })
}

export async function POST(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx

  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { slugs?: string[] } = {}
  try { body = await req.json() } catch {}
  const requested = Array.isArray(body.slugs) && body.slugs.length > 0
    ? body.slugs : TEMPLATES.map((t) => t.slug)
  const toAdopt = TEMPLATES.filter((t) => requested.includes(t.slug))
  if (toAdopt.length === 0) {
    return NextResponse.json({ error: 'No valid templates selected' }, { status: 400 })
  }

  const { rows: existing } = await pool.query(
    `SELECT name FROM intake_documents WHERE practice_id = $1`,
    [practiceId],
  )
  const existingNames = new Set(existing.map((r: any) => r.name))

  const { rows: maxOrderRows } = await pool.query(
    `SELECT COALESCE(MAX(sort_order), 0) AS m
       FROM intake_documents WHERE practice_id = $1`,
    [practiceId],
  )
  const startOrder = (maxOrderRows[0]?.m ?? 0) + 1

  const fresh = toAdopt.filter((t) => !existingNames.has(t.name))
  if (fresh.length === 0) {
    return NextResponse.json({
      created: 0,
      skipped: toAdopt.length,
      message: 'All selected templates already exist',
    })
  }

  const created: Array<{ id: string; name: string }> = []
  for (let i = 0; i < fresh.length; i++) {
    const t = fresh[i]
    try {
      const { rows } = await pool.query(
        `INSERT INTO intake_documents
            (practice_id, name, description, requires_signature, content_url,
             active, sort_order)
          VALUES ($1, $2, $3, $4, $5, TRUE, $6)
          RETURNING id, name`,
        [practiceId, t.name, t.description, t.requires_signature, t.content_url, startOrder + i],
      )
      created.push(rows[0])
    } catch (err) {
      console.error('[templates]', (err as Error).message)
    }
  }
  return NextResponse.json({
    created: created.length,
    skipped: toAdopt.length - created.length,
    documents: created,
  })
}
