'use client'

import Link from 'next/link'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-gradient-to-br from-teal-50 to-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-12">
          <Link href="/" className="text-teal-600 hover:text-teal-700 text-sm font-medium mb-4 inline-block">
            ← Back to Harbor
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
          <p className="text-gray-600">Effective date: March 2026</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="prose prose-sm max-w-none space-y-6 text-gray-700">
          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">1. Service Description</h2>
            <p>
              Harbor is an AI receptionist platform designed specifically for therapy practices. The service allows therapists to receive AI-powered call answering, intake screening, crisis detection, and automated patient communications.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">2. Acceptable Use</h2>
            <p>
              By using Harbor, you agree to use the service only for operating a licensed therapy practice. You agree to:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Comply with all applicable laws and regulations, including HIPAA</li>
              <li>Not use Harbor for any purpose other than legitimate therapy practice operations</li>
              <li>Not attempt to reverse-engineer, hack, or compromise the service</li>
              <li>Not share your account credentials with unauthorized individuals</li>
              <li>Ensure patients are informed that calls may be answered by AI</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">3. Subscription and Billing</h2>
            <p>
              Harbor Pro costs <strong>$499 per month</strong> with a <strong>14-day free trial</strong>. Key terms:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Subscriptions are billed monthly on the same date you signed up</li>
              <li>You may cancel your subscription anytime; no refunds are issued for partial months</li>
              <li>Your subscription will automatically renew each month unless cancelled</li>
              <li>You can manage your subscription and payment method in the Billing Portal</li>
              <li>If payment fails, we will retry up to 3 times over 2 weeks. After that, your account may be suspended</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">4. Trial Period</h2>
            <p>
              Your free trial lasts for 14 days from the date you sign up. After the trial ends, your subscription will automatically convert to a paid monthly subscription unless you cancel beforehand. You will be charged on the first billing date following your trial.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">5. Cancellation</h2>
            <p>
              You can cancel your subscription at any time through the Billing Portal. Cancellations are effective at the end of your current billing period. No refunds are issued for partial months.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">6. HIPAA Responsibility</h2>
            <p>
              Harbor is designed to be HIPAA-compliant, but compliance is a shared responsibility:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li><strong>Harbor's Responsibility:</strong> We provide security controls, encryption, access logging, and data retention policies</li>
              <li><strong>Your Responsibility:</strong> You must obtain a Business Associate Agreement (BAA), train staff on HIPAA, obtain patient consent, and follow HIPAA security rules</li>
              <li>Harbor cannot be held liable for your violation of HIPAA or misuse of the service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">7. Disclaimer of Warranties</h2>
            <p>
              Harbor is provided "AS IS" without warranties of any kind, either express or implied. We do not guarantee:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Uninterrupted or error-free service</li>
              <li>100% accuracy of AI-generated summaries or crisis detection</li>
              <li>That the service will meet your specific needs</li>
            </ul>
            <p className="mt-3">
              Harbor is a tool to assist your practice, not replace your clinical judgment. Always review AI-generated content for accuracy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">8. Limitation of Liability</h2>
            <p>
              To the extent permitted by law, Harbor is not liable for:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Indirect, incidental, or consequential damages</li>
              <li>Loss of revenue, data, or profits</li>
              <li>Clinical decisions made based on Harbor output</li>
              <li>Patient harm or negative outcomes related to AI responses</li>
            </ul>
            <p className="mt-3">
              Harbor's total liability for any claim shall not exceed the fees you paid in the past 12 months.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">9. Data Ownership</h2>
            <p>
              You retain full ownership of your practice data and patient information. Harbor retains the right to:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Use aggregated, anonymized data to improve our service</li>
              <li>Analyze call patterns and performance metrics to optimize AI responses</li>
              <li>Delete your data according to our Privacy Policy</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">10. Governing Law</h2>
            <p>
              These Terms of Service are governed by and construed in accordance with the laws of the State of Oregon, USA, without regard to its conflict of law principles. You agree to submit to the exclusive jurisdiction of the courts located in Oregon.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">11. Changes to Terms</h2>
            <p>
              We may update these Terms of Service from time to time. Material changes will be notified to you via email. Continued use of Harbor after notification constitutes acceptance of the updated Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">12. Termination</h2>
            <p>
              We reserve the right to terminate your account if you:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Violate these Terms of Service</li>
              <li>Engage in illegal activity or misuse of the service</li>
              <li>Fail to pay fees for more than 30 days</li>
              <li>Pose a security risk to Harbor or other users</li>
            </ul>
            <p className="mt-3">
              Upon termination, you lose access to Harbor. We will retain your data according to our Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">13. Contact Information</h2>
            <p>
              For questions about these Terms of Service, please contact:
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mt-3">
              <p className="font-medium text-gray-900">Harbor Legal Team</p>
              <p className="text-sm text-gray-600">Email: legal@harbor.ai</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
