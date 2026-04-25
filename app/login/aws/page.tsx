// AWS-side login: server-component redirect into Cognito Hosted UI.
//
// The legacy /login page handles Supabase auth. /login/aws bypasses it and
// hands control to Cognito. After auth, Cognito redirects back to
// /api/auth/callback which sets HttpOnly cookies and bounces to the
// originally requested path.

import { redirect } from 'next/navigation'
import { loginUrl } from '@/lib/aws/cognito'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<{ next?: string }>
}

export default async function AwsLoginPage({ searchParams }: Props) {
  const { next } = await searchParams
  // Pass `next` through Cognito's `state` so /api/auth/callback can land us
  // back where we were trying to go.
  const target = next && next.startsWith('/') ? next : '/dashboard/aws'
  redirect(loginUrl(target))
}
