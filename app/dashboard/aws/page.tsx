// Safety-net redirect for stale links/bookmarks pointing at /dashboard/aws.
// The post-Cognito-login flow used to land here; the canonical destination
// is /dashboard. This server-side redirect makes any cached state (browser
// history, bookmarks, search engines) graceful.

import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function DashboardAwsRedirect() {
  redirect('/dashboard')
}
