'use client'

import { useState } from 'react'
import { ChevronRight, Check } from 'lucide-react'

type Step = 'basics' | 'ai' | 'phone' | 'done'

interface OnboardingWizardProps {
  onComplete?: () => void
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>('basics')
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    practiceName: '',
    aiName: 'Sam',
    timezone: 'America/Los_Angeles',
    insurancePlans: [] as string[],
  })

  const insuranceOptions = [
    'Aetna',
    'BlueCross',
    'Cigna',
    'United Healthcare',
    'Humana',
    'Medicare',
    'Medicaid',
  ]

  const handleNext = async () => {
    if (step === 'basics') {
      setStep('ai')
    } else if (step === 'ai') {
      setStep('phone')
    } else if (step === 'phone') {
      setLoading(true)
      try {
        // Save practice to database
        const response = await fetch('/api/practices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.practiceName,
            ai_name: formData.aiName,
            timezone: formData.timezone,
            insurance_accepted: formData.insurancePlans,
            phone_number: '+15551234567', // Would be set by user
          }),
        })

        if (response.ok) {
          setStep('done')
          onComplete?.()
        }
      } catch (error) {
        console.error('Error saving practice:', error)
      } finally {
        setLoading(false)
      }
    }
  }

  const steps: { id: Step; title: string; number: number }[] = [
    { id: 'basics', title: 'Practice Basics', number: 1 },
    { id: 'ai', title: 'AI Configuration', number: 2 },
    { id: 'phone', title: 'Phone Setup', number: 3 },
    { id: 'done', title: 'Done!', number: 4 },
  ]

  const isStepComplete = (stepId: Step) => {
    const stepOrder: Step[] = ['basics', 'ai', 'phone', 'done']
    return stepOrder.indexOf(stepId) < stepOrder.indexOf(step)
  }

  return (
    <div className="max-w-2xl mx-auto py-12">
      {/* Progress Steps */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {steps.map((s, index) => (
            <div key={s.id} className="flex items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
                  step === s.id
                    ? 'bg-teal-600 text-white'
                    : isStepComplete(s.id)
                    ? 'bg-teal-100 text-teal-700'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                {isStepComplete(s.id) ? <Check className="w-5 h-5" /> : s.number}
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`flex-1 h-1 mx-2 ${
                    isStepComplete(s.id) ? 'bg-teal-600' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="bg-white rounded-lg shadow-sm p-8">
        {step === 'basics' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Practice Basics</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Practice Name
                </label>
                <input
                  type="text"
                  value={formData.practiceName}
                  onChange={(e) =>
                    setFormData({ ...formData, practiceName: e.target.value })
                  }
                  placeholder="e.g., Hope and Harmony Counseling"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Timezone
                </label>
                <select
                  value={formData.timezone}
                  onChange={(e) =>
                    setFormData({ ...formData, timezone: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                >
                  <option>America/Los_Angeles</option>
                  <option>America/Denver</option>
                  <option>America/Chicago</option>
                  <option>America/New_York</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Insurance Plans Accepted
                </label>
                <div className="space-y-2">
                  {insuranceOptions.map((plan) => (
                    <label key={plan} className="flex items-center">
                      <input
                        type="checkbox"
                        checked={formData.insurancePlans.includes(plan)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({
                              ...formData,
                              insurancePlans: [...formData.insurancePlans, plan],
                            })
                          } else {
                            setFormData({
                              ...formData,
                              insurancePlans: formData.insurancePlans.filter((p) => p !== plan),
                            })
                          }
                        }}
                        className="w-4 h-4 text-teal-600 rounded"
                      />
                      <span className="ml-2 text-sm text-gray-700">{plan}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 'ai' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">AI Receptionist Setup</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  AI Receptionist Name
                </label>
                <input
                  type="text"
                  value={formData.aiName}
                  onChange={(e) => setFormData({ ...formData, aiName: e.target.value })}
                  placeholder="e.g., Sam"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  This name will be used when greeting callers
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-semibold text-blue-900 mb-2">AI Capabilities</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>✓ Greets callers professionally and warmly</li>
                  <li>✓ Handles new patient intake (name, email, insurance)</li>
                  <li>✓ Books and reschedules appointments</li>
                  <li>✓ Answers common practice questions</li>
                  <li>✓ Detects crisis situations and directs to 988</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {step === 'phone' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Phone Number Setup</h2>
            <div className="space-y-4">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="font-semibold text-gray-900 mb-2">Next Steps</h4>
                <ol className="space-y-3 text-sm text-gray-700">
                  <li className="flex gap-3">
                    <span className="font-semibold text-teal-600 flex-shrink-0">1.</span>
                    <span>Sign up for a Twilio account at twilio.com</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-semibold text-teal-600 flex-shrink-0">2.</span>
                    <span>Get a phone number from Twilio</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-semibold text-teal-600 flex-shrink-0">3.</span>
                    <span>Configure the number to route to Harbor in your Twilio dashboard</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-semibold text-teal-600 flex-shrink-0">4.</span>
                    <span>Test by calling your Twilio number</span>
                  </li>
                </ol>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-sm text-yellow-800">
                  <strong>Optional:</strong> If you already have a phone number, we can port it
                  to Twilio (contact support for details)
                </p>
              </div>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="text-center">
            <Check className="w-16 h-16 text-teal-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">You're All Set!</h2>
            <p className="text-gray-600 mb-6">
              {formData.practiceName} is ready to go. Your AI receptionist is waiting for calls.
            </p>

            <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 mb-6">
              <h4 className="font-semibold text-teal-900 mb-2">Getting Started Checklist</h4>
              <ul className="text-sm text-teal-800 space-y-2">
                <li>✓ Practice created</li>
                <li>✓ AI receptionist configured</li>
                <li>□ Twilio phone number configured</li>
                <li>□ Make a test call to verify</li>
                <li>□ Customize business hours in settings</li>
              </ul>
            </div>

            <button
              onClick={onComplete}
              className="bg-teal-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-teal-700"
            >
              Go to Dashboard
            </button>
          </div>
        )}

        {/* Buttons */}
        {step !== 'done' && (
          <div className="flex gap-4 mt-8 pt-8 border-t border-gray-200">
            <button
              onClick={() => {
                const stepOrder: Step[] = ['basics', 'ai', 'phone']
                const currentIndex = stepOrder.indexOf(step)
                if (currentIndex > 0) {
                  setStep(stepOrder[currentIndex - 1])
                }
              }}
              disabled={step === 'basics'}
              className="px-6 py-2 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Back
            </button>
            <button
              onClick={handleNext}
              disabled={
                loading ||
                (step === 'basics' && !formData.practiceName) ||
                (step === 'ai' && !formData.aiName)
              }
              className="ml-auto flex items-center gap-2 bg-teal-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Saving...' : 'Next'}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
