import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Harbor — AI Receptionist for Therapy Practices',
  description: "Never miss a patient call again. Harbor's AI receptionist answers 24/7, screens new patients, and sends you full call summaries.",
  viewport: 'width=device-width, initial-scale=1',
  icons: {
    icon: '/favicon.ico',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Harbor',
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
        <meta name="theme-color" content="#0d9488" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" type="image/png" href="/favicon.ico" />
      </head>
      <body className="bg-gray-50 font-sans antialiased">
        {children}
        <script>
          {`
            if ('serviceWorker' in navigator) {
              navigator.serviceWorker.register('/sw.js').catch(function(error) {
                console.log('Service Worker registration failed:', error)
              })
            }
          `}
        </script>
      </body>
    </html>
  )
}
