'use client'
// app/reset-password/page.tsx
//
// Wave 24: AWS / Cognito does NOT use the legacy Supabase recovery
// link. Reset flow runs entirely in the Cognito Hosted UI:
//   1. User clicks "Forgot password" on /login/aws → Cognito Hosted
//      UI sends an email with a 6-digit code.
//   2. User enters code + new password in the Hosted UI.
//   3. Cognito redirects back to /login/aws on success.
//
// This page exists only because legacy bookmarks point here. We
// render an explainer + a link into the Cognito Hosted UI flow.

import Link from 'next/link'

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 border border-gray-200">
        <h1 className="text-2xl font-semibold text-gray-900 mb-3">Reset your password</h1>
        <p className="text-sm text-gray-600 mb-6">
          Password resets are now handled in the Harbor login screen. Click
          below to go to the login page and select &quot;Forgot password&quot; —
          you&apos;ll receive a 6-digit code by email and can set a new password
          from there.
        </p>
        <Link
          href="/login/aws"
          className="inline-flex items-center justify-center w-full px-4 py-3 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium"
        >
          Go to login
        </Link>
        <p className="text-xs text-gray-400 mt-4 text-center">
          Need help? Email <a href="mailto:hello@harborreceptionist.com" className="underline">hello@harborreceptionist.com</a>.
        </p>
      </div>
    </div>
  )
}
