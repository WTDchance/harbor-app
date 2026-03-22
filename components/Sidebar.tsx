'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Phone, MessageSquare, Settings, Home, LogOut, Users, AlertTriangle, CreditCard, BarChart3, Bell, Plug, FileText, TrendingUp, CalendarDays, Calendar, Shield } from 'lucide-react'
import clsx from 'clsx'
import { createClient } from '@/lib/supabase-browser'

interface SidebarProps {
  practiceName?: string
}

export function Sidebar({ practiceName = 'Harbor' }: SidebarProps) {
  const pathname = usePathname()
  const supabase = createClient()
  const [crisisCount, setCrisisCount] = useState(0)
  const [practiceId, setPracticeId] = useState<string | null>(null)

  useEffect(() => {
    const fetchCrisisCount = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: practice } = await supabase
        .from('practices')
        .select('id')
        .eq('notification_email', user.email)
        .single()
      if (!practice?.id) return
      setPracticeId(practice.id)
      const { count } = await supabase
        .from('crisis_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('practice_id', practice.id)
        .eq('reviewed', false)
      setCrisisCount(count || 0)
    }
    fetchCrisisCount()
  }, [supabase])

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: Home, exact: true },
    { href: '/dashboard/calls', label: 'Call Logs', icon: Phone },
    { href: '/dashboard/appointments', label: 'Appointments', icon: CalendarDays },
    { href: '/dashboard/waitlist', label: 'Waitlist', icon: Users },
    { href: '/dashboard/crisis', label: 'Crisis Alerts', icon: AlertTriangle, badge: crisisCount > 0 ? crisisCount : null },
    { href: '/dashboard/notes', label: 'Notes', icon: FileText },
    { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
    { href: '/dashboard/outcomes', label: 'Outcomes', icon: TrendingUp },
    { href: '/dashboard/calendar', label: 'Calendar', icon: Calendar },
    { href: '/dashboard/reminders', label: 'Reminders', icon: Bell },
    { href: '/dashboard/billing', label: 'Billing', icon: CreditCard },
    { href: '/dashboard/team', label: 'Team', icon: Users },
    { href: '/dashboard/integrations', label: 'Integrations', icon: Plug },
    { href: '/dashboard/settings', label: 'Settings', icon: Settings },
  ]

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <aside className="w-64 bg-teal-600 text-white min-h-screen flex flex-col">
      <div className="p-6 border-b border-teal-700">
        <h1 className="text-2xl font-bold">Harbor</h1>
        <p className="text-sm text-teal-100 mt-1 truncate">{practiceName}</p>
      </div>
      <nav className="flex-1 px-4 py-6 overflow-y-auto">
        <ul className="space-y-1">
          {navItems.map(({ href, label, icon: Icon, exact, badge }) => {
            const isActive = exact ? pathname === href : pathname.startsWith(href)
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-sm',
                    isActive
                      ? 'bg-teal-700 text-white'
                      : 'text-teal-100 hover:bg-teal-700 hover:text-white'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span>{label}</span>
                  {badge && (
                    <span className="ml-auto inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-600 text-white text-xs font-semibold">
                      {badge}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="p-4 border-t border-teal-700 space-y-1">
        <Link
          href="/admin"
          className="flex items-center gap-3 w-full px-4 py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white transition-colors text-sm font-medium"
        >
          <Shield className="w-4 h-4" />
          <span>Admin Console</span>
        </Link>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-teal-100 hover:bg-teal-700 hover:text-white transition-colors text-sm"
        >
          <LogOut className="w-5 h-5" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  )
}
