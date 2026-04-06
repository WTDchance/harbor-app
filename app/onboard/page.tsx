import { redirect } from 'next/navigation'

// The old /onboard flow has been replaced by the polished /signup wizard.
// This stub permanently redirects any existing traffic (bookmarks, old
// marketing links, etc.) to the new signup experience.
export default function OnboardRedirect() {
  redirect('/signup')
}
