// app/terms/page.tsx
// Harbor — Terms and Conditions

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms & Conditions | Harbor Receptionist",
  description: "Harbor Receptionist terms and conditions of use.",
};

export default function TermsPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-gray-800">
      <h1 className="text-3xl font-bold mb-2 text-[#021E26]">Terms and Conditions</h1>
      <p className="text-sm text-gray-500 mb-10">Last updated: March 2026</p>

      <section className="mb-8">
        <p className="mb-4">
          These Terms and Conditions ("Terms") govern your use of Harbor
          Receptionist ("Harbor," "we," "us," or "our") services, including our
          AI receptionist platform, website, and SMS appointment reminder program
          accessible at{" "}
          <a href="https://harborreceptionist.com" className="text-[#028090] underline">
            harborreceptionist.com
          </a>
          . Harbor Receptionist is operated by <strong>Delta Traffic Labs LLC</strong>,
          an Oregon limited liability company and the legal entity registered as the
          A2P 10DLC brand for this SMS program.
        </p>
        <p>
          By using our services, you agree to be bound by these Terms. If you do
          not agree to these Terms, please do not use our services.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">1. SMS Messaging Program</h2>
        <p className="mb-3">
          <strong>Program Name:</strong> Harbor Receptionist SMS Appointment
          Reminders
        </p>
        <p className="mb-3">
          <strong>Description:</strong> Harbor sends SMS appointment confirmations
          and reminders to patients who have scheduled appointments with therapy
          practices using the Harbor platform. Messages may include booking
          confirmations, appointment reminders, and links to complete intake
          forms prior to your appointment.
        </p>
        <p className="mb-3">
          <strong>Message Frequency:</strong> Message frequency varies based on
          your scheduled appointments. You may receive messages for each
          appointment you schedule (confirmation, 24-hour reminder, and same-day
          reminder).
        </p>
        <p className="mb-3">
          <strong>Message and Data Rates:</strong> Message and data rates may
          apply. Check with your mobile carrier for applicable rates.
        </p>
        <p className="mb-3">
          <strong>Opt-Out:</strong> You may opt out of SMS messages at any time
          by replying <strong>STOP</strong> to any message. After opting out,
          you will receive one final confirmation message and no further messages
          will be sent.
        </p>
        <p className="mb-3">
          <strong>Help:</strong> Reply <strong>HELP</strong> to any message or
          contact us at{" "}
          <a href="mailto:support@harborreceptionist.com" className="text-[#028090] underline">
            support@harborreceptionist.com
          </a>{" "}
          for assistance.
        </p>
        <p>
          <strong>Supported Carriers:</strong> Major US carriers including AT&amp;T,
          T-Mobile, Verizon, and others. Carriers are not liable for delayed or
          undelivered messages.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">2. Use of Services</h2>
        <p className="mb-3">You agree to use Harbor services only for lawful purposes and in accordance with these Terms. You agree not to:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Use the services in any way that violates applicable laws or regulations</li>
          <li>Impersonate any person or entity or misrepresent your affiliation</li>
          <li>Interfere with or disrupt the integrity or performance of the services</li>
          <li>Attempt to gain unauthorized access to any portion of the services</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">3. For Therapy Practices</h2>
        <p className="mb-3">
          Therapy practices using Harbor as their AI receptionist agree to:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            Maintain a valid Business Associate Agreement (BAA) with Harbor
            where required by HIPAA
          </li>
          <li>
            Only provide patient contact information for patients who have
            consented to receive appointment-related communications
          </li>
          <li>
            Ensure their own practices comply with applicable healthcare privacy
            laws including HIPAA
          </li>
          <li>
            Notify Harbor promptly of any security incidents or unauthorized
            disclosures of patient information
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">4. Subscription and Billing</h2>
        <p className="mb-3">
          Harbor offers subscription plans for therapy practices. Subscriptions
          are billed monthly. The current pricing is as follows:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Founding Practice Plan:</strong> $397/month (available to
            the first 50 practices; price locked for life)
          </li>
          <li>
            <strong>Standard Plan:</strong> $597/month
          </li>
        </ul>
        <p className="mt-3">
          Harbor reserves the right to change pricing with 30 days' notice.
          Founding Practice pricing is grandfathered and exempt from standard
          price increases.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">5. Intellectual Property</h2>
        <p>
          The Harbor platform, including all software, content, logos, and
          trademarks, is owned by Harbor Receptionist and protected by
          intellectual property laws. You may not copy, modify, distribute, or
          create derivative works without our express written permission.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">6. Disclaimers</h2>
        <p className="mb-3">
          Harbor is an administrative and communication tool for scheduling and
          appointment management. Harbor is <strong>not a medical provider</strong>{" "}
          and does not provide medical advice, diagnosis, or treatment. The
          services are provided "as is" without warranties of any kind, express
          or implied.
        </p>
        <p>
          Harbor does not guarantee uninterrupted or error-free operation of
          the services. SMS delivery depends on mobile carrier availability and
          is not guaranteed.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">7. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, Harbor shall not be liable
          for any indirect, incidental, special, consequential, or punitive
          damages, including loss of data, revenue, or business opportunities,
          arising out of or related to your use of the services.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">8. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the State of Oregon, without
          regard to its conflict of law provisions. Any disputes shall be
          resolved in the courts located in Oregon.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">9. Changes to Terms</h2>
        <p>
          We reserve the right to modify these Terms at any time. Material
          changes will be communicated to active users. Continued use of the
          services after changes constitutes acceptance of the updated Terms.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">10. Contact</h2>
        <p>Questions about these Terms? Contact us:</p>
        <address className="mt-3 not-italic">
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
    </main>
  );
}
