// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a user loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance monitoring — sample 10% of transactions in prod
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Session replay — capture 5% of sessions, 100% on error
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      // Mask all text in replays for HIPAA — no PHI leakage
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  // Filter out noisy/non-actionable errors
  ignoreErrors: [
    // Browser extensions
    /extensions\//i,
    /^chrome:\/\//i,
    // Network errors that aren't our fault
    'Network request failed',
    'Failed to fetch',
    'Load failed',
    // ResizeObserver noise
    'ResizeObserver loop',
    // Next.js chunk load errors after a deploy — user's browser has cached HTML
    // pointing at chunk hashes that no longer exist. Harmless; the inline
    // recovery script in app/layout.tsx force-reloads these so users self-heal.
    'ChunkLoadError',
    /Loading chunk \d+ failed/i,
    /Loading CSS chunk/i,
    /Failed to fetch dynamically imported module/i,
    /Importing a module script failed/i,
    // The specific webpack internal error we see on iOS Safari when a chunk
    // goes missing mid-session.
    /a\[e\] is not a function/,
  ],

  // Don't send PII — HIPAA requirement
  sendDefaultPii: false,

  // Only enable in production
  enabled: process.env.NODE_ENV === 'production',
})
