'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import clsx from 'clsx'
import {
  LayoutDashboard,
  Users,
  PlusCircle,
  LogOut,
  Activity,
  BarChart3,
  ArrowLeftRight,
  UserPlus,
  LifeBuoy,
} from 'lucide-react'

const navItems = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/admin/signups', label: 'Signups', icon: UserPlus },
  { href: '/admin/practices', label: 'All Practices', icon: Users },
  { href: '/admin/provision', label: 'Add Therapist', icon: PlusCircle },
  { href: '/admin/support', label: 'Support Tickets', icon: LifeBuoy },
  { href: '/admin/activity', label: 'Activity Feed', icon: Activity },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const supabase = createClient()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Admin sidebar — slate/dark tone to differentiate from therapist view */}
      <aside className="w-64 bg-slate-900 text-white min-h-screen flex flex-col">
        <div className="p-6 border-b border-slate-700">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/harbor-logo.svg" alt="Harbor" className="h-10" />
            <div>
              <p className="text-xs text-slate-400 mt-0.5">Admin Console</p>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-4 py-6">
          <ul className="space-y-1">
            {navItems.map(({ href, label, icon: Icon, exact }) => {
              const isActive = exact ? pathname === href : pathname.startsWith(href)
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className={clsx(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm',
                      isActive
                        ? 'bg-teal-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="p-4 border-t border-slate-700 space-y-1">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white transition-colors text-sm font-medium"
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span>Practice Dashboard</span>
          </Link>
          <p className="text-xs text-slate-500 mb-1 px-1 pt-2">Signed in as admin</p>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors text-sm"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  )
}
