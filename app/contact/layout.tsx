import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Book a Demo — See Harbor in Action',
  description:
    'Schedule a 15-minute demo to see how Harbor answers calls, screens new patients, and handles intake paperwork for your therapy practice.',
  robots: { index: true, follow: true },
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
