import type { Metadata } from 'next'
import { Suspense } from 'react'
import { PostHogProvider } from '@/components/PostHogProvider'
import './globals.css'

const siteUrl = 'https://harborreceptionist.com'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Harbor — AI Receptionist for Therapy Practices',
    template: '%s | Harbor',
  },
  description:
    "Never miss a patient call again. Harbor's AI receptionist answers 24/7, screens new patients, and sends you full call summaries — starting at $397/mo.",
  viewport: 'width=device-width, initial-scale=1',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-16.png', type: 'image/png', sizes: '16x16' },
      { url: '/favicon-32.png', type: 'image/png', sizes: '32x32' },
    ],
    shortcut: '/favicon.ico',
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Harbor',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteUrl,
    siteName: 'Harbor',
    title: 'Harbor — AI Receptionist for Therapy Practices',
    description:
      "Never miss a patient call again. Harbor's AI receptionist answers 24/7, screens new patients, and sends you full call summaries.",
    images: [
      {
        url: '/harbor-logo-120.png',
        width: 120,
        height: 120,
        alt: 'Harbor AI Receptionist — Never miss a patient call again',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'Harbor — AI Receptionist for Therapy Practices',
    description:
      "Never miss a patient call again. Harbor's AI receptionist answers 24/7, screens new patients, and sends you full call summaries.",
    images: ['/harbor-logo-120.png'],
  },
  alternates: {
    canonical: siteUrl,
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Harbor" />
        <meta name="application-name" content="Harbor" />
        <meta name="theme-color" content="#0d9488" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="shortcut icon" href="/favicon.ico" />
        {/* Sized apple-touch-icon for sharp home-screen rendering on iOS. */}
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />

        {/* Chunk-load error recovery. Catches stale-chunk 404s after a deploy
            and force-reloads once per 30s to get fresh HTML. Silent no-op
            otherwise. See also sentry.client.config.ts for error filtering. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  if (typeof window === 'undefined') return;
  var CHUNK_SIGNATURES = [
    'ChunkLoadError',
    'Loading chunk',
    'Loading CSS chunk',
    'Failed to fetch dynamically imported module',
    'Importing a module script failed',
    'a[e] is not a function',
  ];
  function isChunkError(reason) {
    if (!reason) return false;
    var msg = '';
    if (typeof reason === 'string') msg = reason;
    else if (reason.message) msg = String(reason.message);
    else if (reason.name) msg = String(reason.name);
    if (reason && reason.name === 'ChunkLoadError') return true;
    for (var i = 0; i < CHUNK_SIGNATURES.length; i++) {
      if (msg.indexOf(CHUNK_SIGNATURES[i]) !== -1) return true;
    }
    return false;
  }
  function reloadOnce() {
    try {
      var key = 'harbor_chunk_reload_at';
      var last = Number(sessionStorage.getItem(key) || '0');
      var now = Date.now();
      if (now - last < 30000) return;
      sessionStorage.setItem(key, String(now));
    } catch (e) {}
    window.location.reload();
  }
  window.addEventListener('unhandledrejection', function(e) {
    if (isChunkError(e && e.reason)) {
      if (e.preventDefault) e.preventDefault();
      reloadOnce();
    }
  });
  window.addEventListener('error', function(e) {
    if (isChunkError(e && (e.error || e.message))) {
      reloadOnce();
    }
  });
})();`
          }}
        />

        {/* Google Tag Manager — replace GTM-XXXXXXX with your container ID */}
        {process.env.NEXT_PUBLIC_GTM_ID && (
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${process.env.NEXT_PUBLIC_GTM_ID}');`,
            }}
          />
        )}

        {/* Microsoft Clarity — replace CLARITY_ID with your project ID */}
        {process.env.NEXT_PUBLIC_CLARITY_ID && (
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(c,l,a,r,i,t,y){
c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window,document,"clarity","script","${process.env.NEXT_PUBLIC_CLARITY_ID}");`,
            }}
          />
        )}
      </head>
      <body className="bg-gray-50 font-sans antialiased">
        {/* GTM noscript fallback */}
        {process.env.NEXT_PUBLIC_GTM_ID && (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${process.env.NEXT_PUBLIC_GTM_ID}`}
              height="0"
              width="0"
              style={{ display: 'none', visibility: 'hidden' }}
            />
          </noscript>
        )}
        <Suspense fallback={null}>
          <PostHogProvider>
            {children}
          </PostHogProvider>
        </Suspense>
        <script
          dangerouslySetInnerHTML={{
            __html: `
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(function(error) {
              console.log('Service Worker registration failed:', error)
            })
          }
        `,
          }}
        />
      </body>
    </html>
  )
}
