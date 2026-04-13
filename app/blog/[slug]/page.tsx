import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAllPosts, getPostBySlug } from '@/lib/blog'

interface Props {
  params: { slug: string }
}

export async function generateStaticParams() {
  const posts = getAllPosts()
  return posts.map((post) => ({ slug: post.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = getPostBySlug(params.slug)
  if (!post) return { title: 'Post Not Found' }

  return {
    title: `${post.title} | Harbor Receptionist Blog`,
    description: post.description,
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      publishedTime: post.date,
      authors: [post.author],
      url: `https://harborreceptionist.com/blog/${post.slug}`,
      siteName: 'Harbor Receptionist',
      ...(post.image && { images: [{ url: post.image }] }),
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
      ...(post.image && { images: [post.image] }),
    },
  }
}

export default function BlogPostPage({ params }: Props) {
  const post = getPostBySlug(params.slug)
  if (!post) notFound()

  const allPosts = getAllPosts()
  const currentIndex = allPosts.findIndex((p) => p.slug === post.slug)
  const relatedPosts = allPosts.filter((_, i) => i !== currentIndex).slice(0, 2)

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <Link href="/" className="hover:opacity-80 transition-opacity">
          <img src="/harbor-logo.svg" alt="Harbor" className="h-14 w-auto" />
        </Link>
        <div className="flex items-center gap-6">
          <Link href="/blog" className="text-sm text-gray-500 hover:text-gray-900 hidden sm:block">Blog</Link>
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

      {/* Article */}
      <article className="max-w-3xl mx-auto px-6 py-16">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-8">
          <Link href="/blog" className="hover:text-gray-600">Blog</Link>
          <span>&rsaquo;</span>
          <span className="text-gray-600 truncate">{post.title}</span>
        </div>

        {/* Header */}
        <header className="mb-10">
          {post.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs font-medium px-3 py-1 rounded-full"
                  style={{ backgroundColor: '#f0fafa', color: '#3e85af' }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          <h1 className="text-3xl lg:text-4xl font-bold mb-4" style={{ color: '#1f375d' }}>
            {post.title}
          </h1>
          <p className="text-lg text-gray-500 mb-6">{post.description}</p>
          <div className="flex items-center gap-4 text-sm text-gray-400 pb-8 border-b border-gray-100">
            <span>{post.author}</span>
            <span>&middot;</span>
            <time>
              {new Date(post.date).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </time>
            <span>&middot;</span>
            <span>{post.readingTime} min read</span>
          </div>
        </header>

        {/* Featured image */}
        {post.image && (
          <div className="mb-10 rounded-2xl overflow-hidden">
            <img src={post.image} alt={post.title} className="w-full" />
          </div>
        )}

        {/* Content */}
        <div
          className="prose prose-lg prose-gray max-w-none
            prose-headings:text-[#1f375d] prose-headings:font-semibold
            prose-a:text-[#3e85af] prose-a:no-underline hover:prose-a:underline
            prose-strong:text-gray-800
            prose-blockquote:border-l-[#52bfc0] prose-blockquote:text-gray-600
            prose-li:marker:text-[#52bfc0]"
          dangerouslySetInnerHTML={{ __html: post.content }}
        />

        {/* Author card */}
        <div className="mt-12 p-6 rounded-2xl bg-gray-50 border border-gray-100">
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg"
              style={{ backgroundColor: '#52bfc0' }}
            >
              {post.author.charAt(0)}
            </div>
            <div>
              <p className="font-semibold" style={{ color: '#1f375d' }}>{post.author}</p>
              <p className="text-sm text-gray-500">Harbor Receptionist</p>
            </div>
          </div>
        </div>
      </article>

      {/* Related posts */}
      {relatedPosts.length > 0 && (
        <section className="max-w-3xl mx-auto px-6 pb-16">
          <h2 className="text-xl font-semibold mb-6" style={{ color: '#1f375d' }}>
            More from the blog
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {relatedPosts.map((related) => (
              <Link
                key={related.slug}
                href={`/blog/${related.slug}`}
                className="group block p-5 rounded-xl border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all"
              >
                <time className="text-xs text-gray-400">
                  {new Date(related.date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </time>
                <h3
                  className="font-semibold mt-1 mb-1 group-hover:text-[#3e85af] transition-colors"
                  style={{ color: '#1f375d' }}
                >
                  {related.title}
                </h3>
                <p className="text-sm text-gray-500 line-clamp-2">{related.description}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

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
