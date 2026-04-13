// app/hipaa/page.tsx
// Harbor — HIPAA Compliance

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "HIPAA Compliance | Harbor Receptionist",
  description:
    "How Harbor Receptionist protects patient health information with HIPAA-compliant infrastructure, encryption, and Business Associate Agreements.",
};

export default function HIPAAPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-gray-800">
      <h1 className="text-3xl font-bold mb-2 text-[#021E26]">
        HIPAA Compliance
      </h1>
      <p className="text-sm text-gray-500 mb-10">Last updated: April 2026</p>

      <section className="mb-8">
        <p className="mb-4">
          Harbor Receptionist is purpose-built for therapy practices that handle
          Protected Health Information (PHI). We take our obligation to
          safeguard patient data seriously and have designed every layer of our
          platform with HIPAA requirements in mind.
        </p>
        <p>
          This page describes the administrative, technical, and physical
          safeguards we maintain so that you can confidently use Harbor as your
          AI receptionist.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">
          1. Business Associate Agreement (BAA)
        </h2>
        <p className="mb-4">
          Harbor operates as a Business Associate under HIPAA. Before any PHI
          is processed on your behalf, we execute a Business Associate Agreement
          that outlines our responsibilities for protecting patient information,
          breach notification procedures, and permitted uses and disclosures.
        </p>
        <p>
          A BAA is included as part of every Harbor practice subscription. To
          request a copy or discuss terms, contact us at{" "}
          <a
            href="mailto:support@harborreceptionist.com"
            className="text-[#028090] underline"
          >
            support@harborreceptionist.com
          </a>
          .
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">
          2. Data Encryption
        </h2>
        <p className="mb-4">
          All data transmitted between patients, practices, and the Harbor
          platform is encrypted in transit using TLS 1.2 or higher. Data stored
          in our database is encrypted at rest using AES-256 encryption provided
          by our infrastructure partners.
        </p>
        <p>
          Voice call audio, SMS messages, and intake form submissions are all
          transmitted over encrypted channels.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">
          3. Access Controls
        </h2>
        <p className="mb-4">
          Harbor enforces strict multi-tenancy isolation at the database level.
          Row Level Security (RLS) policies ensure that each practice can only
          access its own patient records. Administrative access to production
          systems is limited to authorized personnel and requires multi-factor
          authentication.
        </p>
        <p>
          Practice dashboard sessions are protected by Supabase Auth with
          secure, httpOnly cookies. All API routes that handle PHI require
          authenticated requests scoped to the requesting practice.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">
          4. Sub-Business Associates
        </h2>
        <p className="mb-4">
          Harbor uses a carefully selected set of infrastructure providers to
          deliver our service. Each provider that may come into contact with PHI
          maintains its own HIPAA compliance program and has executed a BAA with
          Harbor where required. Our current sub-business associates include:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Supabase</strong> &mdash; Database hosting and
            authentication (encrypted at rest, SOC 2 Type II)
          </li>
          <li>
            <strong>Twilio</strong> &mdash; Telephony and SMS messaging (HIPAA
            eligible, BAA available)
          </li>
          <li>
            <strong>Vapi</strong> &mdash; AI voice processing (BAA executed)
          </li>
          <li>
            <strong>Railway</strong> &mdash; Application hosting (SOC 2, BAA
            available)
          </li>
          <li>
            <strong>Anthropic (Claude)</strong> &mdash; AI language processing
            for crisis detection and SMS intelligence
          </li>
        </ul>
        <p className="mt-4">
          We do not use any sub-processors that lack a HIPAA compliance program
          or BAA when PHI is involved. We regularly review our vendor
          relationships and compliance posture.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">
          5. Incident Response
        </h2>
        <p className="mb-4">
          Harbor maintains a documented incident response plan for potential
          security events and data breaches. In the event of a breach involving
          PHI, we will notify affected practices within 24 hours of discovery,
          consistent with HIPAA Breach Notification Rule requirements (which
          require notification within 60 days).
        </p>
        <p>
          Our incident response plan includes identification, containment,
          eradication, recovery, and post-incident review phases. All incidents
          are documented and reviewed to prevent recurrence.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">
          6. Employee Training &amp; Policies
        </h2>
        <p>
          All Harbor team members with access to production systems complete
          HIPAA training and acknowledge our security and privacy policies.
          Access to PHI is granted on a minimum-necessary basis and reviewed
          regularly. Harbor maintains written policies covering data handling,
          acceptable use, and workforce sanctions for policy violations.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">
          7. Risk Assessments
        </h2>
        <p>
          Harbor conducts periodic security risk assessments to identify
          potential vulnerabilities and threats to PHI. These assessments
          evaluate our administrative, physical, and technical safeguards and
          inform our ongoing security improvement roadmap. Findings are
          documented and remediation is tracked to completion.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">
          8. Data Retention &amp; Disposal
        </h2>
        <p>
          Harbor retains PHI only as long as necessary to provide our services
          and meet legal obligations. When a practice terminates its
          subscription, we will securely delete or return all PHI within 30 days
          of the termination date, unless retention is required by law. Data
          disposal follows NIST 800-88 guidelines for media sanitization.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">
          9. Your Responsibilities
        </h2>
        <p className="mb-4">
          As a Covered Entity, your practice is responsible for ensuring that
          patients have consented to the use of Harbor&apos;s services for
          scheduling and communication, maintaining your own HIPAA compliance
          program, and promptly notifying Harbor of any suspected security
          incidents.
        </p>
        <p>
          We recommend that all practices execute a BAA with Harbor before
          transmitting PHI through our platform. If you have not yet signed a
          BAA, please contact us.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">
          10. Contact Us
        </h2>
        <p className="mb-4">
          For questions about our HIPAA compliance program, to request a BAA, or
          to report a security concern:
        </p>
        <address className="not-italic">
          <strong>Harbor Receptionist</strong>
          <br />
          Email:{" "}
          <a
            href="mailto:support@harborreceptionist.com"
            className="text-[#028090] underline"
          >
            support@harborreceptionist.com
          </a>
          <br />
          Website:{" "}
          <a
            href="https://harborreceptionist.com"
            className="text-[#028090] underline"
          >
            harborreceptionist.com
          </a>
        </address>
      </section>

      <section className="mt-12 pt-8 border-t border-gray-200">
        <p className="text-sm text-gray-500">
          See also:{" "}
          <Link href="/privacy-policy" className="text-[#028090] underline">
            Privacy Policy
          </Link>{" "}
          &middot;{" "}
          <Link href="/terms" className="text-[#028090] underline">
            Terms of Service
          </Link>
        </p>
      </section>
    </main>
  );
}
