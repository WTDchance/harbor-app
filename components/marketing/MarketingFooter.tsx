import Link from 'next/link'

export function MarketingFooter() {
  return (
    <footer className="border-t border-gray-100 bg-white">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-10">
          <div className="col-span-2">
            <Link href="/" className="inline-block hover:opacity-80 transition-opacity">
              <img src="/harbor-logo.svg" alt="Harbor" className="h-10 w-auto" />
            </Link>
            <p className="text-sm text-gray-500 mt-3 max-w-xs">
              AI receptionist for therapy practices. Plugs into any EHR..
            </p>
            <p className="text-xs text-gray-400 mt-4">
              <a href="mailto:chancewonser@gmail.com" className="hover:text-gray-700">
                chancewonser@gmail.com
              </a>
            </p>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-900 mb-3">Product</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/ehr" className="text-gray-500 hover:text-gray-900">Harbor EHR</Link></li>
              <li><Link href="/reception" className="text-gray-500 hover:text-gray-900">Harbor Reception</Link></li>
              <li><Link href="/pricing" className="text-gray-500 hover:text-gray-900">Pricing</Link></li>
              <li><Link href="/contact" className="text-gray-500 hover:text-gray-900">Book a Demo</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-900 mb-3">Company</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/about" className="text-gray-500 hover:text-gray-900">About</Link></li>
              <li><Link href="/security" className="text-gray-500 hover:text-gray-900">Security &amp; HIPAA</Link></li>
              <li><Link href="/contact" className="text-gray-500 hover:text-gray-900">Contact</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-900 mb-3">Legal</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/privacy" className="text-gray-500 hover:text-gray-900">Privacy Policy</Link></li>
              <li><Link href="/terms" className="text-gray-500 hover:text-gray-900">Terms of Service</Link></li>
              <li><Link href="/security" className="text-gray-500 hover:text-gray-900">HIPAA</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
          <p className="text-xs text-gray-400">
            &copy; 2026 Harbor. All rights reserved. Harbor is a Delaware C corporation.
          </p>
          <p className="text-xs text-gray-400">
            HIPAA-aligned infrastructure on AWS. BAA available on request.
          </p>
        </div>
      </div>
    </footer>
  )
}
