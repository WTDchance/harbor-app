'use client'

import { useEffect, useState } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { createClient } from '@/lib/supabase-browser'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [practiceName, setPracticeName] = useState('Loading...')
  const supabase = createClient()

  useEffect(() => {
    const loadPractice = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: practice } = await supabase
        .from('practices')
        .select('name')
        .eq('notification_email', user.email)
        .single()

      if (practice?.name) {
        setPracticeName(practice.name)
      }
    }
    loadPractice()
  }, [supabase])

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar practiceName={practiceName} />
      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  )
}
