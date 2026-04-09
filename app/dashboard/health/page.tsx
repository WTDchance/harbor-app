/**
 * Practice-owner health page.
 *
 * Lists fail-safe events from harbor_events, grouped by severity. This is
 * the "Harbor has my back" surface â if the reconciler catches a missed
 * call or a dropped patient, the owner sees it here loud and red.
 *
 * Server component: reads via the RLS-scoped browser Supabase client so
 * each owner only sees their own practice.
 */

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ResolveButton from './resolve-button';

export const dynamic = 'force-dynamic';

type HarborEvent = {
  id: string;
  event_type: string;
  severity: 'info' | 'warn' | 'error' | 'critical';
  source: string;
  message: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
  call_log_id: string | null;
  patient_id: string | null;
  intake_token_id: string | null;
};

function severityColor(sev: string): string {
  switch (sev) {
    case 'critical':
      return 'bg-red-50 border-red-300 text-red-900';
    case 'error':
      return 'bg-orange-50 border-orange-300 text-orange-900';
    case 'warn':
      return 'bg-yellow-50 border-yellow-300 text-yellow-900';
    default:
      return 'bg-gray-50 border-gray-200 text-gray-700';
  }
}

function severityEmoji(sev: string): string {
  if (sev === 'critical') return 'ð´';
  if (sev === 'error') return 'ð ';
  if (sev === 'warn') return 'ð¡';
  return 'ð¢';
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default async function HealthPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Critical + error + warn, unresolved, last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: unresolved } = await supabase
    .from('harbor_events')
    .select('*')
    .in('severity', ['critical', 'error', 'warn'])
    .is('resolved_at', null)
    .gte('created_at', thirtyDaysAgo)
    .order('severity', { ascending: false })
    .order('created_at', { ascending: false });

  const { data: resolved } = await supabase
    .from('harbor_events')
    .select('*')
    .in('severity', ['critical', 'error', 'warn'])
    .not('resolved_at', 'is', null)
    .gte('created_at', thirtyDaysAgo)
    .order('created_at', { ascending: false })
    .limit(50);

  const bySeverity = (sev: string) =>
    (unresolved ?? []).filter((e: HarborEvent) => e.severity === sev);

  const critical = bySeverity('critical');
  const error = bySeverity('error');
  const warn = bySeverity('warn');

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Harbor Health</h1>
          <p className="text-sm text-gray-500 mt-1">
            Every call, patient, and intake is watched. If anything slips, it shows up here.
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl">
            {critical.length > 0
              ? 'ð´'
              : error.length > 0
              ? 'ð '
              : warn.length > 0
              ? 'ð¡'
              : 'ð¢'}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {critical.length + error.length + warn.length === 0
              ? 'All clear'
              : `${critical.length + error.length + warn.length} item${
                  critical.length + error.length + warn.length === 1 ? '' : 's'
                }`}
          </div>
        </div>
      </div>

      {critical.length === 0 && error.length === 0 && warn.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <div className="text-4xl mb-2">ð¢</div>
          <div className="font-medium text-green-900">Everything is working</div>
          <div className="text-sm text-green-700 mt-1">
            Harbor checks itself every 5 minutes. Any missed calls, stuck intakes, or failed
            alerts will appear here automatically.
          </div>
        </div>
      )}

      {critical.length > 0 && (
        <Section title="Critical â act now" events={critical} />
      )}
      {error.length > 0 && <Section title="Needs attention" events={error} />}
      {warn.length > 0 && <Section title="Heads up" events={warn} />}

      {resolved && resolved.length > 0 && (
        <details className="mt-10">
          <summary className="cursor-pointer text-sm text-gray-500">
            Resolved in the last 30 days ({resolved.length})
          </summary>
          <div className="mt-3 space-y-2">
            {resolved.map((e: HarborEvent) => (
              <div
                key={e.id}
                className="text-xs text-gray-500 border-b border-gray-100 py-2"
              >
                <span className="font-mono mr-2">{e.event_type}</span>
                {e.message} <span className="ml-2">Â· {formatWhen(e.created_at)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="mt-10 text-xs text-gray-400 text-center">
        <Link href="/dashboard" className="hover:underline">
          â Back to dashboard
        </Link>
      </div>
    </div>
  );
}

function Section({ title, events }: { title: string; events: HarborEvent[] }) {
  return (
    <div className="mb-8">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
        {title}
      </h2>
      <div className="space-y-3">
        {events.map((e) => (
          <div key={e.id} className={`border rounded-lg p-4 ${severityColor(e.severity)}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span>{severityEmoji(e.severity)}</span>
                  <span className="font-mono text-xs opacity-70">{e.event_type}</span>
                  <span className="text-xs opacity-60">Â· {formatWhen(e.created_at)}</span>
                </div>
                <div className="mt-1 font-medium">{e.message ?? 'No message'}</div>
                {Object.keys(e.payload ?? {}).length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs opacity-70 cursor-pointer">
                      Details
                    </summary>
                    <pre className="text-xs mt-2 bg-white/50 rounded p-2 overflow-x-auto">
                      {JSON.stringify(e.payload, null, 2)}
                    </pre>
                  </details>
                )}
                {e.call_log_id && (
                  <Link
                    href={`/dashboard/calls/${e.call_log_id}`}
                    className="text-xs underline mt-2 inline-block"
                  >
                    View call â
                  </Link>
                )}
              </div>
              <ResolveButton eventId={e.id} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
