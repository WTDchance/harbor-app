// app/dashboard/ehr/layout.tsx
// Server-side gate for all EHR pages. Any route under /dashboard/ehr/*
// renders through this layout, which resolves the caller's practice and
// short-circuits to the ComingSoon page if ehr_enabled is false.

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { redirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase'
import { getEffectivePracticeId } from '@/lib/active-practice'
import { isEhrEnabled } from '@/lib/ehr/feature-flag'
import { EhrComingSoon } from '@/components/ehr/ComingSoon'
import { WelcomeTour } from '@/components/ehr/WelcomeTour'

export default async function EhrLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }: any) => {
              cookieStore.set(name, value, options)
            })
          } catch {}
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/ehr')

  const practiceId = await getEffectivePracticeId(supabaseAdmin, user)
  const enabled = await isEhrEnabled(supabaseAdmin, practiceId)

  if (!enabled) return <EhrComingSoon feature="Harbor EHR" />

  return (
    <>
      <WelcomeTour />
      {children}
    </>
  )
}
