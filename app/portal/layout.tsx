// app/portal/layout.tsx — patient-portal layout. Intentionally simple:
// no sidebar, no therapist-app chrome.

import { PortalHeader } from './PortalHeader'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <PortalHeader />
      <main>{children}</main>
    </div>
  )
}
