'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: false,
      capture_pageleave: true,
      loaded: (posthog) => {
        if (process.env.NODE_ENV === 'development') posthog.debug()
      },
    })
  }, [])

  return (
    <PHProvider client={posthog}>
      <PostHogPageview />
      {children}
    </PHProvider>
  )
}

function PostHogPageview() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!pathname || !posthog) return
    const url = window.origin + pathname + (searchParams?.toString() ? '?' + searchParams.toString() : '')
    posthog.capture('$pageview', { $current_url: url })
  }, [pathname, searchParams])

  return null
  }
