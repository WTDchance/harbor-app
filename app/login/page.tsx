// /login — universal entry point. Redirects to Cognito Hosted UI.
//
// Pre-AWS migration this was a Supabase email/password form. Now every login
// goes through Cognito. The /login URL is preserved for backward compat with
// bookmarks, emails, and any third-party links.

import { redirect } from 'next/navigation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<{ next?: string; error?: string }> }

export default async function LoginPage({ searchParams }: Props) {
  const { next, error } = await searchParams
  // Forward the original `next` (and surface auth errors) to the AWS-side
  // login route, which then bounces to Cognito.
  const params = new URLSearchParams()
  if (next && next.startsWith('/')) params.set('next', next)
  if (error) params.set('error', error)
  const qs = params.toString()
  redirect(`/login/aws${qs ? `?${qs}` : ''}`)
}
