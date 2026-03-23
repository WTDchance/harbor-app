'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

const PHQ9_QUESTIONS = [
  'Little interest or pleasure in doing things',
  'Feeling down, depressed, or hopeless',
  'Trouble falling or staying asleep, or sleeping too much',
  'Feeling tired or having little energy',
  'Poor appetite or overeating',
  'Feeling bad about yourself — or that you are a failure or have let yourself or your family down',
  'Trouble concentrating on things, such as reading the newspaper or watching television',
  'Moving or speaking so slowly that other people could have noticed — or the opposite, being so fidgety or restless',
  'Thoughts that you would be better off dead, or of hurting yourself in some way'
]

const GAD7_QUESTIONS = [
  'Feeling nervous, anxious, or on edge',
  'Not being able to stop or control worrying',
  'Worrying too much about different things',
  'Trouble relaxing',
  'Being so restless that it is hard to sit still',
  'Becoming easily annoyed or irritable',
  'Feeling afraid, as if something awful might happen'
]

const FREQUENCY_OPTIONS = [
  { value: 0, label: 'Not at all' },
  { value: 1, label: 'Several days' },
  { value: 2, label: 'More than half the days' },
  { value: 3, label: 'Nearly every day' }
]

type Step = 'loading' | 'intro' | 'phq9' | 'gad7' | 'notes' | 'submitting' | 'done' | 'error'

export default function IntakePage() {
  const params = useParams()
  const token = params?.token as string

  const [step, setStep] = useState<Step>('loading')
  const [patientName, setPatientName] = useState('')
  const [phq9Answers, setPHQ9Answers] = useState<number[]>(new Array(9).fill(-1))
  const [gad7Answers, setGAD7Answers] = useState<number[]>(new Array(7).fill(-1))
  const [notes, setNotes] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!token) return
    fetch(`/api/intake/submit?token=${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.valid) {
          setPatientName(data.patient_name || '')
          setStep('intro')
        } else if (data.status === 'completed') {
          setStep('done')
        } else {
          setErrorMessage('This intake form has expired or is no longer valid.')
          setStep('error')
        }
      })
      .catch(() => {
        setErrorMessage('Unable to load intake form. Please try again.')
        setStep('error')
      })
  }, [token])

  const allPHQ9Answered = phq9Answers.every(a => a >= 0)
  const allGAD7Answered = gad7Answers.every(a => a >= 0)

  async function handleSubmit() {
    setStep('submitting')
    try {
      const res = await fetch('/api/intake/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          phq9_answers: phq9Answers,
          gad7_answers: gad7Answers,
          additional_notes: notes || null
        })
      })
      const data = await res.json()
      if (data.success) {
        setStep('done')
      } else {
        setErrorMessage(data.error || 'Something went wrong. Please try again.')
        setStep('error')
      }
    } catch {
      setErrorMessage('Network error. Please check your connection and try again.')
      setStep('error')
    }
  }

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center text-gray-500">Loading your intake form...</div>
      </div>
    )
  }

  if (step === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Form Unavailable</h1>
          <p className="text-gray-500">{errorMessage}</p>
        </div>
      </div>
    )
  }

  if (step === 'done') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Thank you!</h1>
          <p className="text-gray-600 text-lg">Your responses have been saved. Your therapist will review them before your appointment.</p>
          <p className="text-gray-400 text-sm mt-4">You can close this window.</p>
        </div>
      </div>
    )
  }

  const greeting = patientName ? `Hi ${patientName}` : 'Hi there'

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Session Intake</h1>
          <p className="text-gray-500 mt-1">Powered by Harbor</p>
        </div>

        {step === 'intro' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-3">{greeting} 👋</h2>
            <p className="text-gray-600 mb-4">
              Your therapist has asked you to complete a brief questionnaire before your first appointment.
              This helps them understand how you\'ve been feeling and prepare for your session.
            </p>
            <p className="text-gray-500 text-sm mb-6">It takes about 2–3 minutes and covers two standard mental health assessments (PHQ-9 and GAD-7).</p>
            <button
              onClick={() => setStep('phq9')}
              className="w-full bg-teal-500 hover:bg-teal-600 text-white font-semibold py-3 rounded-xl transition"
            >
              Start Questionnaire →
            </button>
          </div>
        )}

        {step === 'phq9' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <div className="mb-4">
              <span className="text-xs font-semibold text-teal-600 bg-teal-50 px-2 py-1 rounded-full">1 of 2</span>
              <h2 className="text-lg font-semibold text-gray-900 mt-2">PHQ-9: Depression Screening</h2>
              <p className="text-gray-500 text-sm">Over the last 2 weeks, how often have you been bothered by the following?</p>
            </div>
            <div className="space-y-6">
              {PHQ9_QUESTIONS.map((q, i) => (
                <div key={i}>
                  <p className="text-gray-700 text-sm font-medium mb-2">{i + 1}. {q}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {FREQUENCY_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          const updated = [...phq9Answers]
                          updated[i] = opt.value
                          setPHQ9Answers(updated)
                        }}
                        className={`text-xs py-2 px-3 rounded-lg border transition ${
                          phq9Answers[i] === opt.value
                            ? 'bg-teal-500 text-white border-teal-500'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setStep('gad7')}
              disabled={!allPHQ9Answered}
              className="w-full mt-6 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition"
            >
              Next: Anxiety Screening →
            </button>
          </div>
        )}

        {step === 'gad7' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <div className="mb-4">
              <span className="text-xs font-semibold text-teal-600 bg-teal-50 px-2 py-1 rounded-full">2 of 2</span>
              <h2 className="text-lg font-semibold text-gray-900 mt-2">GAD-7: Anxiety Screening</h2>
              <p className="text-gray-500 text-sm">Over the last 2 weeks, how often have you been bothered by the following?</p>
            </div>
            <div className="space-y-6">
              {GAD7_QUESTIONS.map((q, i) => (
                <div key={i}>
                  <p className="text-gray-700 text-sm font-medium mb-2">{i + 1}. {q}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {FREQUENCY_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          const updated = [...gad7Answers]
                          updated[i] = opt.value
                          setGAD7Answers(updated)
                        }}
                        className={`text-xs py-2 px-3 rounded-lg border transition ${
                          gad7Answers[i] === opt.value
                            ? 'bg-teal-500 text-white border-teal-500'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setStep('notes')}
              disabled={!allGAD7Answered}
              className="w-full mt-6 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition"
            >
              Almost done →
            </button>
          </div>
        )}

        {step === 'notes' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Anything else to share?</h2>
            <p className="text-gray-500 text-sm mb-4">Optional: Is there anything specific you want your therapist to know before your appointment?</p>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={4}
              placeholder="I've been feeling anxious about work lately..."
              className="w-full border border-gray-200 rounded-xl p-3 text-sm text-gray-700 focus:outline-none focus:border-teal-400 resize-none"
            />
            <button
              onClick={handleSubmit}
              className="w-full mt-4 bg-teal-500 hover:bg-teal-600 text-white font-semibold py-3 rounded-xl transition"
            >
              Submit Responses ✓
            </button>
            <button
              onClick={handleSubmit}
              className="w-full mt-2 text-gray-400 text-sm py-2"
            >
              Skip and submit
            </button>
          </div>
        )}

        {step === 'submitting' && (
          <div className="bg-white rounded-2xl shadow p-8 text-center">
            <div className="text-gray-500">Saving your responses...</div>
          </div>
        )}
      </div>
    </div>
  )
}
