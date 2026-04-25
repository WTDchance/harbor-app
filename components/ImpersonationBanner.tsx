"use client";
// components/ImpersonationBanner.tsx
// Harbor — Admin impersonation banner.
// Shows when the logged-in admin is "acting as" a specific practice via the
// harbor_act_as_practice cookie. Provides an Exit button that clears the
// cookie and reloads.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

const supabase = createClient();

export default function ImpersonationBanner() {
  const [practiceName, setPracticeName] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      try {
        const res = await fetch("/api/admin/act-as", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        if (!res.ok) return; // Not admin or no impersonation
        const json = await res.json();
        if (!cancelled && json.practice?.name) {
          setPracticeName(json.practice.name);
        }
      } catch {
        // Silent — non-admins will get 403
      }
    }
    check();
    return () => { cancelled = true; };
  }, []);

  async function exitActAs() {
    setExiting(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch("/api/admin/act-as", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    window.location.href = "/admin/practices";
  }

  if (!practiceName) return null;

  return (
    <div className="bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between text-sm font-medium border-b border-amber-600">
      <div className="flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 1.5L14.5 13.5H1.5L8 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M8 6v3.5M8 11.5v.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span>
          Admin view — acting as <strong>{practiceName}</strong>
        </span>
      </div>
      <button
        onClick={exitActAs}
        disabled={exiting}
        className="px-3 py-1 rounded-md bg-amber-950 text-amber-50 hover:bg-amber-900 disabled:opacity-60 text-xs font-semibold"
      >
        {exiting ? "Exiting…" : "Exit admin view"}
      </button>
    </div>
  );
}
