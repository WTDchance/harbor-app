'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import clsx from 'clsx'
import { useState } from 'react'
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
  HeartPulse,
  Shield,
  Menu,
  X,
} from 'lucide-react'

const navItems = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/admin/signups', label: 'Signups', icon: UserPlus },
  { href: '/admin/practices', label: 'All Practices', icon: Users },
  { href: '/admin/provision', label: 'Add Therapist', icon: PlusCircle },
  { href: '/admin/uptime', label: 'System Health', icon: HeartPulse },
  { href: '/admin/support', label: 'Support Tickets', icon: LifeBuoy },
  { href: '/admin/activity', label: 'Activity Feed', icon: Activity },
  { href: '/admin/audit', label: 'HIPAA Audit', icon: Shield },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const supabase = createClient()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile top bar — visible only below md breakpoint */}
      <div className="md:hidden fixed top-0 inset-x-0 z-40 bg-slate-900 text-white flex items-center justify-between px-4 h-14 border-b border-slate-800">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 -ml-2 rounded-md hover:bg-slate-800"
          aria-label="Open admin menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <Link href="/admin" className="text-sm font-semibold tracking-wide">
          Harbor Admin
        </Link>
        <div className="w-9" />
      </div>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Admin sidebar — slate/dark tone to differentiate from therapist view */}
      <aside
        className={clsx(
          'fixed md:static inset-y-0 left-0 z-50 w-64 bg-slate-900 text-white flex flex-col',
          'transform transition-transform duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        <div className="p-6 border-b border-slate-700 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            onClick={() => setMobileOpen(false)}
          >
            <img src="/harbor-logo.svg" alt="Harbor" className="h-10" />
            <div>
              <p className="text-xs text-slate-400 mt-0.5">Admin Console</p>
            </div>
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden p-1.5 -mr-1 rounded-md hover:bg-slate-800"
            aria-label="Close admin menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-4 py-6 overflow-y-auto">
          <ul className="space-y-1">
            {navItems.map(({ href, label, icon: Icon, exact }) => {
              const isActive = exact ? pathname === href : pathname.startsWith(href)
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setMobileOpen(false)}
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
            onClick={() => setMobileOpen(false)}
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

      <main className="flex-1 overflow-auto pt-14 md:pt-0">
        <div className="p-4 md:p-8">{children}</div>
      </main>
    </div>
  )
}
