import type { Metadata } from 'next'
import Link from 'next/link'
import { getAllPosts } from '@/lib/blog'

export const metadata: Metadata = {
  title: 'Blog | Harbor',
  description:
    'Insights on AI receptionists, therapy practice management, patient communication, and HIPAA compliance from the Harbor team.',
  openGraph: {
    title: 'Harbor Blog',
    description:
      'Insights on AI receptionists, therapy practice management, and patient communication.',
    url: 'https://harborreceptionist.com/blog',
    siteName: 'Harbor',
    type: 'website',
  },
}

export default function BlogPage() {
  const posts = getAllPosts()

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <Link href="/" className="hover:opacity-80 transition-opacity">
          <img src="/harbor-logo.svg" alt="Harbor" className="h-14 w-auto" />
        </Link>
        <div className="flex items-center gap-6">
          <Link href="/blog" className="text-sm font-medium text-gray-900 hidden sm:block">Blog</Link>
          <Link href="/contact" className="text-sm text-gray-500 hover:text-gray-900 hidden sm:block">Book a Demo</Link>
          <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">Log in</Link>
          <Link
            href="/signup"
            className="text-white px-5 py-2 rounded-lg text-sm font-semibold transition-all hover:shadow-lg"
            style={{ backgroundColor: '#1f375d' }}
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section
        className="px-6 py-16 text-white text-center"
        style={{
          background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 50%, #52bfc0 100%)',
        }}
      >
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold mb-4">The Harbor Blog</h1>
          <p className="text-white/80 text-lg">
            Practical advice for therapy practices on patient communication,
            practice growth, and the future of AI in healthcare.
          </p>
        </div>
      </section>

      {/* Posts */}
      <section className="max-w-4xl mx-auto px-6 py-16">
        {posts.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 text-lg">Blog posts coming soon.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="group block bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-lg hover:border-gray-300 transition-all"
              >
                {post.image && (
                  <div className="aspect-[16/9] overflow-hidden bg-gray-100">
                    <img
                      src={post.image}
                      alt={post.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                )}
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <time className="text-xs text-gray-400">
                      {new Date(post.date).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </time>
                    <span className="text-xs text-gray-300">&middot;</span>
                    <span className="text-xs text-gray-400">{post.readingTime} min read</span>
                  </div>
                  <h2
                    className="text-xl font-semibold mb-2 group-hover:text-[#3e85af] transition-colors"
                    style={{ color: '#1f375d' }}
                  >
                    {post.title}
                  </h2>
                  <p className="text-gray-500 text-sm line-clamp-3">{post.description}</p>
                  {post.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4">
                      {post.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* CTA */}
      <section
        className="px-6 py-16 text-white text-center"
        style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 100%)' }}
      >
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold mb-4">Ready to stop missing calls?</h2>
          <p className="text-white/70 mb-8">
            Join therapy practices that never miss a new patient again.
          </p>
          <Link
            href="/signup"
            className="inline-block bg-white font-bold px-8 py-4 rounded-xl text-lg hover:shadow-xl hover:scale-[1.02] transition-all"
            style={{ color: '#1f375d' }}
          >
            Get Started &rarr;
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-6 py-10 bg-white">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-400">&copy; 2026 Harbor AI. All rights reserved.</p>
          <div className="flex gap-4 text-xs text-gray-500">
            <Link href="/privacy-policy" className="hover:text-gray-900">Privacy Policy</Link>
            <Link href="/sms" className="hover:text-gray-900">SMS Terms</Link>
            <Link href="/terms" className="hover:text-gray-900">Terms of Service</Link>
            <Link href="/hipaa" className="hover:text-gray-900">HIPAA</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
