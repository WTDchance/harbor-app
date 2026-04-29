import type { Metadata } from 'next'
import { MarketingNav } from '@/components/marketing/MarketingNav'
import { MarketingFooter } from '@/components/marketing/MarketingFooter'

const SITE_URL = 'https://harboroffice.ai'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Harbor — HIPAA-aligned EHR & AI Receptionist for therapy practices',
    template: '%s | Harbor',
  },
  description:
    'Harbor is the HIPAA-aligned EHR and AI receptionist built for therapy practices. Voice-to-text notes, no-show prediction, claim resubmits, and 24/7 call coverage — on a HIPAA-aligned AWS stack.',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: 'Harbor',
    title: 'Harbor — EHR & AI Receptionist for therapy practices',
    description:
      'The HIPAA-aligned EHR and AI receptionist for therapy practices. Built on AWS, signed BAAs, full clinical workflow.',
    images: [{ url: '/harbor-logo-120.png', width: 120, height: 120, alt: 'Harbor' }],
  },
  twitter: {
    card: 'summary',
    title: 'Harbor — EHR & AI Receptionist for therapy practices',
    description:
      'The HIPAA-aligned EHR and AI receptionist for therapy practices.',
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
