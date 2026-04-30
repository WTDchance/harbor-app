import type { Metadata } from 'next'
import { MarketingNav } from '@/components/marketing/MarketingNav'
import { MarketingFooter } from '@/components/marketing/MarketingFooter'

const SITE_URL = 'https://harboroffice.ai'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Harbor — AI Receptionist for Therapy Practices',
    template: '%s | Harbor',
  },
  description:
    'AI receptionist that answers calls 24/7, captures intake, verifies insurance in real time, and books appointments. Plugs into any EHR — Athena, Ensora, SimplePractice, TheraNest, or your existing calendar. HIPAA-aligned on AWS.',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: 'Harbor',
    title: 'Harbor — AI Receptionist for Therapy Practices',
    description:
      'AI receptionist that answers calls 24/7, captures intake, verifies insurance, books appointments. Integrates with any EHR. HIPAA-aligned.',
    images: [{ url: '/harbor-logo-120.png', width: 120, height: 120, alt: 'Harbor' }],
  },
  twitter: {
    card: 'summary',
    title: 'Harbor — AI Receptionist for Therapy Practices',
    description:
      'AI receptionist that answers calls 24/7, captures intake, verifies insurance, books appointments. Integrates with any EHR.',
    images: ['/harbor-logo-120.png'],
  },
  alternates: { canonical: SITE_URL },
  robots: { index: true, follow: true },
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <MarketingNav />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  )
}
