// Patient detail — pulls patient + recent calls + recent appointments + progress notes.

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerSession } from '@/lib/aws/session'
import { getUserAndPractice, db, schema } from '@/lib/aws/db'
import { and, eq, desc } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fmtDateTime(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

type Props = { params: Promise<{ id: string }> }

export default async function PatientDetailPage({ params }: Props) {
  const { id } = await params
  const session = await getServerSession()
  if (!session) redirect(`/login/aws?next=/dashboard/aws/patients/${id}`)
  const row = await getUserAndPractice(session.sub)
  if (!row?.practice) notFound()

  const [patient] = await db
    .select()
    .from(schema.patients)
    .where(and(
      eq(schema.patients.id, id),
      eq(schema.patients.practiceId, row.practice.id),
    ))
    .limit(1)

  if (!patient) notFound()

  const [calls, appts, notes] = await Promise.all([
    db.select({
      id: schema.callLogs.id,
      startedAt: schema.callLogs.startedAt,
      durationSeconds: schema.callLogs.durationSeconds,
      summary: schema.callLogs.summary,
      callType: schema.callLogs.callType,
    }).from(schema.callLogs)
      .where(eq(schema.callLogs.patientId, id))
      .orderBy(desc(schema.callLogs.startedAt))
      .limit(10),
    db.select({
      id: schema.appointments.id,
      startsAt: schema.appointments.startsAt,
      status: schema.appointments.status,
      visitType: schema.appointments.visitType,
    }).from(schema.appointments)
      .where(eq(schema.appointments.patientId, id))
      .orderBy(desc(schema.appointments.startsAt))
      .limit(10),
    db.select({
      id: schema.ehrProgressNotes.id,
      createdAt: schema.ehrProgressNotes.createdAt,
      status: schema.ehrProgressNotes.status,
      cptCode: schema.ehrProgressNotes.cptCode,
      assessment: schema.ehrProgressNotes.assessment,
    }).from(schema.ehrProgressNotes)
      .where(eq(schema.ehrProgressNotes.patientId, id))
      .orderBy(desc(schema.ehrProgressNotes.createdAt))
      .limit(10),
  ])

  const name = patient.fullName || [patient.firstName, patient.lastName].filter(Boolean).join(' ') || 'Unknown'

  return (
    <main className="max-w-5xl mx-auto p-8">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {patient.status} · {patient.acquisitionSource || 'manual'}
            {patient.insuranceCarrier ? ` · ${patient.insuranceCarrier}` : ''}
          </p>
        </div>
        <Link href="/dashboard/aws/patients" className="text-sm text-teal-700 hover:text-teal-900">
          ← Patients
        </Link>
      </div>

      <section className="bg-white border rounded-lg p-4 mb-4">
        <h2 className="text-sm font-medium text-gray-700 mb-2">Contact</h2>
        <dl className="text-sm grid grid-cols-3 gap-y-1">
          <dt className="text-gray-500">Phone</dt>
          <dd className="col-span-2 font-mono text-xs">{patient.phoneNumber || '—'}</dd>
          <dt className="text-gray-500">Email</dt>
          <dd className="col-span-2">{patient.email || '—'}</dd>
          <dt className="text-gray-500">DOB</dt>
          <dd className="col-span-2">{patient.dateOfBirth ? new Date(patient.dateOfBirth).toLocaleDateString() : '—'}</dd>
        </dl>
      </section>

      <section className="bg-white border rounded-lg p-4 mb-4">
        <h2 className="text-sm font-medium text-gray-700 mb-2">Calls ({calls.length})</h2>
        {calls.length === 0 ? (
          <p className="text-sm text-gray-400">No calls.</p>
        ) : (
          <ul className="text-sm divide-y">
            {calls.map(c => (
              <li key={c.id} className="py-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">{fmtDateTime(c.startedAt)}</span>
                  <span className="text-xs text-gray-400">{c.callType || 'call'}</span>
                </div>
                {c.summary && <p className="text-xs text-gray-600 mt-1 truncate">{c.summary}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white border rounded-lg p-4 mb-4">
        <h2 className="text-sm font-medium text-gray-700 mb-2">Appointments ({appts.length})</h2>
        {appts.length === 0 ? (
          <p className="text-sm text-gray-400">No appointments.</p>
        ) : (
          <ul className="text-sm divide-y">
            {appts.map(a => (
              <li key={a.id} className="py-2 flex justify-between">
                <span>{fmtDateTime(a.startsAt)}</span>
                <span className="text-xs text-gray-500">{a.visitType || 'session'} · {a.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white border rounded-lg p-4">
        <h2 className="text-sm font-medium text-gray-700 mb-2">Progress notes ({notes.length})</h2>
        {notes.length === 0 ? (
          <p className="text-sm text-gray-400">No progress notes yet.</p>
        ) : (
          <ul className="text-sm divide-y">
            {notes.map(n => (
              <li key={n.id} className="py-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">{fmtDateTime(n.createdAt)}</span>
                  <span className="text-xs text-gray-400">{n.cptCode || ''} · {n.status}</span>
                </div>
                {n.assessment && <p className="text-xs text-gray-600 mt-1 line-clamp-2">{n.assessment}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
