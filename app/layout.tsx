import type { Metadata } from 'next'
import { Suspense } from 'react'
import { PostHogProvider } from '@/components/PostHogProvider'
import './globals.css'

const siteUrl = 'https://harborreceptionist.com'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Harbor — AI Receptionist for Therapy Practices',
    template: '%s | Harbor Receptionist',
  },
  description:
    "Never miss a patient call again. Harbor's AI receptionist answers 24/7, screens new patients, and sends you full call summaries — starting at $397/mo.",
  viewport: 'width=device-width, initial-scale=1',
  icons: {
    icon: [
      { url: '/harbor-icon-clean.png', type: 'image/png' },
    ],
    shortcut: '/harbor-icon-clean.png',
    apple: '/harbor-icon-clean.png',
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
    siteName: 'Harbor Receptionist',
    title: 'Harbor — AI Receptionist for Therapy Practices',
    description:
      "Never miss a patient call again. Harbor's AI receptionist answers 24/7, screens new patients, and sends you full call summaries.",
    images: [
      {
        url: '/og-image.svg',
        width: 1200,
        height: 630,
        alt: 'Harbor AI Receptionist — Never miss a patient call again',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Harbor — AI Receptionist for Therapy Practices',
    description:
      "Never miss a patient call again. Harbor's AI receptionist answers 24/7, screens new patients, and sends you full call summaries.",
    images: ['/og-image.svg'],
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
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Harbor" />
        <meta name="theme-color" content="#1f375d" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" type="image/png" href="/harbor-icon-clean.png" />
        <link rel="shortcut icon" type="image/png" href="/harbor-icon-clean.png" />
        <link rel="apple-touch-icon" href="/harbor-icon-clean.png" />

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
