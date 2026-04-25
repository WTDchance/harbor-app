// Route-group layout for the AWS-native (Cognito-backed) surface.
//
// Sits ABOVE /dashboard/aws and other path-B routes so they don't inherit
// app/dashboard/layout.tsx (which runs Supabase auth client-side and would
// kick Cognito users to /login).

export const metadata = {
  title: 'Harbor — AWS Lab',
  description: 'Harbor AWS staging environment',
}

export default function AwsRouteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 antialiased">
      {children}
    </div>
  )
}
