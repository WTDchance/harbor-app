// AWS-side dashboard placeholder.
//
// Confirms the full Cognito → RDS round trip works:
//   1. middleware saw a harbor_id cookie (cookie presence check)
//   2. getServerSession() verifies the ID token against Cognito JWKS
//   3. getUserAndPractice() resolves the cognito sub → users row → practices row
//
// Phase 4 replaces this with the real EHR dashboard.

import { getServerSession } from '@/lib/aws/session'
import { getUserAndPractice } from '@/lib/aws/db'
import { redirect } from 'next/navigation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function AwsDashboardPage() {
  const session = await getServerSession()
  // Middleware should have caught this, but double-belt-and-suspenders for the
  // edge case of a present-but-invalid ID token cookie.
  if (!session) redirect('/login/aws?next=/dashboard/aws')

  let userPracticeError: string | null = null
  let row: Awaited<ReturnType<typeof getUserAndPractice>> = null
  try {
    row = await getUserAndPractice(session.sub)
  } catch (e: unknown) {
    userPracticeError = e instanceof Error ? e.message : 'unknown'
  }

  return (
    <main className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-2">Harbor AWS Dashboard</h1>
      <p className="text-sm text-gray-500 mb-6">
        Phase 1 sanity surface. Real EHR pages land in Phase 4.
      </p>

      <section className="bg-white border rounded-lg p-4 mb-4">
        <h2 className="text-sm font-medium text-gray-700 mb-2">Cognito session</h2>
        <dl className="text-sm grid grid-cols-3 gap-y-1">
          <dt className="text-gray-500">sub</dt>
          <dd className="col-span-2 font-mono text-xs">{session.sub}</dd>
          <dt className="text-gray-500">email</dt>
          <dd className="col-span-2">{session.email || <em>not in token</em>}</dd>
          <dt className="text-gray-500">verified</dt>
          <dd className="col-span-2">{session.emailVerified ? 'yes' : 'no'}</dd>
          <dt className="text-gray-500">expires</dt>
          <dd className="col-span-2">{session.expiresAt}</dd>
        </dl>
      </section>

      <section className="bg-white border rounded-lg p-4 mb-4">
        <h2 className="text-sm font-medium text-gray-700 mb-2">RDS lookup</h2>
        {userPracticeError && (
          <p className="text-sm text-red-600">DB error: {userPracticeError}</p>
        )}
        {!userPracticeError && !row && (
          <p className="text-sm text-amber-700">
            No <code>users</code> row for cognito_sub <code>{session.sub}</code>.
            Seed task #59 should have created one — verify the demo seed.
          </p>
        )}
        {row && (
          <dl className="text-sm grid grid-cols-3 gap-y-1">
            <dt className="text-gray-500">user.id</dt>
            <dd className="col-span-2 font-mono text-xs">{row.user.id}</dd>
            <dt className="text-gray-500">user.role</dt>
            <dd className="col-span-2">{row.user.role}</dd>
            <dt className="text-gray-500">user.full_name</dt>
            <dd className="col-span-2">{row.user.full_name || <em>—</em>}</dd>
            <dt className="text-gray-500">practice</dt>
            <dd className="col-span-2">
              {row.practice ? (
                <>
                  <span className="font-medium">{row.practice.name}</span>{' '}
                  <span className="text-gray-500">
                    ({row.practice.provisioning_state}, voice:{row.practice.voice_provider})
                  </span>
                </>
              ) : (
                <em>not linked</em>
              )}
            </dd>
          </dl>
        )}
      </section>

      <div className="flex items-center gap-2">
        <a
          href="/dashboard/aws/calls"
          className="inline-block px-3 py-1.5 text-sm border rounded text-teal-700 border-teal-200 hover:bg-teal-50"
        >
          Calls →
        </a>
        <a
          href="/api/auth/logout"
          className="inline-block px-3 py-1.5 text-sm border rounded text-gray-700 hover:bg-gray-50"
        >
          Sign out
        </a>
      </div>
    </main>
  )
}
