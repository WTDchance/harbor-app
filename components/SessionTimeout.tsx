"use client";
// SessionTimeout.tsx
// HIPAA §164.312(a)(2)(iii) — Automatic logoff
// Monitors user activity and auto-logs out after 15 minutes of inactivity.
// Warns the user 2 minutes before timeout with an option to extend.

import { useEffect, useRef, useState, useCallback } from "react";

const TIMEOUT_MS = 15 * 60 * 1000;   // 15 minutes
const WARNING_MS = 2 * 60 * 1000;    // warn at 2 min before timeout
const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "scroll"] as const;

export default function SessionTimeout() {
  const [showWarning, setShowWarning] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivityRef = useRef(Date.now());

  const logout = useCallback(async () => {
    // Log the timeout event before signing out
    try {
      await fetch("/api/audit-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "session_timeout",
          details: { reason: "inactivity", timeout_minutes: 15 },
        }),
      });
    } catch {}
    // Wave 24: Cognito logout. /api/auth/logout clears harbor_id +
    // harbor_access cookies and redirects to /login/aws.
    window.location.href = "/api/auth/logout?reason=timeout";
  }, []);

  const resetTimers = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowWarning(false);

    if (timerRef.current) clearTimeout(timerRef.current);
    if (warningRef.current) clearTimeout(warningRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    // Set warning timer (fires 2 min before timeout)
    warningRef.current = setTimeout(() => {
      setShowWarning(true);
      setRemaining(WARNING_MS / 1000);
      countdownRef.current = setInterval(() => {
        setRemaining((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, TIMEOUT_MS - WARNING_MS);

    // Set logout timer
    timerRef.current = setTimeout(logout, TIMEOUT_MS);
  }, [logout]);

  useEffect(() => {
    resetTimers();

    const handleActivity = () => {
      // Debounce: only reset if >10s since last reset
      if (Date.now() - lastActivityRef.current > 10_000) {
        resetTimers();
      }
    };

    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, handleActivity, { passive: true });
    }

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        document.removeEventListener(event, handleActivity);
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [resetTimers]);

  if (!showWarning) return null;

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#d97706" strokeWidth="2" />
            <path d="M12 6v6l4 2" stroke="#d97706" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Session Expiring
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          For your security, you will be automatically logged out in{" "}
          <span className="font-mono font-bold text-amber-600">
            {minutes}:{seconds.toString().padStart(2, "0")}
          </span>
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={resetTimers}
            className="px-5 py-2.5 rounded-lg text-white text-sm font-medium shadow-sm transition-colors"
            style={{ backgroundColor: "#1f375d" }}
          >
            Stay Logged In
          </button>
          <button
            onClick={logout}
            className="px-5 py-2.5 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Log Out Now
          </button>
        </div>
      </div>
    </div>
  );
}
