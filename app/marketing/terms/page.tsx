import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service — Harbor',
  description: 'The terms of service for Harbor EHR and Harbor Reception.',
}

export default function TermsPage() {
  return (
    <>
      <section className="text-white px-6 py-16" style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 100%)' }}>
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-3">Terms of Service</h1>
          <p className="text-white/70 text-sm">Effective date: April 29, 2026</p>
        </div>
      </section>

      <article className="px-6 py-16 bg-white">
        <div className="max-w-3xl mx-auto prose prose-sm md:prose-base prose-slate max-w-none">
          <p>
            These Terms of Service (the &ldquo;<strong>Terms</strong>&rdquo;) govern your access to
            and use of the websites, software, and services (collectively, the &ldquo;<strong>Services</strong>&rdquo;)
            provided by Harbor, a Delaware C corporation (&ldquo;<strong>Harbor</strong>,&rdquo;
            &ldquo;<strong>we</strong>,&rdquo; &ldquo;<strong>us</strong>,&rdquo; or
            &ldquo;<strong>our</strong>&rdquo;). By accessing or using the Services, you agree to
            these Terms. If you do not agree, do not use the Services.
          </p>

          <h2>1. Eligibility &amp; accounts</h2>
          <p>
            The Services are intended for licensed behavioral health professionals and their
            authorized staff. To use the Services, you must be at least 18 years old and able to
            form a binding contract. You are responsible for the accuracy of your account
            information, for safeguarding your credentials, and for all activity that occurs under
            your account.
          </p>

          <h2>2. Customer responsibilities</h2>
          <p>You agree that you will:</p>
          <ul>
            <li>Use the Services only as permitted by law and these Terms;</li>
            <li>Maintain all licenses required to provide healthcare services in your jurisdiction;</li>
            <li>Obtain all necessary patient consents and authorizations, including consents required by HIPAA, state law, and the Telephone Consumer Protection Act (TCPA) where applicable;</li>
            <li>Not use the Services for emergencies or to provide care in life-threatening situations &mdash; the Services are not a replacement for emergency services;</li>
            <li>Comply with all applicable carrier rules for SMS messaging (including 10DLC requirements) when using the messaging features.</li>
          </ul>

          <h2>3. Business Associate Agreement</h2>
          <p>
            If you are a HIPAA-covered entity, your use of the Services is conditioned on the
            execution of Harbor&rsquo;s Business Associate Agreement (&ldquo;<strong>BAA</strong>&rdquo;).
            The BAA governs the parties&rsquo; respective rights and responsibilities with respect
            to PHI and prevails over any conflicting provision in these Terms with respect to PHI.
          </p>

          <h2>4. Fees &amp; billing</h2>
          <p>
            Subscription fees are charged in advance on a monthly basis according to the plan you
            select. Fees are non-refundable except as expressly stated (see Section 5). You
            authorize Harbor and its payment processor to charge your designated payment method.
            Failure to pay may result in suspension or termination of the Services.
          </p>

          <h2>5. 30-day money-back guarantee</h2>
          <p>
            If you are dissatisfied with the Services for any reason, you may request a full
            refund of your first month&rsquo;s subscription fee within 30 days of your initial
            purchase by emailing{' '}
            <a href="mailto:chancewonser@gmail.com">chancewonser@gmail.com</a>. The guarantee
            applies once per practice and excludes pass-through telecom and third-party fees
            already incurred (e.g., Twilio per-minute charges, Stedi transaction fees).
          </p>

          <h2>6. Acceptable use</h2>
          <p>You will not, and will not permit any third party to:</p>
          <ul>
            <li>Reverse engineer, decompile, or attempt to extract source code from the Services;</li>
            <li>Use the Services to send unsolicited or unlawful communications, including spam;</li>
            <li>Upload viruses, malware, or other harmful code, or attempt to interfere with the integrity of the Services;</li>
            <li>Use the Services to harass, defraud, or harm others;</li>
            <li>Use the Services in violation of HIPAA, the TCPA, the CAN-SPAM Act, state telehealth laws, or any other applicable law.</li>
          </ul>

          <h2>7. Intellectual property</h2>
          <p>
            Harbor retains all right, title, and interest in and to the Services, including all
            software, content, and trademarks. You retain ownership of your data. You grant Harbor
            a limited license to use your data solely as necessary to provide and improve the
            Services and as permitted by the BAA.
          </p>

          <h2>8. Confidentiality</h2>
          <p>
            Each party agrees to protect the confidential information of the other using at least
            the same degree of care it uses for its own confidential information, and in any event
            no less than a reasonable standard of care.
          </p>

          <h2>9. Disclaimers</h2>
          <p>
            <strong>The Services are provided &ldquo;as is&rdquo; and &ldquo;as available.&rdquo;</strong>{' '}
            Harbor disclaims all warranties, whether express, implied, statutory, or otherwise,
            including warranties of merchantability, fitness for a particular purpose, title, and
            non-infringement. Harbor does not warrant that the Services will be uninterrupted,
            error-free, or free of harmful components.
          </p>
          <p>
            <strong>The Services do not provide medical advice and are not a substitute for the
            judgment of a licensed clinician.</strong> Crisis detection features are designed to
            assist clinicians but are not a guaranteed safety mechanism. You remain solely
            responsible for clinical decisions, including responses to crisis situations.
          </p>

          <h2>10. Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, Harbor will not be liable for indirect,
            incidental, consequential, special, exemplary, or punitive damages, or for lost
            profits, lost revenue, or lost data, even if advised of the possibility of such
            damages. Harbor&rsquo;s aggregate liability for all claims arising out of or relating
            to these Terms or the Services will not exceed the fees paid by you to Harbor in the
            twelve (12) months preceding the event giving rise to the claim.
          </p>

          <h2>11. Indemnification</h2>
          <p>
            You will indemnify, defend, and hold harmless Harbor and its officers, directors,
            employees, and agents from any third-party claim arising out of (a) your use of the
            Services in violation of these Terms or applicable law, (b) your provision of
            healthcare services, or (c) your data or content provided to the Services.
          </p>

          <h2>12. Termination</h2>
          <p>
            Either party may terminate the Services for convenience at the end of the then-current
            billing cycle by providing notice through the dashboard or by email. Harbor may suspend
            or terminate immediately for material breach, non-payment, or risk to the security or
            integrity of the Services. Upon termination, Harbor will return or destroy PHI in
            accordance with the BAA.
          </p>

          <h2>13. Governing law &amp; disputes</h2>
          <p>
            These Terms are governed by the laws of the State of Delaware, without regard to its
            conflict-of-laws principles. Any dispute will be resolved exclusively in the state or
            federal courts located in Delaware, and each party consents to personal jurisdiction
            and venue there.
          </p>

          <h2>14. Changes to these Terms</h2>
          <p>
            We may update these Terms from time to time. Material changes will be posted with an
            updated effective date and, where appropriate, notice to account administrators.
            Continued use of the Services after the effective date constitutes acceptance.
          </p>

          <h2>15. Miscellaneous</h2>
          <p>
            These Terms, together with the BAA and any order form, constitute the entire agreement
            between the parties regarding the Services. If any provision is held unenforceable, the
            remaining provisions remain in effect. Failure to enforce any provision is not a
            waiver. You may not assign these Terms without our prior written consent; we may
            assign freely in connection with a merger, acquisition, or sale of assets.
          </p>

          <h2>16. Contact</h2>
          <p>
            Questions about these Terms? Email{' '}
            <a href="mailto:chancewonser@gmail.com">chancewonser@gmail.com</a>.
          </p>
        </div>
      </article>
    </>
  )
}
