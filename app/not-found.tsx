import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-teal-600 mb-4">404</h1>
        <p className="text-gray-500 mb-6">This page doesn't exist.</p>
        <Link href="/" className="bg-teal-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-teal-700 transition-colors">
          Back to Harbor
        </Link>
      </div>
    </div>
  )
}
