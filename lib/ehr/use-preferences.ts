// lib/ehr/use-preferences.ts
// Tiny client-side hook for fetching and caching the practice's UI
// preferences. Any client component that needs to gate on features reads
// via usePreferences().
//
// Cache is in-memory with a 60s freshness window so we don't hammer the
// API for every card on the patient profile. If the therapist changes a
// preference, the settings page refreshes the page so stale cache is flushed.

'use client'

import { useEffect, useState } from 'react'
import { normalize, type UiPreferences } from './preferences'

let CACHE: { prefs: UiPreferences; at: number } | null = null
const FRESH_MS = 60_000

export function usePreferences(): { prefs: UiPreferences | null; loading: boolean } {
  const [prefs, setPrefs] = useState<UiPreferences | null>(
    CACHE && Date.now() - CACHE.at < FRESH_MS ? CACHE.prefs : null,
  )
  const [loading, setLoading] = useState<boolean>(!prefs)

  useEffect(() => {
    if (prefs) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/ehr/preferences')
        if (res.status === 403) {
          // EHR not enabled — don't block; caller treats null as "render default"
          if (!cancelled) setLoading(false)
          return
        }
        const json = await res.json()
        const p = normalize(json.preferences)
        CACHE = { prefs: p, at: Date.now() }
        if (!cancelled) setPrefs(p)
      } catch {
        // Swallow — component falls back to default behavior.
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [prefs])

  return { prefs, loading }
}

/** Server-side flush — call from the settings page after a PATCH so other tabs
 *  pick up changes on their next mount. Client-side only — no-op on server. */
export function invalidatePreferencesCache() {
  CACHE = null
}
