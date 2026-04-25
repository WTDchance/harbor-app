// Resolve the public origin of the current request.
//
// Behind an ALB, Next.js's `req.url` reflects the container's bind address
// (localhost:3000), not the externally-facing host. We need the real origin
// when constructing redirects (otherwise OAuth callbacks bounce users to
// http://localhost:3000/...).
//
// Order of precedence:
//   1. X-Forwarded-Proto + X-Forwarded-Host (set by the ALB/proxy)
//   2. Host header (raw incoming request)
//   3. process.env.APP_URL (worst-case fallback)

import type { NextRequest } from 'next/server'

const ENV_APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')

export function publicOrigin(req: NextRequest | Request): string {
  const headers = (req as Request).headers
  const fwdHost = headers.get('x-forwarded-host')
  const fwdProto = headers.get('x-forwarded-proto')
  const host = headers.get('host')

  // Reject any host that looks like a container-local bind. Behind the ALB
  // the public host should always be lab.harboroffice.ai (or whatever).
  const looksInternal = (h: string | null) =>
    !h || h.startsWith('localhost') || h.startsWith('127.') || h.startsWith('0.0.0.0')

  if (!looksInternal(fwdHost)) {
    const proto = fwdProto || 'https'
    return `${proto}://${fwdHost}`
  }
  if (!looksInternal(host)) {
    const proto = fwdProto || 'https'
    return `${proto}://${host}`
  }
  if (ENV_APP_URL) return ENV_APP_URL
  // Last-ditch fallback so we never emit a localhost URL in prod redirects.
  return 'https://lab.harboroffice.ai'
}

/**
 * Build an absolute URL for a path on the public origin.
 *   absoluteUrl(req, '/dashboard/aws') → https://lab.harboroffice.ai/dashboard/aws
 */
export function absoluteUrl(req: NextRequest | Request, path: string): string {
  const origin = publicOrigin(req)
  const safePath = path.startsWith('/') ? path : `/${path}`
  return `${origin}${safePath}`
}
