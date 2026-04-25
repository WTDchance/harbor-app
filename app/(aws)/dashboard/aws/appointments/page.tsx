// Appointments list — port of /dashboard/appointments.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerSession } from '@/lib/aws/session'
import { getUserAndPractice, db, schema } from '@/lib/aws/db'
import { eq, gte, desc, and } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fmtDateTime(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default async function AppointmentsPage() {
  const session = await getServerSession()
  if (!session) redirect('/login/aws?next=/dashboard/aws/appointments')
  const row = await getUserAndPractice(session.sub)
  if (!row?.practice) {
    return (
      <main className="max-w-5xl mx-auto p-8">
        <h1 className="text-2xl font-semibold mb-4">Appointments</h1>
        <p className="text-amber-700">No practice linked to your account.</p>
      </main>
    )
  }

  const upcoming = await db
    .select({
      id: schema.appointments.id,
      startsAt: schema.appointments.startsAt,
      endsAt: schema.appointments.endsAt,
      status: schema.appointments.status,
      visitType: schema.appointments.visitType,
      notes: schema.appointments.notes,
      patientId: schema.appointments.patientId,
      patientFullName: schema.patients.fullName,
      patientFirst: schema.patients.firstName,
      patientLast: schema.patients.lastName,
    })
    .from(schema.appointments)
    .leftJoin(schema.patients, eq(schema.appointments.patientId, schema.patients.id))
    .where(and(
      eq(schema.appointments.practiceId, row.practice.id),
      gte(schema.appointments.startsAt, new Date()),
    ))
    .orderBy(schema.appointments.startsAt)
    .limit(30)

  const recent = await db
    .select({
      id: schema.appointments.id,
      startsAt: schema.appointments.startsAt,
      status: schema.appointments.status,
      visitType: schema.appointments.visitType,
      patientFullName: schema.patients.fullName,
      patientFirst: schema.patients.firstName,
      patientLast: schema.patients.lastName,
    })
    .from(schema.appointments)
    .leftJoin(schema.patients, eq(schema.appointments.patientId, schema.patients.id))
    .where(eq(schema.appointments.practiceId, row.practice.id))
    .orderBy(desc(schema.appointments.startsAt))
    .limit(10)

  return (
    <main className="max-w-5xl mx-auto p-8">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Appointments</h1>
          <p className="text-sm text-gray-500 mt-1">{row.practice.name}</p>
        </div>
        <Link href="/dashboard/aws" className="text-sm text-teal-700 hover:text-teal-900">← Dashboard</Link>
      </div>

      <section className="mb-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500 mb-3">
          Upcoming ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          <div className="bg-white border rounded-lg p-6 text-sm text-gray-500">
            No upcoming appointments.
          </div>
        ) : (
          <div className="bg-white border rounded-lg divide-y">
            {upcoming.map(a => {
              const name = a.patientFullName || [a.patientFirst, a.patientLast].filter(Boolean).join(' ') || 'Unknown'
              return (
                <div key={a.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{name}</p>
                    <p className="text-xs text-gray-500">{a.visitType || 'Session'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm">{fmtDateTime(a.startsAt)}</p>
                    <p className="text-xs text-gray-500">{a.status}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500 mb-3">
          Recent activity
        </h2>
        {recent.length === 0 ? (
          <div className="text-sm text-gray-500">No appointments yet.</div>
        ) : (
          <div className="bg-white border rounded-lg divide-y">
            {recent.map(a => {
              const name = a.patientFullName || [a.patientFirst, a.patientLast].filter(Boolean).join(' ') || 'Unknown'
              return (
                <div key={a.id} className="px-4 py-2 flex items-center justify-between text-sm">
                  <span>{name}</span>
                  <span className="text-gray-500">{fmtDateTime(a.startsAt)} · {a.status}</span>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}
