// capacitor.config.ts
// Harbor EHR — mobile app wrapper configuration.
//
// Strategy: the patient portal (/portal/*) is served as a web view inside
// a thin Capacitor shell. Patients download "Harbor" from the App Store
// or Play Store, log in once with their portal token, and the app
// remembers the session. Everything else stays server-rendered — no
// feature fork between web portal and mobile app.
//
// This config is read by @capacitor/cli. It does NOT affect the Next.js
// build on Railway. Mobile builds are a separate pipeline (see
// docs/harbor-ehr-mobile.md).

import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.harbor.app',
  appName: 'Harbor',
  // webDir is only used when shipping static assets. We're deferring
  // to the live server below via `server.url`, so this is a placeholder.
  webDir: 'out',

  server: {
    // In development, point to localhost:3000 so changes reload live.
    // In production, point to the real portal URL. When this entry
    // exists, Capacitor loads the site over the network instead of
    // bundling static assets — the simplest and most maintainable way
    // to ship a WebView-based portal.
    //
    // URL transition note: the apex domain harboroffice.ai went live
    // this week and is now the canonical home for the portal. The
    // legacy harborreceptionist.com host is being kept in
    // allowNavigation below for backward compatibility during the
    // transition (existing installs / bookmarks / email links), and
    // can be removed once traffic has fully migrated.
    url: process.env.CAPACITOR_SERVER_URL || 'https://harboroffice.ai/portal',
    // Allow the shell to include the portal's login cookie
    androidScheme: 'https',
    cleartext: false,
    // Only navigations to these hosts stay inside the app; anything else
    // opens in the system browser. Keeps the app scoped to Harbor.
    allowNavigation: [
      'harboroffice.ai',
      '*.harboroffice.ai',
      'lab.harboroffice.ai',
      // Backward compat during the harborreceptionist.com -> harboroffice.ai
      // transition. Safe to remove once all traffic has migrated.
      'harborreceptionist.com',
      '*.harborreceptionist.com',
      'meet.jit.si', // telehealth room opens in-app
      'checkout.stripe.com', // invoice pay opens in-app
    ],
  },

  ios: {
    contentInset: 'always',
    backgroundColor: '#ffffff',
  },
  android: {
    backgroundColor: '#ffffff',
    // Allow autoplay of microphone for dictation / telehealth
    webContentsDebuggingEnabled: false,
  },
}

export default config
