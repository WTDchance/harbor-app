// app/api/intake/documents/templates/route.ts
// Harbor – One-click starter intake document templates
// POST creates intake_documents records for a practice from a curated set of templates

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { resolvePracticeIdForApi } from '@/lib/active-practice';

type Template = {
  slug: string;
  name: string;
  description: string;
  requires_signature: boolean;
  content_url: string; // served from /public/templates/<slug>.html
};

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
      'Generic informed consent covering the nature of therapy, confidentiality, and risks/benefits. Edit to match your practice before sending to patients.',
    requires_signature: true,
    content_url: '/templates/informed-consent.html',
  },
  {
    slug: 'telehealth-consent',
    name: 'Telehealth Informed Consent',
    description:
      'Consent for video and phone-based therapy sessions. Required for practices offering telehealth.',
    requires_signature: true,
    content_url: '/templates/telehealth-consent.html',
  },
  {
    slug: 'cancellation-policy',
    name: 'Cancellation & No-Show Policy',
    description:
      '24-hour cancellation policy with standard fee acknowledgment. Adjust the fee and notice period to match your practice.',
    requires_signature: true,
    content_url: '/templates/cancellation-policy.html',
  },
];

async function getPracticeId(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const { data: { user }, error } = await supabase.auth.getUser(authHeader.slice(7));
  if (error || !user) return null;

  // Try act-as cookie (admin) then users.practice_id
  const resolved = await resolvePracticeIdForApi(supabase, user);
  if (resolved) return resolved;

  // Fallback: practice_members
  const { data: member } = await supabase
    .from('practice_members')
    .select('practice_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (member?.practice_id) return member.practice_id;

  // Last fallback: practice with notification_email matching the user
  if (user.email) {
    const { data: practice } = await supabase
      .from('practices')
      .select('id')
      .eq('notification_email', user.email)
      .maybeSingle();
    if (practice?.id) return practice.id;
  }

  return null;
}

// GET — list available templates so the UI can render selection chips
export async function GET() {
  return NextResponse.json({
    templates: TEMPLATES.map(({ slug, name, description, requires_signature, content_url }) => ({
      slug,
      name,
      description,
      requires_signature,
      content_url,
    })),
  });
}

// POST — adopt one or more templates into the practice's intake documents
// Body: { slugs: string[] } — slugs of templates to add. Omit/empty to add all.
export async function POST(req: NextRequest) {
  const practiceId = await getPracticeId(req);
  if (!practiceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { slugs?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const requestedSlugs = Array.isArray(body.slugs) && body.slugs.length > 0
    ? body.slugs
    : TEMPLATES.map((t) => t.slug);

  const toAdopt = TEMPLATES.filter((t) => requestedSlugs.includes(t.slug));
  if (toAdopt.length === 0) {
    return NextResponse.json({ error: 'No valid templates selected' }, { status: 400 });
  }

  // Avoid duplicating templates the practice already has (by name)
  const { data: existing } = await supabase
    .from('intake_documents')
    .select('name')
    .eq('practice_id', practiceId);
  const existingNames = new Set((existing ?? []).map((d) => d.name));

  // Determine starting sort_order
  const { data: maxOrderRows } = await supabase
    .from('intake_documents')
    .select('sort_order')
    .eq('practice_id', practiceId)
    .order('sort_order', { ascending: false })
    .limit(1);
  const startOrder = (maxOrderRows?.[0]?.sort_order ?? 0) + 1;

  const now = new Date().toISOString();
  const rows = toAdopt
    .filter((t) => !existingNames.has(t.name))
    .map((t, idx) => ({
      practice_id: practiceId,
      name: t.name,
      description: t.description,
      requires_signature: t.requires_signature,
      content_url: t.content_url,
      active: true,
      sort_order: startOrder + idx,
      created_at: now,
      updated_at: now,
    }));

  if (rows.length === 0) {
    return NextResponse.json({
      created: 0,
      skipped: toAdopt.length,
      message: 'All selected templates already exist',
    });
  }

  const { data: inserted, error } = await supabase
    .from('intake_documents')
    .insert(rows)
    .select('id, name');

  if (error) {
    console.error('[templates] insert failed:', error);
    return NextResponse.json({ error: 'Failed to create templates' }, { status: 500 });
  }

  return NextResponse.json({
    created: inserted?.length ?? 0,
    skipped: toAdopt.length - (inserted?.length ?? 0),
    documents: inserted,
  });
}
