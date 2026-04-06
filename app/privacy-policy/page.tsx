// app/privacy-policy/page.tsx
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Privacy Policy | Harbor Receptionist",
  description: "Harbor Receptionist privacy policy â how we collect, use, and protect your information.",
};
export default function PrivacyPolicyPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-gray-800">
      <h1 className="text-3xl font-bold mb-2 text-[#021E26]">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-10">Last updated: March 2026</p>
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
            <p className="mb-3"><strong>Opt-in.</strong> You opt in to receive SMS messages by providing your mobile phone number to a participating therapy practice when you schedule an appointment, complete an intake form, or speak with the practice\u2019s AI receptionist. By doing so you consent to receive recurring transactional SMS messages from that practice via Harbor Receptionist.</p>
            <p className="mb-3"><strong>Message frequency.</strong> Message frequency varies based on your appointment schedule, typically 1\u20136 messages per appointment cycle.</p>
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
        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">6. Contact Us</h2>
        <address className="not-italic">
          <strong>Harbor Receptionist</strong><br />
          Email: <a href="mailto:support@harborreceptionist.com" className="text-[#028090] underline">support@harborreceptionist.com</a><br />
          Website: <a href="https://harborreceptionist.com" className="text-[#028090] underline">harborreceptionist.com</a>
        </address>
      </section>
    </main>
  );
}
