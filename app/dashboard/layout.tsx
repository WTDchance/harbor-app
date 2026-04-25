"use client";
// app/dashboard/layout.tsx
// Harbor -- Shared dashboard shell with sidebar navigation.
// Wraps all /dashboard/* pages. Handles auth gate and logout.

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import SessionTimeout from "@/components/SessionTimeout";

// --- Nav items ----------------------------------------------------------------
const NAV = [
  {
    href: "/dashboard",
    label: "Overview",
    exact: true,
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="1" y="1" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity="0.85" />
        <rect x="10" y="1" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity="0.85" />
        <rect x="1" y="10" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity="0.85" />
        <rect x="10" y="10" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity="0.85" />
      </svg>
    ),
  },
  {
    href: "/dashboard/appointments",
    label: "Appointments",
    exact: false,
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="1" y="3" width="16" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 1v4M12 1v4M1 7h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="6" cy="11" r="1" fill="currentColor" />
        <circle cx="9" cy="11" r="1" fill="currentColor" />
        <circle cx="12" cy="11" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: "/dashboard/patients",
    label: "Patients",
    exact: false,
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="6" r="3.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2 16c0-3.3 3.1-6 7-6s7 2.7 7 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/dashboard/intake",
    label: "Intake",
    exact: false,
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="3" y="1" width="12" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 6h6M6 9h6M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/dashboard/calls",
    label: "Calls",
    exact: false,
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M16 12.5c-1.2 0-2.4-.2-3.5-.6a.94.94 0 00-1 .2l-2.2 2.2A14.1 14.1 0 013.7 8.7l2.2-2.2c.3-.3.4-.7.2-1C5.7 4.4 5.5 3.2 5.5 2c0-.6-.4-1-1-1H1.5C.9 1 .5 1.4.5 2c0 8.3 6.7 15 15 15 .6 0 1-.4 1-1v-2.5c0-.6-.4-1-1-1z" fill="currentColor" fillOpacity="0.85" />
      </svg>
    ),
  },
  {
    href: "/dashboard/messaging",
    label: "Messages",
    exact: false,
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path
          d="M16 12a2 2 0 01-2 2H6l-4 4V4a2 2 0 012-2h10a2 2 0 012 2v8z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/dashboard/crisis",
    label: "Crisis Alerts",
    exact: false,
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 1L1 16h16L9 1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M9 7v4M9 13v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/dashboard/support",
    label: "Support",
    exact: false,
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6.5 6.5a2.5 2.5 0 014.5 1.5c0 1.5-2.5 2-2.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="9" cy="13" r="0.75" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: "/dashboard/audit-log",
    label: "Audit Log",
    exact: false,
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M3 3h12v12H3V3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M6 7h6M6 10h6M6 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M14 1v4M4 1v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    exact: false,
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.2 3.2l1.4 1.4M13.4 13.4l1.4 1.4M3.2 14.8l1.4-1.4M13.4 4.6l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

// --- Layout -------------------------------------------------------------------
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [practiceName, setPracticeName] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const COLLAPSED_KEY = 'harbor_dashboard_sidebar_collapsed';

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem(COLLAPSED_KEY) === '1') {
        setCollapsed(true);
      }
    } catch { /* ignore */ }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        if (typeof window !== 'undefined') window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      } catch {}
      return next;
    });
  };


  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Cognito session check via server-side endpoint. Returns 401 if not signed in.
        const res = await fetch("/api/aws/whoami", { credentials: "include" });
        if (!res.ok) {
          router.replace("/login/aws");
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setUserEmail(data.email ?? null);
        setPracticeName(data.practice?.name ?? null);
        setCheckingAuth(false);
      } catch {
        if (!cancelled) router.replace("/login/aws");
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  async function handleLogout() {
    // Cognito logout — clears HttpOnly cookies via /api/auth/logout, then bounces to Cognito's /logout
    window.location.href = "/api/auth/logout";
    return;
    router.replace("/login/aws");
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  function isActive(item: typeof NAV[number]) {
    if (item.exact) return pathname === item.href;
    return pathname.startsWith(item.href);
  }

  const initials = userEmail ? userEmail.slice(0, 2).toUpperCase() : "--";

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-20 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed md:static inset-y-0 left-0 z-30
          flex flex-col w-64 bg-white border-r border-gray-100
          transform transition-all duration-200
          ${collapsed ? "md:w-16" : "md:w-64"}
          ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
      >
        {/* Logo + Practice Name */}
        <Link
          href="/dashboard"
          className={`flex ${collapsed ? 'md:flex-row md:justify-center' : 'flex-col'} items-center gap-2 px-3 py-4 border-b border-gray-100 hover:bg-gray-50/80 transition-colors`}
          style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)' }}
          onClick={() => setMobileOpen(false)}
          title={collapsed ? (practiceName || 'Harbor') : undefined}
        >
          <div className="flex items-center gap-2.5">
            <img src="/harbor-icon-clean.png" alt="" className="h-10 w-auto" />
            {!collapsed && (
              <span className="text-xl font-bold tracking-wider" style={{ color: '#1f375d' }}>HARBOR</span>
            )}
          </div>
          {!collapsed && (
            <div className="text-center min-w-0 w-full">
              <p className="text-sm font-bold leading-tight truncate" style={{ color: '#1f375d' }}>
                {practiceName || "Harbor"}
              </p>
              <p className="text-xs leading-tight font-medium" style={{ color: '#52bfc0' }}>Practice Dashboard</p>
            </div>
          )}
        </Link>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                title={collapsed ? item.label : undefined}
                className={`
                  flex items-center gap-3 rounded-lg text-sm font-medium transition-colors
                  ${collapsed ? 'md:justify-center md:px-2 px-3 py-2.5' : 'px-3 py-2.5'}
                  ${active
                    ? "text-white shadow-sm"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  }
                `}
                style={active ? { backgroundColor: '#1f375d' } : undefined}
              >
                <span className={active ? "text-white/80" : "text-gray-400"}>
                  {item.icon}
                </span>
                {!collapsed && item.label}
                {active && !collapsed && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#52bfc0' }} />
                )}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="px-3 py-4 border-t border-gray-100 space-y-2">
          <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ${collapsed ? 'md:justify-center md:px-2' : ''}`}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#1f375d' }} title={collapsed ? (userEmail || undefined) : undefined}>
              <span className="text-xs font-semibold text-white">{initials}</span>
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 truncate">{userEmail}</p>
              </div>
            )}
            {!collapsed && (
              <button
                onClick={handleLogout}
                title="Sign out"
                className="text-gray-400 hover:text-red-500 transition-colors shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M11 11l3-3-3-3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>

          {/* Desktop collapse toggle */}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`hidden md:flex items-center gap-2 w-full rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors text-xs border border-gray-100 ${collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2'}`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={collapsed ? '' : 'rotate-180'}>
              <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-gray-500 hover:text-gray-700"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <img src="/harbor-icon-clean.png" alt="Harbor" className="h-7 w-auto" />
          <span className="text-sm font-semibold text-gray-900">
            {practiceName || ""}
          </span>
        </div>

        <ImpersonationBanner />
        <SessionTimeout />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
