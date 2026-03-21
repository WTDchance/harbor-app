import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Harbor - AI Receptionist for Therapy Practices',
  description: '24/7 AI receptionist for managing calls, SMS, and appointments',
  viewport: 'width=device-width, initial-scale=1',
  icons: {
    icon: '/favicon.ico',
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
      </head>
      <body className="bg-gray-50 font-sans antialiased">{children}</body>
    </html>
  )
}
