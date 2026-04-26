// app/dashboard/ehr/layout.tsx
//
// Wave 20 (AWS hotfix). Server-side gate for all /dashboard/ehr/* pages.
// Was on Supabase auth — that triggered an infinite redirect loop for
// Cognito-authenticated users (supabase.auth.getUser() returned null,
// layout redirected to /login, /login redirected to Cognito Hosted UI,
// Cognito sent the user back, layout fired again).
//
// AWS port: read the Cognito session via getApiSession() and gate on
// ctx.practice.ehr_enabled. No Supabase calls anywhere in this layout.

import { redirect } from 'next/navigation'
import { getApiSession } from '@/lib/aws/api-auth'
import { EhrComingSoon } from '@/components/ehr/ComingSoon'

export default async function EhrLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getApiSession()
  if (!ctx) {
    redirect('/login/aws?next=/dashboard/ehr')
  }

  if (!ctx.practice || ctx.practice.ehr_enabled !== true) {
    return <EhrComingSoon feature="Harbor EHR" />
  }

  return <>{children}</>
}
