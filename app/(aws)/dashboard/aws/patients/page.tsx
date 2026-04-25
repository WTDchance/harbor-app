// Patients list — port of /dashboard/patients to RDS via Drizzle.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerSession } from '@/lib/aws/session'
import { getUserAndPractice, db, schema } from '@/lib/aws/db'
import { eq, desc } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function PatientsPage() {
  const session = await getServerSession()
  if (!session) redirect('/login/aws?next=/dashboard/aws/patients')
  const row = await getUserAndPractice(session.sub)
  if (!row?.practice) {
    return (
      <main className="max-w-5xl mx-auto p-8">
        <h1 className="text-2xl font-semibold mb-4">Patients</h1>
        <p className="text-amber-700">No practice linked to your account.</p>
      </main>
    )
  }

  const rows = await db
    .select({
      id: schema.patients.id,
      firstName: schema.patients.firstName,
      lastName: schema.patients.lastName,
      preferredName: schema.patients.preferredName,
      email: schema.patients.email,
      phone: schema.patients.phone,
      patientStatus: schema.patients.patientStatus,
      insuranceProvider: schema.patients.insuranceProvider,
      createdAt: schema.patients.createdAt,
    })
    .from(schema.patients)
    .where(eq(schema.patients.practiceId, row.practice.id))
    .orderBy(desc(schema.patients.createdAt))
    .limit(100)

  return (
    <main className="max-w-5xl mx-auto p-8">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Patients</h1>
          <p className="text-sm text-gray-500 mt-1">
            {row.practice.name} · {rows.length} {rows.length === 1 ? 'patient' : 'patients'}
          </p>
        </div>
        <Link href="/dashboard/aws" className="text-sm text-teal-700 hover:text-teal-900">← Dashboard</Link>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border rounded-lg p-8 text-center">
          <p className="text-sm text-gray-500">No patients yet.</p>
          <p className="text-xs text-gray-400 mt-1">
            Patients are created automatically from inbound calls and intake forms.
          </p>
        </div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Phone</th>
                <th className="text-left px-4 py-2 font-medium">Email</th>
                <th className="text-left px-4 py-2 font-medium">Insurance</th>
                <th className="text-left px-4 py-2 font-medium">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(p => {
                const name = [p.firstName, p.lastName].filter(Boolean).join(' ') || p.preferredName || '—'
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium">
                      <Link href={`/dashboard/aws/patients/${p.id}`} className="text-teal-700 hover:text-teal-900">
                        {name}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <span className="inline-block px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-700">
                        {p.patientStatus}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{p.phone || '—'}</td>
                    <td className="px-4 py-2 text-gray-600 truncate max-w-xs">{p.email || '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{p.insuranceProvider || '—'}</td>
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{fmtDate(p.createdAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
