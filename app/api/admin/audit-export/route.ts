// FILE: app/api/admin/audit-export/route.ts
// Admin audit log endpoint — cross-practice visibility + CSV export.
//
// Auth: Bearer ${CRON_SECRET}
//
// GET /api/admin/audit-export
//   Query params:
//     practice_id  — filter to a single practice (optional)
//     from         — ISO date start (optional, default 30 days ago)
//     to           — ISO date end (optional, default now)
//     action       — filter by action type (optional)
//     severity     — filter by severity level (optional)
//     format       — "json" (default) or "csv"
//     limit        — max rows (default 1000, max 10000)
//     offset       — pagination offset (default 0)
//
// Returns:
//   JSON: { logs, total, practice_name?, exported_at }
//   CSV:  Content-Disposition attachment with timestamped filename

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function GET(req: NextRequest) {
  // Auth: CRON_SECRET bearer token
  const auth = req.headers.get('authorization') || '';
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`;
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized();

  const url = new URL(req.url);
  const practiceId = url.searchParams.get('practice_id');
  const action = url.searchParams.get('action');
  const severity = url.searchParams.get('severity');
  const format = url.searchParams.get('format') || 'json';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '1000'), 10000);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  // Default date range: last 30 days
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = url.searchParams.get('from') || defaultFrom.toISOString();
  const to = url.searchParams.get('to') || now.toISOString();

  // Build query
  let query = supabaseAdmin
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .gte('timestamp', from)
    .lte('timestamp', to)
    .order('timestamp', { ascending: false })
    .range(offset, offset + limit - 1);

  if (practiceId) query = query.eq('practice_id', practiceId);
  if (action) query = query.eq('action', action);
  if (severity) query = query.eq('severity', severity);

  const { data: logs, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Resolve practice name if filtered to one practice
  let practiceName: string | null = null;
  if (practiceId) {
    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('name')
      .eq('id', practiceId)
      .maybeSingle();
    practiceName = practice?.name ?? null;
  }

  // CSV export
  if (format === 'csv') {
    const csvRows: string[] = [];

    // Header
    csvRows.push([
      'timestamp',
      'action',
      'severity',
      'user_email',
      'user_id',
      'practice_id',
      'resource_type',
      'resource_id',
      'ip_address',
      'user_agent',
      'details',
    ].join(','));

    // Data rows
    for (const log of logs ?? []) {
      csvRows.push([
        csvEscape(log.timestamp),
        csvEscape(log.action),
        csvEscape(log.severity),
        csvEscape(log.user_email),
        csvEscape(log.user_id),
        csvEscape(log.practice_id),
        csvEscape(log.resource_type),
        csvEscape(log.resource_id),
        csvEscape(log.ip_address),
        csvEscape(log.user_agent),
        csvEscape(JSON.stringify(log.details || {})),
      ].join(','));
    }

    const csv = csvRows.join('\n');
    const dateSlug = now.toISOString().slice(0, 10);
    const nameSlug = practiceName
      ? practiceName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      : 'all-practices';
    const filename = `harbor-audit-${nameSlug}-${dateSlug}.csv`;

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  // JSON response
  return NextResponse.json({
    logs,
    total: count,
    practice_name: practiceName,
    filters: { practice_id: practiceId, from, to, action, severity },
    exported_at: now.toISOString(),
  });
}

// ---- Helpers ----------------------------------------------------------------

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Wrap in quotes if contains comma, newline, or quote
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
