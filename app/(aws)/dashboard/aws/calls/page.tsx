// Calls list — first AWS-native EHR page. Reads call_logs from RDS via Drizzle,
// gated by Cognito session, scoped to the user's practice.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerSession } from '@/lib/aws/session'
import { getUserAndPractice, db, schema } from '@/lib/aws/db'
import { eq, desc } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fmtDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default async function CallsPage() {
  const session = await getServerSession()
  if (!session) redirect('/login/aws?next=/dashboard/aws/calls')
  const row = await getUserAndPractice(session.sub)
  if (!row?.practice) {
    return (
      <main className="max-w-5xl mx-auto p-8">
        <h1 className="text-2xl font-semibold mb-4">Calls</h1>
        <p className="text-amber-700">No practice linked to your account.</p>
      </main>
    )
  }
  const practiceId = row.practice.id

  const calls = await db
    .select({
      id: schema.callLogs.id,
      callerPhone: schema.callLogs.callerPhone,
      startedAt: schema.callLogs.startedAt,
      durationSeconds: schema.callLogs.durationSeconds,
      summary: schema.callLogs.summary,
      sentiment: schema.callLogs.sentiment,
      callType: schema.callLogs.callType,
      bookedAppointment: schema.callLogs.bookedAppointment,
      crisisFlagged: schema.callLogs.crisisFlagged,
      patientId: schema.callLogs.patientId,
    })
    .from(schema.callLogs)
    .where(eq(schema.callLogs.practiceId, practiceId))
    .orderBy(desc(schema.callLogs.startedAt))
    .limit(50)

  return (
    <main className="max-w-5xl mx-auto p-8">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Calls</h1>
          <p className="text-sm text-gray-500 mt-1">
            {row.practice.name} · last 50 calls
          </p>
        </div>
        <Link href="/dashboard/aws" className="text-sm text-teal-700 hover:text-teal-900">
          ← Dashboard
        </Link>
      </div>

      {calls.length === 0 ? (
        <div className="bg-white border rounded-lg p-8 text-center">
          <p className="text-sm text-gray-500">No calls yet.</p>
          <p className="text-xs text-gray-400 mt-1">
            Calls answered by Ellie will appear here once voice routes through this stack.
          </p>
        </div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">When</th>
                <th className="text-left px-4 py-2 font-medium">Caller</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium">Duration</th>
                <th className="text-left px-4 py-2 font-medium">Outcome</th>
                <th className="text-left px-4 py-2 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {calls.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 whitespace-nowrap text-gray-700">{fmtDate(c.startedAt)}</td>
                  <td className="px-4 py-2 whitespace-nowrap font-mono text-xs">{c.callerPhone || '—'}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-gray-600">{c.callType || '—'}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-gray-600">{fmtDuration(c.durationSeconds)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {c.crisisFlagged && <span className="inline-block px-2 py-0.5 text-xs rounded bg-red-50 text-red-700 mr-1">crisis</span>}
                    {c.bookedAppointment && <span className="inline-block px-2 py-0.5 text-xs rounded bg-teal-50 text-teal-700">booked</span>}
                    {!c.crisisFlagged && !c.bookedAppointment && <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-2 text-gray-600 max-w-md truncate">{c.summary || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
