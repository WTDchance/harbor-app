// AWS-side dashboard landing — links to all ported features.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerSession } from '@/lib/aws/session'
import { getUserAndPractice, db, schema } from '@/lib/aws/db'
import { eq, gte, count, desc, and, sql } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function AwsDashboardPage() {
  const session = await getServerSession()
  if (!session) redirect('/login/aws?next=/dashboard/aws')
  const row = await getUserAndPractice(session.sub)

  if (!row?.practice) {
    return (
      <main className="max-w-3xl mx-auto p-8">
        <h1 className="text-2xl font-semibold mb-2">Harbor</h1>
        <p className="text-amber-700 text-sm">
          No practice linked to <code>{session.email}</code>. Contact support.
        </p>
        <a href="/api/auth/logout" className="mt-4 inline-block text-sm text-gray-600 hover:underline">Sign out</a>
      </main>
    )
  }
  const practiceId = row.practice.id

  // Quick stats
  const [callStats, patientStats, upcomingStats] = await Promise.all([
    db.select({ total: count() }).from(schema.callLogs).where(eq(schema.callLogs.practiceId, practiceId)),
    db.select({ total: count() }).from(schema.patients).where(eq(schema.patients.practiceId, practiceId)),
    db.select({ total: count() }).from(schema.appointments).where(and(
      eq(schema.appointments.practiceId, practiceId),
      gte(schema.appointments.startsAt, new Date()),
    )),
  ])

  // 7-day call count
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const [recentCalls] = await db.select({ total: count() })
    .from(schema.callLogs)
    .where(and(
      eq(schema.callLogs.practiceId, practiceId),
      gte(schema.callLogs.startedAt, sevenDaysAgo),
    ))

  return (
    <main className="max-w-5xl mx-auto p-8">
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold">{row.practice.name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Signed in as {session.email} · {row.user.role}
            {row.practice.voiceProvider !== 'twilio' && ` · voice:${row.practice.voiceProvider}`}
          </p>
        </div>
        <a href="/api/auth/logout" className="text-sm text-gray-500 hover:text-gray-700">Sign out</a>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Tile label="Total calls" value={callStats[0]?.total ?? 0} />
        <Tile label="Calls (7d)" value={recentCalls?.total ?? 0} />
        <Tile label="Patients" value={patientStats[0]?.total ?? 0} />
        <Tile label="Upcoming" value={upcomingStats[0]?.total ?? 0} />
      </div>

      {/* Section grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <NavCard
          href="/dashboard/aws/calls"
          title="Calls"
          desc="Every call answered by Ellie, with transcripts and outcome."
        />
        <NavCard
          href="/dashboard/aws/patients"
          title="Patients"
          desc="Longitudinal record per patient — calls, appointments, notes."
        />
        <NavCard
          href="/dashboard/aws/appointments"
          title="Appointments"
          desc="Upcoming sessions and recent activity."
        />
        <NavCard
          href="#"
          title="Progress notes"
          desc="Coming next: SOAP notes drafted from call transcripts."
          disabled
        />
      </div>
    </main>
  )
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border rounded-lg p-3">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
    </div>
  )
}

function NavCard({ href, title, desc, disabled }: { href: string; title: string; desc: string; disabled?: boolean }) {
  if (disabled) {
    return (
      <div className="bg-gray-50 border border-dashed rounded-lg p-4 opacity-60">
        <p className="font-medium">{title}</p>
        <p className="text-xs text-gray-500 mt-1">{desc}</p>
      </div>
    )
  }
  return (
    <Link href={href} className="block bg-white border rounded-lg p-4 hover:border-teal-300 hover:shadow-sm transition">
      <p className="font-medium text-teal-700">{title} →</p>
      <p className="text-xs text-gray-500 mt-1">{desc}</p>
    </Link>
  )
}
