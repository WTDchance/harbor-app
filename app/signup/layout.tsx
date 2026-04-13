import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign Up — Get Your AI Receptionist in 5 Minutes',
  description:
    'Set up Harbor for your therapy practice in under 5 minutes. HIPAA-compliant AI receptionist that answers calls, screens patients, and sends intake forms — starting at $197/mo.',
  robots: { index: true, follow: true },
}

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
