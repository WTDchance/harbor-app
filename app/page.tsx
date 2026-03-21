// Home page - redirect to dashboard
import { redirect } from 'next/navigation'

export default function Home() {
  // Redirect to dashboard - authentication would be checked here
  redirect('/dashboard')
}
