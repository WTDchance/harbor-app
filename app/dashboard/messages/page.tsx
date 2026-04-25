'use client'

import { useState } from 'react'
import { Send, Users, Calendar, CheckCircle, AlertCircle, MessageSquare, Zap } from 'lucide-react'

const TEMPLATES = [
  {
    id: 'therapist_sick',
    label: 'Therapist Sick / Cancellation',
    icon: '🤒',
    message: 'Hi {{patient_name}}, we wanted to let you know that your therapist is out sick and your appointment on {{appointment_date}} at {{appointment_time}} has been canceled. We will reach out shortly to reschedule. We apologize for the inconvenience. — {{practice_name}}'
  },
  {
    id: 'office_closed',
    label: 'Office Closed',
    icon: '🏢',
    message: 'Hi {{patient_name}}, our office will be closed on {{appointment_date}}. If you had an appointment, we will contact you soon to reschedule. Thank you for your patience. — {{practice_name}}'
  },
  {
    id: 'appointment_reminder',
    label: 'Appointment Reminder',
    icon: '📅',
    message: 'Hi {{patient_name}}, just a reminder that you have an appointment on {{appointment_date}} at {{appointment_time}} with {{practice_name}}. Please reply STOP to opt out of messages.'
  },
  {
    id: 'reschedule_request',
    label: 'Reschedule Request',
    icon: '🔄',
    message: 'Hi {{patient_name}}, we need to reschedule your appointment on {{appointment_date}} at {{appointment_time}}. Please call us or reply to choose a new time. — {{practice_name}}'
  },
  {
    id: 'opening_available',
    label: 'Opening Available',
    icon: '✨',
    message: 'Hi {{patient_name}}, good news! We have an opening available. If you would like to schedule or move up an appointment, please call us. — {{practice_name}}'
  }
]

type RecipientType = 'all' | 'by_date' | 'upcoming'
type Step = 'compose' | 'confirm' | 'success'

interface SendResult {
  sent: number
  failed: number
  total: number
}

export default function MessagesPage() {
  const [step, setStep] = useState<Step>('compose')
  const [message, setMessage] = useState('')
  const [recipientType, setRecipientType] = useState<RecipientType>('upcoming')
  const [targetDate, setTargetDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null)
  const [countLoading, setCountLoading] = useState(false)

  const charCount = message.length
  const isOverLimit = charCount > 160

  function applyTemplate(templateMessage: string) {
    setMessage(templateMessage)
  }

  function insertVariable(variable: string) {
    setMessage(prev => prev + variable)
  }

  const previewMessage = message
    .replace(/{{patient_name}}/g, 'Jane Smith')
    .replace(/{{practice_name}}/g, 'Hope and Harmony Counseling')
    .replace(/{{appointment_date}}/g, targetDate || 'March 25, 2025')
    .replace(/{{appointment_time}}/g, '2:00 PM')

  async function fetchEstimate() {
    setCountLoading(true)
    try {
      const res = await fetch('/api/messages/bulk-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'estimate_only',
          recipient_type: recipientType,
          target_date: targetDate || undefined,
          dry_run: true
        })
      })
      const data = await res.json()
      setEstimatedCount(data.total ?? null)
    } catch {
      setEstimatedCount(null)
    }
    setCountLoading(false)
  }

  async function handleSend() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/messages/bulk-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          recipient_type: recipientType,
          target_date: targetDate || undefined
        })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to send messages')
        setStep('compose')
      } else {
        setResult(data)
        setStep('success')
      }
    } catch {
      setError('Network error. Please try again.')
      setStep('compose')
    }
    setLoading(false)
  }

  function reset() {
    setStep('compose')
    setMessage('')
    setRecipientType('upcoming')
    setTargetDate('')
    setResult(null)
    setError(null)
    setEstimatedCount(null)
  }

  return (
    <main className="flex-1 p-8 max-w-4xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Bulk Messages</h1>
        <p className="text-gray-500 mt-1">Send personalized SMS messages to patients</p>
      </div>

      {step === 'success' && result && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Messages Sent!</h2>
          <p className="text-gray-500 mb-6">
            Successfully sent <span className="font-bold text-gray-900">{result.sent}</span> of{' '}
            <span className="font-bold text-gray-900">{result.total}</span> messages.
            {result.failed > 0 && (
              <span className="text-amber-600"> {result.failed} failed to send.</span>
            )}
          </p>
          <button
            onClick={reset}
            className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
          >
            Send Another Message
          </button>
        </div>
      )}

      {step === 'confirm' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Confirm Send</h2>
          <div className="bg-gray-50 rounded-xl p-4 mb-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Message Preview</p>
            <p className="text-gray-800 text-sm leading-relaxed">{previewMessage}</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Recipients</p>
            <p className="text-gray-800 text-sm">
              {recipientType === 'all' && 'All active patients'}
              {recipientType === 'upcoming' && 'Patients with upcoming appointments (next 7 days)'}
              {recipientType === 'by_date' && `Patients with appointments on ${targetDate || 'selected date'}`}
              {estimatedCount !== null && <span className="text-teal-600 font-medium"> (~{estimatedCount} recipients)</span>}
            </p>
          </div>
          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-lg p-3 mb-4">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => setStep('compose')}
              disabled={loading}
              className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Back
            </button>
            <button
              onClick={handleSend}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Send Messages
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {step === 'compose' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 text-teal-600" />
                <h2 className="font-semibold text-gray-900 text-sm">Quick Templates</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {TEMPLATES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => applyTemplate(t.message)}
                    className="text-left p-3 rounded-xl border border-gray-100 hover:border-teal-200 hover:bg-teal-50 transition-all group"
                  >
                    <span className="text-lg mr-2">{t.icon}</span>
                    <span className="text-sm text-gray-700 group-hover:text-teal-700">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-teal-600" />
                  <h2 className="font-semibold text-gray-900 text-sm">Message</h2>
                </div>
                <span className={`text-xs font-medium ${isOverLimit ? 'text-red-500' : 'text-gray-400'}`}>
                  {charCount}/160
                </span>
              </div>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Type your message or select a template above..."
                rows={5}
                className="w-full text-sm text-gray-800 placeholder-gray-400 border border-gray-200 rounded-xl p-3 resize-none focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
              />
              {isOverLimit && (
                <p className="text-xs text-red-500 mt-1">
                  Message exceeds 160 characters and may be split into multiple SMS segments.
                </p>
              )}
              <div className="flex flex-wrap gap-2 mt-3">
                <p className="text-xs text-gray-400 w-full mb-1">Insert variable:</p>
                {['{{patient_name}}', '{{practice_name}}', '{{appointment_date}}', '{{appointment_time}}'].map(v => (
                  <button
                    key={v}
                    onClick={() => insertVariable(v)}
                    className="px-2 py-1 bg-gray-100 hover:bg-teal-100 text-gray-600 hover:text-teal-700 rounded-lg text-xs font-mono transition-colors"
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-teal-600" />
                <h2 className="font-semibold text-gray-900 text-sm">Recipients</h2>
              </div>
              <div className="space-y-2">
                {[
                  { value: 'upcoming', label: 'Upcoming appointments', description: 'Patients with appointments in the next 7 days' },
                  { value: 'by_date', label: 'By specific date', description: 'Patients with appointments on a chosen date' },
                  { value: 'all', label: 'All active patients', description: 'Every patient who has ever had an appointment' }
                ].map(opt => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                      recipientType === opt.value
                        ? 'border-teal-300 bg-teal-50'
                        : 'border-gray-100 hover:border-gray-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="recipient_type"
                      value={opt.value}
                      checked={recipientType === opt.value}
                      onChange={() => { setRecipientType(opt.value as RecipientType); setEstimatedCount(null) }}
                      className="mt-0.5 accent-teal-600"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-800">{opt.label}</p>
                      <p className="text-xs text-gray-500">{opt.description}</p>
                    </div>
                  </label>
                ))}
              </div>
              {recipientType === 'by_date' && (
                <div className="mt-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Select date</label>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={e => { setTargetDate(e.target.value); setEstimatedCount(null) }}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </div>
              )}
              <button
                onClick={fetchEstimate}
                disabled={countLoading || (recipientType === 'by_date' && !targetDate)}
                className="mt-3 text-xs text-teal-600 hover:text-teal-800 underline disabled:opacity-40"
              >
                {countLoading ? 'Estimating...' : 'Estimate recipient count'}
              </button>
              {estimatedCount !== null && (
                <p className="text-xs text-gray-500 mt-1">~{estimatedCount} recipients</p>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            <button
              onClick={() => { setStep('confirm'); setError(null) }}
              disabled={!message.trim() || (recipientType === 'by_date' && !targetDate)}
              className="w-full py-3 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-colors flex items-center justify-center gap-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
              Review &amp; Send
            </button>
          </div>

          <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 text-sm mb-3">Live Preview</h2>
              <p className="text-xs text-gray-400 mb-3">Sample: Jane Smith, appt March 25 at 2:00 PM</p>
              <div className="bg-gray-50 rounded-xl p-4 min-h-24">
                {previewMessage ? (
                  <p className="text-sm text-gray-800 leading-relaxed">{previewMessage}</p>
                ) : (
                  <p className="text-sm text-gray-400 italic">Your message preview will appear here...</p>
                )}
              </div>
              {charCount > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-400">
                    {isOverLimit ? `~${Math.ceil(charCount / 160)} SMS segments` : '1 SMS segment'}
                  </p>
                </div>
              )}
            </div>

            <div className="bg-teal-50 rounded-2xl border border-teal-100 p-4">
              <h3 className="text-xs font-semibold text-teal-800 mb-2">Available Variables</h3>
              <ul className="space-y-1">
                {[
                  ['{{patient_name}}', "Patient's name"],
                  ['{{practice_name}}', 'Practice name'],
                  ['{{appointment_date}}', 'Appt. date'],
                  ['{{appointment_time}}', 'Appt. time']
                ].map(([v, desc]) => (
                  <li key={v} className="flex items-start gap-2">
                    <code className="text-xs bg-white px-1 py-0.5 rounded text-teal-700 font-mono whitespace-nowrap">{v}</code>
                    <span className="text-xs text-teal-600">{desc}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
