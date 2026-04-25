// app/privacy-policy/page.tsx
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Privacy Policy | Harbor Receptionist",
  description: "Harbor Receptionist privacy policy - how we collect, use, and protect your information.",
};
export default function PrivacyPolicyPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-gray-800">
      <h1 className="text-3xl font-bold mb-2 text-[#021E26]">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-10">Last updated: April 2026</p>
      <section className="mb-8">
        <p className="mb-4">Harbor Receptionist protects the privacy and confidentiality of your personal and health information. This policy explains how we collect, use, and safeguard information when you use our AI receptionist platform and SMS appointment reminder system.</p>
        <p>By using our services, you agree to the collection and use of information in accordance with this policy.</p>
      </section>
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">1. Information We Collect</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li><strong>Contact Information:</strong> Name, phone number, and email address provided when scheduling.</li>
          <li><strong>Appointment Information:</strong> Date, time, and type of scheduled appointments.</li>
          <li><strong>Communication Data:</strong> Records of calls and SMS messages through our platform.</li>
        </ul>
      </section>
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">2. How We Use Your Information</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>Schedule and manage your appointments</li>
          <li>Send appointment confirmations and reminders via SMS (with your consent)</li>
          <li>Facilitate communication between patients and therapy practices</li>
          <li>Comply with legal obligations, including HIPAA requirements</li>
        </ul>
        <p className="mt-4 font-medium">We do not sell, rent, or share your personal information with third parties for marketing or advertising purposes.</p>
      </section>
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">3. SMS Messaging</h2>
        <p className="mb-3">Harbor Receptionist provides SMS appointment confirmations, reminders, intake form delivery links, and waitlist notifications to patients of independent therapy practices that subscribe to the Harbor platform.</p>
        <p className="mb-3"><strong>Opt-in.</strong> You opt in to receive SMS messages by providing your mobile phone number to a participating therapy practice when you schedule an appointment, complete an intake form, or speak with the practice&apos;s AI receptionist. By doing so you consent to receive recurring transactional SMS messages from that practice via Harbor Receptionist.</p>
        <p className="mb-3"><strong>Message frequency.</strong> Message frequency varies based on your appointment schedule, typically 1&ndash;6 messages per appointment cycle.</p>
        <p className="mb-3"><strong>Cost.</strong> Standard message and data rates may apply.</p>
        <p className="mb-3"><strong>Opt-out.</strong> You may opt out at any time by replying <strong>STOP</strong> to any message. Reply <strong>HELP</strong> for assistance, or contact support@harborreceptionist.com.</p>
        <p className="mb-3"><strong>Mobile information sharing.</strong> No mobile information will be shared with third parties or affiliates for marketing or promotional purposes. Information sharing to subcontractors that support customer service or security is permitted. All other categories exclude text messaging originator opt-in data and consent; this information will not be shared with any third parties.</p>
        <p>Your phone number is used solely for appointment-related communication between you and your therapy practice and is not sold, rented, or shared for advertising.</p>
      </section>
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">4. HIPAA Compliance</h2>
        <p>Harbor operates as a Business Associate under HIPAA and implements appropriate administrative, physical, and technical safeguards to protect Protected Health Information (PHI). We do not use or disclose PHI except as permitted by law.</p>
      </section>
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">5. Data Security</h2>
        <p>We use industry-standard security measures including encryption in transit and at rest and access controls to protect your information.</p>
      </section>
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">6. Google API Services &amp; Limited Use</h2>
        <p className="mb-3">Harbor Receptionist integrates with Google Calendar to schedule, reschedule, and cancel therapy appointments on behalf of the therapy practice that has authorized the connection. When a practice connects their Google account through Harbor, we request the following OAuth scopes:</p>
        <ul className="list-disc pl-6 space-y-2 mb-3">
          <li><strong>openid, email, profile:</strong> to identify the Google account that authorized the connection.</li>
          <li><strong>https://www.googleapis.com/auth/calendar.readonly:</strong> to read free/busy availability on the therapist&apos;s primary calendar so the AI receptionist can offer open appointment slots during a live phone call.</li>
          <li><strong>https://www.googleapis.com/auth/calendar.events:</strong> to create, update, and cancel appointment events on the therapist&apos;s primary calendar when a patient books, reschedules, or cancels.</li>
        </ul>
        <p className="mb-3"><strong>Limited Use.</strong> Harbor Receptionist&apos;s use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-[#028090] underline" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements. Specifically:</p>
        <ul className="list-disc pl-6 space-y-2 mb-3">
          <li>We use Google user data only to provide and improve user-facing features that are prominent in Harbor&apos;s interface (AI-powered appointment scheduling, rescheduling, and cancellation on behalf of the authorizing therapy practice).</li>
          <li>We do not transfer Google user data to third parties except as necessary to provide or improve these features, to comply with applicable law, or as part of a merger, acquisition, or sale of assets with notice to users.</li>
          <li>We do not use Google user data for serving advertisements, including retargeting, personalized, or interest-based advertising.</li>
          <li>We do not allow humans to read Google user data unless we have the authorizing user&apos;s affirmative agreement for specific messages, it is necessary for security purposes (such as investigating abuse), to comply with applicable law, or for internal operations where the data has been aggregated and anonymized.</li>
        </ul>
        <p>Harbor reads only free/busy times and event metadata on the primary calendar, and writes only appointment events that Harbor itself created. Calendar data is held in memory for the duration of a call or booking action and is not used to train machine learning models.</p>
      </section>
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">7. Contact Us</h2>
        <address className="not-italic">
          <strong>Harbor Receptionist</strong><br />
          Email: <a href="mailto:support@harborreceptionist.com" className="text-[#028090] underline">support@harborreceptionist.com</a><br />
          Website: <a href="https://harborreceptionist.com" className="text-[#028090] underline">harborreceptionist.com</a>
        </address>
      </section>
    </main>
  );
}
