'use client'

import { Sidebar } from '@/components/Sidebar'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // In a real app, you'd fetch the practice name from the user's session
  const practiceName = 'Hope and Harmony Counseling'

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar practiceName={practiceName} />
      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  )
}
