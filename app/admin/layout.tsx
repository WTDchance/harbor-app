'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { useState, useEffect } from 'react'
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
  ChevronLeft,
  ChevronRight,
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

const COLLAPSED_KEY = 'harbor_admin_sidebar_collapsed'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem(COLLAPSED_KEY) === '1') {
        setCollapsed(true)
      }
    } catch { /* ignore */ }
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v
      try {
        if (typeof window !== 'undefined') window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
      } catch {}
      return next
    })
  }

  const handleSignOut = async () => {
    // Wave 21: Cognito logout — /api/auth/logout clears harbor_id +
    // harbor_access cookies and redirects to /login/aws.
    window.location.href = '/api/auth/logout'
  }

  const sidebarWidth = collapsed ? 'md:w-16' : 'md:w-64'

  return (
    <div className="flex h-screen bg-gray-50">
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

      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={clsx(
          'fixed md:static inset-y-0 left-0 z-50 w-64 bg-slate-900 text-white flex flex-col',
          'transform transition-all duration-200',
          sidebarWidth,
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        <div className="p-4 md:p-6 border-b border-slate-700 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity overflow-hidden"
            onClick={() => setMobileOpen(false)}
            title={collapsed ? 'Harbor Admin' : undefined}
          >
            <img src="/harbor-logo.svg" alt="Harbor" className="h-10 flex-shrink-0" />
            {!collapsed && (
              <div>
                <p className="text-xs text-slate-400 mt-0.5 whitespace-nowrap">Admin Console</p>
              </div>
            )}
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden p-1.5 -mr-1 rounded-md hover:bg-slate-800"
            aria-label="Close admin menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-2 md:px-3 py-4 overflow-y-auto">
          <ul className="space-y-1">
            {navItems.map(({ href, label, icon: Icon, exact }) => {
              const isActive = exact ? pathname === href : pathname.startsWith(href)
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setMobileOpen(false)}
                    title={collapsed ? label : undefined}
                    className={clsx(
                      'flex items-center gap-3 rounded-lg transition-colors text-sm',
                      collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5',
                      isActive
                        ? 'bg-teal-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    )}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {!collapsed && <span className="whitespace-nowrap">{label}</span>}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="p-2 md:p-4 border-t border-slate-700 space-y-1">
          <Link
            href="/dashboard"
            onClick={() => setMobileOpen(false)}
            title={collapsed ? 'Practice Dashboard' : undefined}
            className={clsx(
              'flex items-center gap-3 w-full rounded-lg bg-teal-600 hover:bg-teal-500 text-white transition-colors text-sm font-medium',
              collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'
            )}
          >
            <ArrowLeftRight className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span className="whitespace-nowrap">Practice Dashboard</span>}
          </Link>
          {!collapsed && (
            <p className="text-xs text-slate-500 mb-1 px-1 pt-2">Signed in as admin</p>
          )}
          <button
            onClick={handleSignOut}
            title={collapsed ? 'Sign out' : undefined}
            className={clsx(
              'flex items-center gap-3 w-full rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors text-sm',
              collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'
            )}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span className="whitespace-nowrap">Sign out</span>}
          </button>

          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={clsx(
              'hidden md:flex items-center gap-2 w-full rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors text-xs mt-2 border border-slate-800',
              collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2'
            )}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto pt-14 md:pt-0">
        <div className="p-4 md:p-8">{children}</div>
      </main>
    </div>
  )
}
