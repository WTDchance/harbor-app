import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Security & HIPAA — Harbor',
  description:
    'How Harbor protects PHI: HIPAA-aligned AWS infrastructure, KMS encryption, signed BAAs, audit logging, and the controls therapy practices need to be compliant.',
}

export default function SecurityPage() {
  return (
    <>
      <section className="text-white px-6 py-24" style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 100%)' }}>
        <div className="max-w-4xl mx-auto">
          <p className="text-sm font-semibold uppercase tracking-wider mb-4 text-white/70">Security &amp; HIPAA</p>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] mb-6">
            Built for the data therapy practices actually handle.
          </h1>
          <p className="text-lg md:text-xl text-white/85 max-w-3xl leading-relaxed">
            Harbor was engineered from day one for the realities of Protected Health Information.
            Every layer — infrastructure, application, operations — is designed to satisfy the
            HIPAA Security Rule and the expectations of clinicians, patients, and reviewers.
          </p>
        </div>
      </section>

      {/* Pillars */}
      <section className="px-6 py-20 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                title: 'HIPAA-aligned AWS stack',
                desc: 'Harbor runs on AWS using only services covered by our AWS Business Associate Addendum (RDS, S3, ECS, KMS, Cognito, SES, Textract, Transcribe, Bedrock, Chime SDK). No PHI ever flows through services we don&rsquo;t have a BAA for.',
              },
              {
                title: 'Encryption everywhere',
                desc: 'All PHI is encrypted at rest with AWS KMS-managed keys (AES-256) and in transit with TLS 1.2+. Database backups are encrypted with the same keys. RDS lives in a private subnet with no public IP.',
              },
              {
                title: 'Strong authentication',
                desc: 'Cognito-managed identity with MFA available for every clinician account. Session timeout, audit logging on every PHI access, and tight role-based scoping at the data layer.',
              },
            ].map(({ title, desc }) => (
              <div key={title} className="rounded-2xl p-6 border border-gray-200 bg-white">
                <h3 className="font-semibold mb-3 text-lg" style={{ color: '#1f375d' }}>{title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed" dangerouslySetInnerHTML={{ __html: desc }} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HIPAA Security Rule mapping */}
      <section className="px-6 py-20 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3" style={{ color: '#1f375d' }}>
            Mapped to the HIPAA Security Rule.
          </h2>
          <p className="text-gray-500 text-lg mb-12 max-w-2xl">
            Every required and addressable safeguard under 45 CFR §164.308–§164.312, with the
            specific control we use to satisfy it.
          </p>

          <div className="space-y-3">
            {[
              {
                section: '§164.308(a)(1) — Risk analysis',
                control: 'Annual HIPAA risk assessment, documented in our compliance binder, refreshed on every major architecture change.',
              },
              {
                section: '§164.308(a)(3) — Workforce security',
                control: 'Cognito identity, role-based access, principle of least privilege. Background checks for staff with PHI access.',
              },
              {
                section: '§164.308(a)(5) — Security awareness training',
                control: 'Annual HIPAA training for all team members with PHI access, completion tracked.',
              },
              {
                section: '§164.308(a)(7) — Contingency planning',
                control: 'Encrypted automated daily RDS backups, 30-day retention, documented disaster-recovery runbook with periodic restoration tests.',
              },
              {
                section: '§164.310 — Physical safeguards',
                control: 'No on-prem PHI. AWS data centers handle all physical controls under our BAA.',
              },
              {
                section: '§164.312(a) — Access control',
                control: 'Unique account per user, automatic session timeout, MFA available on every account, audit logging on all PHI reads/writes.',
              },
              {
                section: '§164.312(b) — Audit controls',
                control: 'Append-only audit log table records every PHI access with actor, timestamp, request ID. Exportable for review.',
              },
              {
                section: '§164.312(c) — Integrity',
                control: 'KMS-managed encryption with integrity protection, append-only audit logs, immutable session note signing.',
              },
              {
                section: '§164.312(e) — Transmission security',
                control: 'TLS 1.2+ everywhere, HSTS preload, strict CSP, no PHI in URLs, signed webhook verification on every external integration.',
              },
              {
                section: '§164.314 — Business Associate Agreement',
                control: 'Signed BAA with every customer practice. Signed BAAs upstream with AWS, SignalWire, Resend, Anthropic, and every other vendor that touches PHI.',
              },
            ].map(({ section, control }) => (
              <div key={section} className="bg-white rounded-xl p-5 border border-gray-200">
                <div className="font-semibold text-sm mb-1" style={{ color: '#1f375d' }}>{section}</div>
                <p className="text-sm text-gray-600">{control}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BAA */}
      <section className="px-6 py-20 bg-white">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold tracking-tight mb-5" style={{ color: '#1f375d' }}>
            We sign a BAA on day one.
          </h2>
          <p className="text-gray-600 leading-relaxed mb-4">
            Every Harbor customer signs a Business Associate Agreement before their first patient
            call. The BAA spells out our obligations as a business associate under HIPAA — how we
            handle PHI, what we&rsquo;ll do in the unlikely event of a breach, and your rights to
            audit and terminate.
          </p>
          <p className="text-gray-600 leading-relaxed mb-4">
            We also maintain signed BAAs with every upstream vendor that touches PHI on our
            behalf, so the chain of accountability is unbroken from the moment a patient&rsquo;s
            data leaves their phone to the moment it reaches your dashboard.
          </p>
          <p className="text-gray-600 leading-relaxed">
            Want a copy of our standard BAA template? <Link href="/contact" className="font-semibold" style={{ color: '#1f375d' }}>Contact us</Link> and we&rsquo;ll send it over before your demo.
          </p>
        </div>
      </section>

      {/* Crisis */}
      <section className="px-6 py-20 bg-gray-50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold tracking-tight mb-5" style={{ color: '#1f375d' }}>
            Patient safety, engineered.
          </h2>
          <p className="text-gray-600 leading-relaxed mb-4">
            Harbor includes a real-time, 3-tier crisis detection system on every call and every
            inbound message. Tier 1 catches unambiguous warning phrases and immediately escalates
            with a 988 referral and an SMS to the on-call therapist. Tier 2 routes ambiguous
            language through a Claude Sonnet model for contextual analysis. Tier 3 monitors
            behavioral signals like sequential cancellations.
          </p>
          <p className="text-gray-600 leading-relaxed">
            The system fails safe: if any model call fails, we default to escalation. Patient
            safety is not best-effort.
          </p>
        </div>
      </section>

      <section className="px-6 py-20 text-white text-center" style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 100%)' }}>
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-4">Want our security one-pager?</h2>
          <p className="text-white/80 mb-8 text-lg">For your IT review or your therapy board. Just ask.</p>
          <Link href="/contact" className="inline-block bg-white font-bold px-8 py-4 rounded-xl text-lg hover:shadow-xl transition-all" style={{ color: '#1f375d' }}>
            Contact Us
          </Link>
        </div>
      </section>
    </>
  )
}
