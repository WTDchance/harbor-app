"use client";
// app/dashboard/layout.tsx
// Harbor -- Shared dashboard shell with sidebar navigation.
// Wraps all /dashboard/* pages. Handles auth gate and logout.

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import SessionTimeout from "@/components/SessionTimeout";

// EHR nav items — only shown when practice.ehr_enabled is true.
const EHR_NOTES_NAV = {
  href: "/dashboard/ehr/notes",
  label: "Progress Notes",
  exact: false,
  icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="3" y="2" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 6h6M6 9h6M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7 2v1M11 2v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
}

const EHR_AUDIT_NAV = {
  href: "/dashboard/ehr/audit",
  label: "EHR Audit Log",
  exact: false,
  icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M9 1l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V4l7-3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6 9l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

const EHR_MAND_REPORTS_NAV = {
  href: "/dashboard/ehr/mandatory-reports",
  label: "Mandatory Reports",
  exact: false,
  icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M9 1L1 16h16L9 1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 7v4M9 13v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
}

const EHR_REPORTS_NAV = {
  href: "/dashboard/ehr/reports",
  label: "Practice Reports",
  exact: false,
  icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="3" y="9" width="3" height="6" stroke="currentColor" strokeWidth="1.5" />
      <rect x="8" y="5" width="3" height="10" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="2" width="3" height="13" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
}

const EHR_SUPERVISION_NAV = {
  href: "/dashboard/ehr/supervision",
  label: "Supervision",
  exact: false,
  icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M3 14c0-3 3-5 6-5s6 2 6 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="9" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13 9l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
}

const EHR_BILLING_NAV = {
  href: "/dashboard/ehr/billing",
  label: "Billing",
  exact: false,
  icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1" y="4" width="16" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1 7h16" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="10" width="4" height="2" fill="currentColor" />
    </svg>
  ),
}

const EHR_MESSAGES_NAV = {
  href: "/dashboard/ehr/messages",
  label: "Patient Messages",
  exact: false,
  icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M16 12a2 2 0 01-2 2H6l-4 4V4a2 2 0 012-2h10a2 2 0 012 2v8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

const EHR_SCHED_REQ_NAV = {
  href: "/dashboard/ehr/scheduling-requests",
  label: "Scheduling Requests",
  exact: false,
  icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="3" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 1v4M12 1v4M2 7h14M8 11h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6 11l1 1 2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

const EHR_CASELOAD_NAV = {
  href: "/dashboard/ehr/caseload",
  label: "Caseload",
  exact: false,
  icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="13" cy="6" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1 15c0-2.5 2-4 5-4s5 1.5 5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M11 13c0-1.5 1.5-2.5 3-2.5s3 1 3 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
}

const EHR_WAITLIST_NAV = {
  href: "/dashboard/ehr/waitlist",
  label: "EHR Waitlist",
  exact: false,
  icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 5v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
}

const EHR_GROUPS_NAV = {
  href: "/dashboard/ehr/group-sessions",
  label: "Group Sessions",
  exact: false,
  icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="5" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="4" cy="11" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="14" cy="11" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 7.5c-1.5 2-3 3-5 3.5M9 7.5c1.5 2 3 3 5 3.5M4 13c0 1.5 2 2 5 2s5-.5 5-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
}

const EHR_REFERRALS_NAV = {
  href: "/dashboard/ehr/referrals",
  label: "Referrals",
  exact: false,
  icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="4" cy="9" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="14" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="14" cy="14" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 8l6-3M6 10l6 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
}

const EHR_OUTCOMES_NAV = {
  href: "/dashboard/ehr/outcomes",
  label: "Practice Outcomes",
  exact: false,
  icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M2 14L6 9L10 12L16 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 4h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
}

const EHR_CREDENTIALING_NAV = {
  href: "/dashboard/ehr/credentialing",
  label: "Credentialing",
  exact: false,
  icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M9 1l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V4l7-3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
}

const EHR_PREFERENCES_NAV = {
  href: "/dashboard/ehr/preferences",
  label: "EHR Preferences",
  exact: false,
  icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M3 9h4M11 9h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="9" cy="9" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 4h12M3 14h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
}

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
  const [ehrEnabled, setEhrEnabled] = useState(false);
  const [prefs, setPrefs] = useState<{
    features: Record<string, boolean>
    sidebar: { compact: boolean; show_analytics: boolean; show_billing: boolean }
  } | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // W47 T0 — saved sidebar module order from W46 T6 user prefs.
  // null = inherit (don't reorder); non-null = reorder visible items
  // by this list, items not in the list keep their original position
  // after the listed ones.
  const [savedSidebarOrder, setSavedSidebarOrder] = useState<string[] | null>(null);
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
        const res = await fetch("/api/aws/whoami", { credentials: "include" });
        if (!res.ok) {
          router.replace("/login/aws");
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setUserEmail(data.email ?? null);
        setPracticeName(data.practice?.name ?? null);
        if (data.practice?.ehrEnabled === true) setEhrEnabled(true);
        // Preferences (gracefully no-op if endpoint not yet ported)
        try {
          const pres = await fetch("/api/ehr/preferences");
          if (pres.ok) {
            const p = await pres.json();
            if (p.preferences) setPrefs({
              features: p.preferences.features,
              sidebar: p.preferences.sidebar,
            });
          }
        } catch {}
        setCheckingAuth(false);
      } catch {
        if (!cancelled) router.replace("/login/aws");
      }
    })();
    // W47 T0 — load saved sidebar module order from /api/ehr/me/layout.
  // Keeps the existing visibility logic intact; just reorders.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/ehr/me/layout')
        if (!res.ok) return
        const j = await res.json()
        const userPref = Array.isArray(j.user_pref_sidebar) ? j.user_pref_sidebar : null
        const practiceDefault = Array.isArray(j.practice_default_sidebar) ? j.practice_default_sidebar : null
        if (userPref && userPref.length > 0) setSavedSidebarOrder(userPref)
        else if (practiceDefault && practiceDefault.length > 0) setSavedSidebarOrder(practiceDefault)
      } catch { /* keep default */ }
    })()
  }, [])

  return () => { cancelled = true; };
  }, [router]);

  // Wave 38 TS3 — nudge un-enrolled therapists into TOTP setup once the
  // session is up. Patients are gated by role so this no-ops for them.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/auth/mfa-status')
        if (!r.ok) return
        const j = await r.json()
        if (!cancelled && j?.required) {
          if (typeof window !== 'undefined' &&
              !window.location.pathname.startsWith('/settings/security/mfa-setup')) {
            router.replace('/settings/security/mfa-setup')
          }
        }
      } catch {}
    })()
    return () => { cancelled = true }
  }, [router]);

  async function handleLogout() {
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
          {(() => {
            if (!ehrEnabled) return NAV
            const f = prefs?.features ?? {}
            const s = prefs?.sidebar ?? { compact: false, show_analytics: true, show_billing: true }
            const items: any[] = []
            // Top section — Overview, Appointments, Patients, Intake
            items.push(...NAV.slice(0, 4))
            // Clinical — EHR Notes + Caseload + Group Sessions
            items.push(EHR_NOTES_NAV)
            items.push(EHR_CASELOAD_NAV)
            items.push(EHR_WAITLIST_NAV)
            items.push(EHR_GROUPS_NAV)
            // Patient-facing channels
            items.push(EHR_MESSAGES_NAV)
            items.push(EHR_SCHED_REQ_NAV)
            // Middle — Calls, Messages, Crisis Alerts, Support, Audit Log (Harbor's)
            items.push(...NAV.slice(4, -1))
            // Analytics group (if show_analytics + feature enabled)
            if (s.show_analytics !== false && f.reports !== false) items.push(EHR_REPORTS_NAV)
            if (s.show_analytics !== false) items.push(EHR_REFERRALS_NAV)
            if (s.show_analytics !== false && f.assessments !== false) items.push(EHR_OUTCOMES_NAV)
            if (f.supervision !== false) items.push(EHR_SUPERVISION_NAV)
            items.push(EHR_CREDENTIALING_NAV)
            if (f.mandatory_reports !== false) items.push(EHR_MAND_REPORTS_NAV)
            if (s.show_billing !== false && f.billing !== false) items.push(EHR_BILLING_NAV)
            if (s.show_analytics !== false && f.audit_log !== false) items.push(EHR_AUDIT_NAV)
            items.push(EHR_PREFERENCES_NAV)
            // Bottom — Settings
            items.push(...NAV.slice(-1))

            // W47 T0 — reorder by user's saved sidebar pref. Map a
            // small set of href prefixes to the SidebarModuleId values
            // so this works without changing the legacy NAV item shape.
            if (savedSidebarOrder && savedSidebarOrder.length > 0) {
              const ID_TO_HREF_PREFIX: Record<string, string> = {
                today:    '/dashboard',
                patients: '/dashboard/patients',
                schedule: '/dashboard/calendar',
                inbox:    '/dashboard/messages',
                caseload: '/dashboard/ehr/caseload',
                notes:    '/dashboard/ehr/notes',
                tasks:    '/dashboard/ehr/tasks',
                groups:   '/dashboard/ehr/group-sessions',
                billing:  '/dashboard/ehr/billing',
                reports:  '/dashboard/ehr/reports',
                audit:    '/dashboard/ehr/audit',
                settings: '/dashboard/settings',
              }
              const orderedHrefs = savedSidebarOrder
                .map((id) => ID_TO_HREF_PREFIX[id])
                .filter(Boolean)

              const indexOfHref = (href: string): number => {
                for (let i = 0; i < orderedHrefs.length; i++) {
                  // Exact match wins, then prefix match. Items beyond
                  // the saved list (e.g. EHR_OUTCOMES_NAV) get -1 and
                  // sort to the end with stable ordering preserved.
                  if (href === orderedHrefs[i]) return i
                }
                for (let i = 0; i < orderedHrefs.length; i++) {
                  if (href.startsWith(orderedHrefs[i] + '/')) return i + 0.5
                }
                return Number.POSITIVE_INFINITY
              }

              items.sort((a: any, b: any) => {
                const ai = indexOfHref(a.href)
                const bi = indexOfHref(b.href)
                if (ai === Number.POSITIVE_INFINITY && bi === Number.POSITIVE_INFINITY) return 0
                return ai - bi
              })
            }

            return items
          })().map((item: typeof NAV[number]) => {
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
