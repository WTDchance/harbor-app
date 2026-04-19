// lib/hooks/usePractice.ts
// Canonical hook for resolving the current practice in client components.
//
// Calls /api/practice/me which reads the act-as cookie server-side,
// ensuring the admin sees the correct practice when impersonating.
//
// DO NOT query users.practice_id directly from client components.
// That bypasses practice isolation and can leak data across practices.

import { useState, useEffect } from 'react'

interface Practice {
  id: string
  name: string | null
  ai_name: string | null
  phone_number: string | null
  timezone: string | null
  npi: string | null
  tax_id: string | null
  insurance_accepted: string[] | null
  notification_emails: string[] | null
  scheduling_mode: string | null
  daily_recap_enabled: boolean | null
  daily_recap_time: string | null
  daily_recap_method: string | null
  hours_json: Record<string, any> | null
  greeting: string | null
  intake_config: Record<string, any> | null
  [key: string]: any // allow other fields
}

interface UsePracticeResult {
  practice: Practice | null
  practiceId: string | null
  loading: boolean
  error: string | null
  /** Re-fetch the practice (e.g. after saving settings) */
  refresh: () => void
}

export function usePractice(): UsePracticeResult {
  const [practice, setPractice] = useState<Practice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch('/api/practice/me')
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: 'Failed to load practice' }))
          setError(body.error || `HTTP ${res.status}`)
          setLoading(false)
          return
        }
        const data = await res.json()
        setPractice(data.practice)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message || 'Network error')
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [tick])

  return {
    practice,
    practiceId: practice?.id ?? null,
    loading,
    error,
    refresh: () => setTick(t => t + 1),
  }
}
