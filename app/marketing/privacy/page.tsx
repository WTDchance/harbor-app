import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy — Harbor',
  description: 'How Harbor collects, uses, and protects information about practices, clinicians, and patients.',
}

export default function PrivacyPage() {
  return (
    <>
      <section className="text-white px-6 py-16" style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 100%)' }}>
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-3">Privacy Policy</h1>
          <p className="text-white/70 text-sm">Effective date: April 29, 2026</p>
        </div>
      </section>

      <article className="px-6 py-16 bg-white">
        <div className="max-w-3xl mx-auto prose prose-sm md:prose-base prose-slate max-w-none">
          <p>
            Harbor (&ldquo;<strong>Harbor</strong>,&rdquo; &ldquo;<strong>we</strong>,&rdquo; &ldquo;<strong>us</strong>,&rdquo; or &ldquo;<strong>our</strong>&rdquo;) is a Delaware C corporation
            that provides electronic health record (EHR) software and an AI-powered receptionist
            service to behavioral health practices. This Privacy Policy describes how we collect,
            use, disclose, and protect information when you visit{' '}
            <a href="https://harboroffice.ai">harboroffice.ai</a> (the &ldquo;Site&rdquo;) or use any
            Harbor product or service (collectively, the &ldquo;Services&rdquo;).
          </p>

          <p>
            Harbor acts as a <strong>business associate</strong>, as that term is defined under the
            Health Insurance Portability and Accountability Act of 1996, as amended by the HITECH
            Act and its implementing regulations (collectively, &ldquo;HIPAA&rdquo;), to therapy
            practices that use the Services. Our handling of Protected Health Information
            (&ldquo;PHI&rdquo;) is governed primarily by our Business Associate Agreement
            (&ldquo;BAA&rdquo;) with each customer practice; this Privacy Policy supplements, but
            does not override, the terms of that BAA.
          </p>

          <h2>1. Information we collect</h2>

          <h3>1.1 Information you provide directly</h3>
          <ul>
            <li><strong>Account information.</strong> Practice name, clinician names, email addresses, phone numbers, license information, billing addresses.</li>
            <li><strong>Payment information.</strong> Processed by our payment processor (Stripe). We do not store full card numbers on Harbor systems.</li>
            <li><strong>Configuration data.</strong> Practice hours, specialties, intake questions, referral sources, custom prompts, and similar operational settings.</li>
            <li><strong>Patient data submitted to the Services.</strong> When you upload, transmit, or instruct the Services to receive patient information, we process it as a business associate under your BAA.</li>
          </ul>

          <h3>1.2 Information collected from patient interactions</h3>
          <p>
            When the Services answer a call, take a message, complete intake, or otherwise interact
            with your patients on your behalf, we may collect:
          </p>
          <ul>
            <li>Caller phone numbers and call audio</li>
            <li>Transcripts of voice and text conversations</li>
            <li>Demographic information, presenting concerns, insurance details</li>
            <li>Validated screening responses (e.g., PHQ-2, GAD-2, PHQ-9, GAD-7)</li>
            <li>Appointment requests and intake form submissions</li>
          </ul>
          <p>
            All such patient information is treated as PHI and handled exclusively under the BAA
            with the relevant practice.
          </p>

          <h3>1.3 Information collected automatically</h3>
          <ul>
            <li><strong>Usage data.</strong> Pages viewed, features used, timestamps, request paths.</li>
            <li><strong>Device and connection data.</strong> IP address, browser type, operating system, referring URL.</li>
            <li><strong>Cookies and similar technologies.</strong> Used for authentication, session management, and analytics. See Section 7.</li>
          </ul>

          <h2>2. How we use information</h2>
          <p>We use information to:</p>
          <ul>
            <li>Provide, operate, maintain, and improve the Services.</li>
            <li>Authenticate users, secure accounts, and prevent fraud or abuse.</li>
            <li>Communicate with you about your account, billing, and service updates.</li>
            <li>Detect, investigate, and respond to security incidents and crisis events.</li>
            <li>Comply with legal obligations and enforce our agreements.</li>
            <li>Develop, train, and improve our AI features &mdash; <strong>only on data we are contractually permitted to use, with all PHI de-identified or otherwise handled in accordance with our BAA.</strong> We do not sell PHI, and we do not use PHI to train models for the benefit of third parties.</li>
          </ul>

          <h2>3. How we share information</h2>
          <p>
            We do not sell personal information or PHI. We share information only as follows:
          </p>
          <ul>
            <li><strong>With your practice.</strong> Patient information is shared back with the customer practice for whom we are providing services.</li>
            <li><strong>With service providers (subprocessors).</strong> We use vendors who help us deliver the Services (cloud infrastructure, voice carriers, transcription, AI inference, email delivery, payment processing). Each subprocessor that handles PHI is covered by a signed BAA. A current list of subprocessors is available on request.</li>
            <li><strong>For legal reasons.</strong> When required by law, court order, or governmental request, or to protect the rights, property, or safety of Harbor, our customers, or the public.</li>
            <li><strong>In a business transaction.</strong> If Harbor is involved in a merger, acquisition, financing, or sale of assets, information may be transferred subject to confidentiality protections and applicable HIPAA requirements.</li>
          </ul>

          <h2>4. Data security</h2>
          <p>
            Harbor implements administrative, technical, and physical safeguards designed to
            satisfy the HIPAA Security Rule, including:
          </p>
          <ul>
            <li>AES-256 encryption at rest (AWS KMS-managed keys) and TLS 1.2+ in transit.</li>
            <li>Network isolation: databases run in private subnets with no public network exposure.</li>
            <li>Role-based access control, MFA available on every account, and automatic session timeout.</li>
            <li>Append-only audit logging on every PHI access.</li>
            <li>Daily encrypted backups with periodic restoration testing.</li>
            <li>Annual workforce HIPAA training and risk assessments.</li>
          </ul>
          <p>
            No system is invulnerable. We will notify affected practices and individuals as
            required by HIPAA, applicable state law, and our BAA in the event of a security
            incident affecting PHI.
          </p>

          <h2>5. Data retention</h2>
          <p>
            We retain account and configuration data for as long as the account is active and as
            needed to provide the Services. PHI is retained in accordance with the BAA with the
            relevant practice. On termination, we will return or destroy PHI as directed by the
            practice and as permitted by applicable law.
          </p>

          <h2>6. Your rights</h2>
          <p>
            Depending on your jurisdiction (e.g., California, Virginia, Colorado), you may have
            rights to access, correct, delete, or port personal information we hold about you, and
            to opt out of certain processing. To exercise these rights, email{' '}
            <a href="mailto:chancewonser@gmail.com">chancewonser@gmail.com</a>.
          </p>
          <p>
            For PHI, your rights are governed by HIPAA and your relationship with your healthcare
            provider; please contact your therapy practice directly for those requests.
          </p>

          <h2>7. Cookies and analytics</h2>
          <p>
            We use cookies and similar technologies for essential functions (authentication,
            session management) and for analytics (Google Tag Manager, Microsoft Clarity, PostHog).
            Analytics tools are configured to avoid the collection of PHI from authenticated
            clinical pages. You can control cookies through your browser settings.
          </p>

          <h2>8. Children</h2>
          <p>
            The Services are not directed to children under 13. Patient data about minors handled
            in the course of providing the Services is governed by the BAA with the practice and
            applicable law (including 42 CFR Part 2 where relevant). Harbor does not knowingly
            collect personal information directly from children under 13.
          </p>

          <h2>9. International transfers</h2>
          <p>
            Harbor processes information in the United States. By using the Services from outside
            the United States, you consent to the transfer of information to the United States.
          </p>

          <h2>10. Changes to this Privacy Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. Material changes will be posted
            here with an updated effective date and, where appropriate, notice to account
            administrators.
          </p>

          <h2>11. Contact</h2>
          <p>
            Questions about this Privacy Policy or our data practices? Email{' '}
            <a href="mailto:chancewonser@gmail.com">chancewonser@gmail.com</a> or write to:
          </p>
          <p>
            Harbor<br />
            Attn: Privacy<br />
            Klamath Falls, OR
          </p>
        </div>
      </article>
    </>
  )
}
