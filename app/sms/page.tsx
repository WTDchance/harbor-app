// app/sms/page.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "SMS Terms",
    description:
          "SMS messaging program terms, opt-in, opt-out, message types, frequency, and how to manage your preferences.",
    alternates: {
          canonical: "https://harborreceptionist.com/sms",
    },
};

export default function SmsProgramPage() {
    return (
          <main className="max-w-3xl mx-auto px-6 py-16 text-gray-800">
                <h1 className="text-3xl font-bold mb-2 text-[#021E26]">SMS Messaging Program</h1>h1>
                <p className="text-sm text-gray-500 mb-10">Last updated: April 2026</p>p>
          
                <section className="mb-8">
                        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">1. Program description</h2>h2>
                        <p className="mb-4">
                                  Harbor Receptionist is a product of <strong>Delta Traffic Labs LLC</strong>strong>
                          {' '}(the brand registered with The Campaign Registry for this SMS program),
                                  operating under the trade name &ldquo;Harbor Receptionist&rdquo; at
                                  harborreceptionist.com. Harbor Receptionist is an AI receptionist platform
                                  used by independent therapy practices in the United States. As part of the
                                  platform, we send transactional SMS text messages to patients of these
                                  therapy practices. Messages include appointment confirmations, appointment
                                  reminders, intake form delivery links, waitlist offers, and basic
                                  scheduling correspondence.
                        </p>p>
                </section>section>
          
                <section className="mb-8">
                        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">2. How patients opt in</h2>h2>
                        <p className="mb-3">
                                  Patients opt in to receive SMS messages by providing their mobile
                                  phone number to a participating therapy practice through one of the
                                  following channels:
                        </p>p>
                        <ul className="list-disc pl-6 mb-4">
                                  <li className="mb-2">
                                              <strong>Phone call:</strong>strong> When a patient calls a Harbor practice
                                              and schedules an appointment with the practice's AI receptionist,
                                              the receptionist verbally collects the patient's mobile number and
                                              states: "Is it okay if we send appointment confirmations and
                                              reminders to this number? Reply STOP at any time to opt out."
                                  </li>li>
                                  <li className="mb-2">
                                              <strong>Intake form:</strong>strong> When a patient completes a Harbor
                                              intake form, the form contains an explicit checkbox: "I agree
                                              to receive appointment-related SMS messages from this practice.
                                              Message and data rates may apply. Message frequency varies. Reply
                                              STOP to opt out, HELP for help."
                                  </li>li>
                                  <li>
                                              <strong>In person at the practice:</strong>strong> When a patient gives
                                              the practice their phone number and signs the practice's standard
                                              intake paperwork, which includes the SMS consent language above.
                                  </li>li>
                        </ul>ul>
                        <p>
                                  Consent is collected and stored by the participating therapy practice
                                  on Harbor's behalf. Harbor only sends SMS messages to phone numbers
                                  that have been opted in through one of these channels.
                        </p>p>
                </section>section>
          
                <section className="mb-8">
                        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">3. Message types and samples</h2>h2>
                        <p className="mb-3">Examples of messages we send:</p>p>
                        <ul className="list-disc pl-6 mb-2">
                                  <li className="mb-2">
                                              <em>Confirmation:</em>em> "Hi Alex, your appointment with Dr.
                                              Smith is confirmed for Tue Apr 14 at 2:00pm. Reply STOP to opt out."
                                  </li>li>
                                  <li className="mb-2">
                                              <em>Reminder:</em>em> "Reminder: appointment with Dr. Smith
                                              tomorrow at 2:00pm. Reply CONFIRM to confirm or CANCEL to cancel.
                                              Reply STOP to opt out."
                                  </li>li>
                                  <li className="mb-2">
                                              <em>Intake delivery:</em>em> "Hi Alex, please complete your
                                              intake forms before your appointment: https://harborreceptionist.com/intake/abc123
                                              . Reply STOP to opt out."
                                  </li>li>
                        </ul>ul>
                </section>section>
          
                <section className="mb-8">
                        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">4. Message frequency</h2>h2>
                        <p>
                                  Message frequency varies by practice and patient activity. Most
                                  patients receive between 1 and 6 messages per appointment cycle
                                  (confirmation, reminder, intake link, follow-up). Patients on a
                                  waitlist may receive additional offer messages.
                        </p>p>
                </section>section>
          
                <section className="mb-8">
                        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">5. Cost</h2>h2>
                        <p>Standard message and data rates may apply.</p>p>
                </section>section>
          
                <section className="mb-8">
                        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">6. How to opt out</h2>h2>
                        <p className="mb-3">
                                  Reply <strong>STOP</strong>strong> to any message to immediately opt out of
                                  all SMS messages from that practice. You will receive a final
                                  confirmation message and no further messages will be sent unless you
                                  opt back in.
                        </p>p>
                        <p>
                                  Reply <strong>HELP</strong>strong> at any time to receive help. You may also
                                  email support@harborreceptionist.com for assistance.
                        </p>p>
                </section>section>
          
                <section className="mb-8">
                        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">7. Privacy and data sharing</h2>h2>
                        <p className="mb-3">
                                  No mobile information will be shared with third parties or affiliates
                                  for marketing or promotional purposes. Information sharing to
                                  subcontractors that support customer service or security is permitted.
                                  All other categories exclude text messaging originator opt-in data and
                                  consent; this information will not be shared with any third parties.
                        </p>p>
                        <p>
                                  See our <a className="text-[#0d9488] underline" href="/privacy-policy">Privacy Policy</a>a>
                          {' '}and <a className="text-[#0d9488] underline" href="/terms">Terms of Service</a>a>
                          {' '}for full details.
                        </p>p>
                </section>section>
          
                <section className="mb-8">
                        <h2 className="text-xl font-semibold mb-3 text-[#021E26]">8. Contact</h2>h2>
                        <p>
                                  Harbor Receptionist (a product of Delta Traffic Labs LLC)
                                  <br />
                                  Email: support@harborreceptionist.com
                                  <br />
                                  Website: harborreceptionist.com
                        </p>p>
                </section>section>
          </main>main>
        );
}</main>
