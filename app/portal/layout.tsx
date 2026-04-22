// app/portal/layout.tsx — patient-portal layout. Intentionally simple:
// no sidebar, no therapist-app chrome. The therapist dashboard and the
// patient portal share a Next.js app but the UX is fully separated.

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/harbor-icon-clean.png" alt="" className="h-7 w-auto" />
            <span className="font-semibold text-gray-900">Harbor Patient Portal</span>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}
