import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Log In — Harbor Dashboard',
  description:
    'Log in to your Harbor dashboard to manage calls, patients, intake forms, and practice settings.',
  robots: { index: false, follow: false },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
