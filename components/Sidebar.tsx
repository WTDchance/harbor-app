'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Phone, MessageSquare, Settings, Home, LogOut } from 'lucide-react'
import clsx from 'clsx'

interface SidebarProps {
  practiceName?: string
}

export function Sidebar({ practiceName = 'TheraLink' }: SidebarProps) {
  const pathname = usePathname()

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: Home },
    { href: '/dashboard/calls', label: 'Call Logs', icon: Phone },
    { href: '/dashboard/messages', label: 'Messages', icon: MessageSquare },
    { href: '/dashboard/settings', label: 'Settings', icon: Settings },
  ]

  return (
    <aside className="w-64 bg-teal-600 text-white min-h-screen flex flex-col">
      {/* Logo / Practice Name */}
      <div className="p-6 border-b border-teal-700">
        <h1 className="text-2xl font-bold">TheraLink</h1>
        <p className="text-sm text-teal-100 mt-1">{practiceName}</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6">
        <ul className="space-y-2">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname.startsWith(href)
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors',
                    isActive
                      ? 'bg-teal-700 text-white'
                      : 'text-teal-100 hover:bg-teal-700 hover:text-white'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span>{label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Sign out */}
      <div className="p-4 border-t border-teal-700">
        <button
          onClick={() => {
            // Implement sign out
            window.location.href = '/api/auth/logout'
          }}
          className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-teal-100 hover:bg-teal-700 hover:text-white transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  )
}
