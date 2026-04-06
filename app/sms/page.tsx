// app/sms/page.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SMS Messaging Program | Harbor Receptionist",
  description:
    "Harbor Receptionist SMS appointment confirmation, reminder, and intake program details, opt-in, opt-out, and message frequency.",
};

export default function SmsProgramPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-gray-800">
      <h1 className="text-3xl font-bold mb-2 text-[#021E26]">SMS Messaging Program</h1>
      <p className="text-sm text-gray-500 mb-10">Last updated: April 2026</p>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">1. Program description</h2>
        <p className="mb-4">
          Harbor Receptionist is an AI receptionist platform used by independent
          therapy practices in the United States. As part of the platform, we
          send transactional SMS text messages to patients of these therapy
          practices. Messages include appointment confirmations, appointment
          reminders, intake form delivery links, waitlist offers, and basic
          scheduling correspondence.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">2. How patients opt in</h2>
        <p className="mb-3">
          Patients opt in to receive SMS messages by providing their mobile
          phone number to a participating therapy practice through one of the
          following channels:
        </p>
        <ul className="list-disc pl-6 mb-4">
          <li className="mb-2">
            <strong>Phone call:</strong> When a patient calls a Harbor practice
            and schedules an appointment with the practice&apos;s AI receptionist,
            the receptionist verbally collects the patient&apos;s mobile number and
            states: &ldquo;Is it okay if we send appointment confirmations and
            reminders to this number? Reply STOP at any time to opt out.&rdquo;
          </li>
          <li className="mb-2">
            <strong>Intake form:</strong> When a patient completes a Harbor
            intake form, the form contains an explicit checkbox: &ldquo;I agree
            to receive appointment-related SMS messages from this practice.
            Message and data rates may apply. Message frequency varies. Reply
            STOP to opt out, HELP for help.&rdquo;
          </li>
          <li>
            <strong>In person at the practice:</strong> When a patient gives
            the practice their phone number and signs the practice&apos;s standard
            intake paperwork, which includes the SMS consent language above.
          </li>
        </ul>
        <p>
          Consent is collected and stored by the participating therapy practice
          on Harbor&apos;s behalf. Harbor only sends SMS messages to phone numbers
          that have been opted in through one of these channels.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">3. Message types and samples</h2>
        <p className="mb-3">Examples of messages we send:</p>
        <ul className="list-disc pl-6 mb-2">
          <li className="mb-2">
            <em>Confirmation:</em> &ldquo;Hi Alex, your appointment with Dr.
            Smith is confirmed for Tue Apr 14 at 2:00pm. Reply STOP to opt out.&rdquo;
          </li>
          <li className="mb-2">
            <em>Reminder:</em> &ldquo;Reminder: appointment with Dr. Smith
            tomorrow at 2:00pm. Reply CONFIRM to confirm or CANCEL to cancel.
            Reply STOP to opt out.&rdquo;
          </li>
          <li className="mb-2">
            <em>Intake delivery:</em> &ldquo;Hi Alex, please complete your
            intake forms before your appointment: https://harborreceptionist.com/intake/abc123
            . Reply STOP to opt out.&rdquo;
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">4. Message frequency</h2>
        <p>
          Message frequency varies by practice and patient activity. Most
          patients receive between 1 and 6 messages per appointment cycle
          (confirmation, reminder, intake link, follow-up). Patients on a
          waitlist may receive additional offer messages.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">5. Cost</h2>
        <p>Standard message and data rates may apply.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">6. How to opt out</h2>
        <p className="mb-3">
          Reply <strong>STOP</strong> to any message to immediately opt out of
          all SMS messages from that practice. You will receive a final
          confirmation message and no further messages will be sent unless you
          opt back in.
        </p>
        <p>
          Reply <strong>HELP</strong> at any time to receive help. You may also
          email support@harborreceptionist.com for assistance.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">7. Privacy and data sharing</h2>
        <p className="mb-3">
          No mobile information will be shared with third parties or affiliates
          for marketing or promotional purposes. Information sharing to
          subcontractors that support customer service or security is permitted.
          All other categories exclude text messaging originator opt-in data and
          consent; this information will not be shared with any third parties.
        </p>
        <p>
          See our <a className="text-[#0d9488] underline" href="/privacy-policy">Privacy Policy</a>
          {' '}and <a className="text-[#0d9488] underline" href="/terms">Terms of Service</a>
          {' '}for full details.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">8. Contact</h2>
        <p>
          Harbor Receptionist
          <br />
          Email: support@harborreceptionist.com
          <br />
          Website: harborreceptionist.com
        </p>
      </section>
    </main>
  );
}
