'use client' 

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'

// âââ Constants ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const PHQ9_QUESTIONS = [
  'Little interest or pleasure in doing things',
  'Feeling down, depressed, or hopeless',
  'Trouble falling or staying asleep, or sleeping too much',
  'Feeling tired or having little energy',
  'Poor appetite or overeating',
  'Feeling bad about yourself â or that you are a failure or have let yourself or your family down',
  'Trouble concentrating on things, such as reading the newspaper or watching television',
  'Moving or speaking so slowly that other people could have noticed â or the opposite, being so fidgety or restless',
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

type Step = 'loading' | 'intro' | 'demographics' | 'insurance' | 'phq9' | 'gad7' | 'consent' | 'notes' | 'submitting' | 'done' | 'error'

type IntakeDocument = {
  id: string
  name: string
  requires_signature: boolean
  content_url: string | null
  description: string | null
}

type Demographics = {
  first_name: string
  last_name: string
  date_of_birth: string
  phone: string
  email: string
  address: string
  city: string
  state: string
  zip: string
  emergency_contact_name: string
  emergency_contact_phone: string
  emergency_contact_relationship: string
  preferred_pronouns: string
  referral_source: string
}

type InsuranceInfo = {
  has_insurance: boolean | null
  insurance_provider: string
  policy_number: string
  group_number: string
  subscriber_name: string
  subscriber_dob: string
  relationship_to_subscriber: string
}

// âââ Signature Pad Component ââââââââââââââââââââââââââââââââââââââââââââ
function SignaturePad({ onSignatureChange, label }: { onSignatureChange: (data: string | null) => void; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)

  const getPos = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top }
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  const startDrawing = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return
    const pos = getPos(e)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    setIsDrawing(true)
  }, [getPos])

  const draw = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    if (!isDrawing) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return
    const pos = getPos(e)
    ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = '#1a1a1a'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
  }, [isDrawing, getPos])

  const stopDrawing = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false)
      setHasSignature(true)
      const canvas = canvasRef.current
      if (canvas) {
        onSignatureChange(canvas.toDataURL('image/png'))
      }
    }
  }, [isDrawing, onSignatureChange])

  const clearSignature = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
    onSignatureChange(null)
  }, [onSignatureChange])

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <div className="relative border-2 border-dashed border-gray-300 rounded-xl bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          width={500}
          height={150}
          className="w-full cursor-crosshair touch-none"
          style={{ height: '150px' }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        {!hasSignature && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-gray-300 text-sm">Sign here</p>
          </div>
        )}
      </div>
      {hasSignature && (
        <button type="button" onClick={clearSignature} className="text-xs text-red-500 hover:text-red-600">
          Clear signature
        </button>
      )}
    </div>
  )
}

// âââ Progress Bar âââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = Math.round((current / total) * 100)
  return (
    <div className="mb-6">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>Step {current} of {total}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-teal-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// âââ Main Page ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
export default function IntakePage() {
  const params = useParams()
  const token = params?.token as string

  const [step, setStep] = useState<Step>('loading')
  const [patientName, setPatientName] = useState('')
  const [practiceName, setPracticeName] = useState('')
  const [phq9Answers, setPHQ9Answers] = useState<number[]>(new Array(9).fill(-1))
  const [gad7Answers, setGAD7Answers] = useState<number[]>(new Array(7).fill(-1))
  const [notes, setNotes] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [documents, setDocuments] = useState<IntakeDocument[]>([])
  const [documentAcks, setDocumentAcks] = useState<Record<string, boolean>>({})
  const [documentSignatures, setDocumentSignatures] = useState<Record<string, string | null>>({})
  const [mainSignature, setMainSignature] = useState<string | null>(null)
  const [signedName, setSignedName] = useState('')

  const [demographics, setDemographics] = useState<Demographics>({
    first_name: '', last_name: '', date_of_birth: '', phone: '', email: '',
    address: '', city: '', state: '', zip: '',
    emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relationship: '',
    preferred_pronouns: '', referral_source: ''
  })

  const [insurance, setInsurance] = useState<InsuranceInfo>({
    has_insurance: null, insurance_provider: '', policy_number: '',
    group_number: '', subscriber_name: '', subscriber_dob: '', relationship_to_subscriber: 'self'
  })

  useEffect(() => {
    if (!token) return
    fetch(`/api/intake/submit?token=${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.valid) {
          setPatientName(data.patient_name || '')
          setPracticeName(data.practice_name || '')
          if (data.patient_name) {
            const parts = data.patient_name.split(' ')
            setDemographics(d => ({
              ...d,
              first_name: parts[0] || '',
              last_name: parts.slice(1).join(' ') || ''
            }))
          }
          if (data.patient_phone) setDemographics(d => ({ ...d, phone: data.patient_phone }))
          if (data.patient_email) setDemographics(d => ({ ...d, email: data.patient_email }))
          if (data.documents) setDocuments(data.documents)
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
  const demographicsValid = demographics.first_name && demographics.last_name && demographics.date_of_birth && demographics.phone
  const allDocsAcknowledged = documents.every(d => documentAcks[d.id])
  const allRequiredSigned = documents.filter(d => d.requires_signature).every(d => documentSignatures[d.id])
  const consentComplete = allDocsAcknowledged && allRequiredSigned && mainSignature && signedName

  const steps: Step[] = ['intro', 'demographics', 'insurance', 'phq9', 'gad7', 'consent', 'notes']
  const currentStepIndex = steps.indexOf(step)
  const totalSteps = steps.length - 1 // exclude intro

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
          additional_notes: notes || null,
          demographics,
          insurance,
          signature: mainSignature,
          signed_name: signedName,
          document_acknowledgments: documentAcks,
          document_signatures: documentSignatures
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

  function updateDemographics(field: keyof Demographics, value: string) {
    setDemographics(d => ({ ...d, [field]: value }))
  }

  function updateInsurance(field: keyof InsuranceInfo, value: string | boolean | null) {
    setInsurance(i => ({ ...i, [field]: value }))
  }

  // âââ Render States ââââââââââââââââââââââââââââââââââââââââââââââââââ
  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading your intake form...</p>
        </div>
      </div>
    )
  }

  if (step === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
          <div className="text-4xl mb-4">â ï¸</div>
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
          <div className="text-5xl mb-4">â</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Thank you!</h1>
          <p className="text-gray-600 text-lg">Your intake forms have been submitted. Your therapist will review everything before your first appointment.</p>
          <p className="text-gray-400 text-sm mt-4">You can close this window.</p>
        </div>
      </div>
    )
  }

  if (step === 'submitting') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow p-8 text-center">
          <div className="w-8 h-8 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500">Saving your responses...</p>
        </div>
      </div>
    )
  }

  const greeting = patientName ? `Hi ${patientName}` : 'Hi there'
  const practiceLabel = practiceName || 'your therapist'

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Patient Intake</h1>
          <p className="text-gray-500 mt-1">Powered by Harbor</p>
        </div>

        {currentStepIndex > 0 && (
          <ProgressBar current={currentStepIndex} total={totalSteps} />
        )}

        {/* âââ Intro ââââââââââââââââââââââââââââââââââââââââââââ */}
        {step === 'intro' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-3">{greeting} ð</h2>
            <p className="text-gray-600 mb-4">
              {practiceLabel} has sent you an intake packet to complete before your first appointment. This helps your therapist prepare for your session.
            </p>
            <div className="bg-teal-50 rounded-xl p-4 mb-6">
              <p className="text-teal-800 text-sm font-medium mb-2">You will complete:</p>
              <ul className="text-teal-700 text-sm space-y-1.5">
                <li className="flex items-center gap-2"><span className="text-teal-500">ð</span> Personal information</li>
                <li className="flex items-center gap-2"><span className="text-teal-500">ð¥</span> Insurance details</li>
                <li className="flex items-center gap-2"><span className="text-teal-500">ð</span> Mental health screenings (PHQ-9 &amp; GAD-7)</li>
                {documents.length > 0 && (
                  <li className="flex items-center gap-2"><span className="text-teal-500">ð</span> Consent forms &amp; e-signatures</li>
                )}
              </ul>
              <p className="text-teal-600 text-xs mt-3">Takes about 5â10 minutes</p>
            </div>
            <button
              onClick={() => setStep('demographics')}
              className="w-full bg-teal-500 hover:bg-teal-600 text-white font-semibold py-3 rounded-xl transition"
            >
              Get Started â
            </button>
          </div>
        )}

        {/* âââ Demographics âââââââââââââââââââââââââââââââââââââ */}
        {step === 'demographics' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Personal Information</h2>
            <p className="text-gray-500 text-sm mb-5">Fields marked with * are required</p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">First Name *</label>
                  <input type="text" value={demographics.first_name} onChange={e => updateDemographics('first_name', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Last Name *</label>
                  <input type="text" value={demographics.last_name} onChange={e => updateDemographics('last_name', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date of Birth *</label>
                  <input type="date" value={demographics.date_of_birth} onChange={e => updateDemographics('date_of_birth', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Preferred Pronouns</label>
                  <select value={demographics.preferred_pronouns} onChange={e => updateDemographics('preferred_pronouns', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 bg-white">
                    <option value="">Select...</option>
                    <option value="she/her">She/Her</option>
                    <option value="he/him">He/Him</option>
                    <option value="they/them">They/Them</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Phone *</label>
                  <input type="tel" value={demographics.phone} onChange={e => updateDemographics('phone', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input type="email" value={demographics.email} onChange={e => updateDemographics('email', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Street Address</label>
                <input type="text" value={demographics.address} onChange={e => updateDemographics('address', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">City</label>
                  <input type="text" value={demographics.city} onChange={e => updateDemographics('city', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
                  <input type="text" value={demographics.state} onChange={e => updateDemographics('state', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" maxLength={2} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">ZIP</label>
                  <input type="text" value={demographics.zip} onChange={e => updateDemographics('zip', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" maxLength={10} />
                </div>
              </div>

              <div className="pt-2 border-t border-gray-100">
                <p className="text-sm font-medium text-gray-700 mb-3">Emergency Contact</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                    <input type="text" value={demographics.emergency_contact_name} onChange={e => updateDemographics('emergency_contact_name', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                    <input type="tel" value={demographics.emergency_contact_phone} onChange={e => updateDemographics('emergency_contact_phone', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Relationship</label>
                  <input type="text" value={demographics.emergency_contact_relationship} onChange={e => updateDemographics('emergency_contact_relationship', e.target.value)}
                    placeholder="e.g., Spouse, Parent, Friend"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">How did you hear about us?</label>
                <select value={demographics.referral_source} onChange={e => updateDemographics('referral_source', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 bg-white">
                  <option value="">Select...</option>
                  <option value="doctor_referral">Doctor / Medical Referral</option>
                  <option value="insurance">Insurance Provider</option>
                  <option value="friend_family">Friend or Family</option>
                  <option value="online_search">Online Search</option>
                  <option value="social_media">Social Media</option>
                  <option value="psychology_today">Psychology Today</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            <button
              onClick={() => setStep('insurance')}
              disabled={!demographicsValid}
              className="w-full mt-6 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition"
            >
              Next: Insurance â
            </button>
            <button onClick={() => setStep('intro')} className="w-full mt-2 text-gray-400 text-sm py-2">â Back</button>
          </div>
        )}

        {/* âââ Insurance ââââââââââââââââââââââââââââââââââââââââ */}
        {step === 'insurance' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Insurance Information</h2>
            <p className="text-gray-500 text-sm mb-5">We need this to verify your coverage</p>

            {insurance.has_insurance === null ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-700 font-medium">Do you have health insurance?</p>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => updateInsurance('has_insurance', true)}
                    className="py-4 px-4 border-2 border-gray-200 rounded-xl text-sm font-medium hover:border-teal-400 transition text-center">
                    Yes, I have insurance
                  </button>
                  <button onClick={() => updateInsurance('has_insurance', false)}
                    className="py-4 px-4 border-2 border-gray-200 rounded-xl text-sm font-medium hover:border-teal-400 transition text-center">
                    No / Self-pay
                  </button>
                </div>
              </div>
            ) : insurance.has_insurance ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-teal-600 font-medium">Insurance Details</span>
                  <button onClick={() => updateInsurance('has_insurance', null)} className="text-xs text-gray-400 hover:text-gray-600">Change</button>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Insurance Provider *</label>
                  <input type="text" value={insurance.insurance_provider} onChange={e => updateInsurance('insurance_provider', e.target.value)}
                    placeholder="e.g., Blue Cross, Aetna, United"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Policy/Member ID *</label>
                    <input type="text" value={insurance.policy_number} onChange={e => updateInsurance('policy_number', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Group Number</label>
                    <input type="text" value={insurance.group_number} onChange={e => updateInsurance('group_number', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Subscriber Name</label>
                  <input type="text" value={insurance.subscriber_name} onChange={e => updateInsurance('subscriber_name', e.target.value)}
                    placeholder="If different from patient"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Subscriber DOB</label>
                    <input type="date" value={insurance.subscriber_dob} onChange={e => updateInsurance('subscriber_dob', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Relationship</label>
                    <select value={insurance.relationship_to_subscriber} onChange={e => updateInsurance('relationship_to_subscriber', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 bg-white">
                      <option value="self">Self</option>
                      <option value="spouse">Spouse</option>
                      <option value="child">Child</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-gray-600 mb-2">Self-pay / No insurance noted.</p>
                <button onClick={() => updateInsurance('has_insurance', null)} className="text-xs text-teal-500 hover:text-teal-600">Change</button>
              </div>
            )}

            <button
              onClick={() => setStep('phq9')}
              disabled={insurance.has_insurance === null || (insurance.has_insurance && !insurance.insurance_provider)}
              className="w-full mt-6 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition"
            >
              Next: Mental Health Screening â
            </button>
            <button onClick={() => setStep('demographics')} className="w-full mt-2 text-gray-400 text-sm py-2">â Back</button>
          </div>
        )}

        {/* âââ PHQ-9 ââââââââââââââââââââââââââââââââââââââââââââ */}
        {step === 'phq9' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900 mt-2">PHQ-9: Depression Screening</h2>
              <p className="text-gray-500 text-sm">Over the last 2 weeks, how often have you been bothered by the following?</p>
            </div>
            <div className="space-y-6">
              {PHQ9_QUESTIONS.map((q, i) => (
                <div key={i}>
                  <p className="text-gray-700 text-sm font-medium mb-2">{i + 1}. {q}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {FREQUENCY_OPTIONS.map(opt => (
                      <button key={opt.value}
                        onClick={() => { const u = [...phq9Answers]; u[i] = opt.value; setPHQ9Answers(u) }}
                        className={`text-xs py-2 px-3 rounded-lg border transition ${
                          phq9Answers[i] === opt.value
                            ? 'bg-teal-500 text-white border-teal-500'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300'
                        }`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setStep('gad7')} disabled={!allPHQ9Answered}
              className="w-full mt-6 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition">
              Next: Anxiety Screening â
            </button>
            <button onClick={() => setStep('insurance')} className="w-full mt-2 text-gray-400 text-sm py-2">â Back</button>
          </div>
        )}

        {/* âââ GAD-7 ââââââââââââââââââââââââââââââââââââââââââââ */}
        {step === 'gad7' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900 mt-2">GAD-7: Anxiety Screening</h2>
              <p className="text-gray-500 text-sm">Over the last 2 weeks, how often have you been bothered by the following?</p>
            </div>
            <div className="space-y-6">
              {GAD7_QUESTIONS.map((q, i) => (
                <div key={i}>
                  <p className="text-gray-700 text-sm font-medium mb-2">{i + 1}. {q}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {FREQUENCY_OPTIONS.map(opt => (
                      <button key={opt.value}
                        onClick={() => { const u = [...gad7Answers]; u[i] = opt.value; setGAD7Answers(u) }}
                        className={`text-xs py-2 px-3 rounded-lg border transition ${
                          gad7Answers[i] === opt.value
                            ? 'bg-teal-500 text-white border-teal-500'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300'
                        }`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setStep(documents.length > 0 ? 'consent' : 'notes')} disabled={!allGAD7Answered}
              className="w-full mt-6 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition">
              {documents.length > 0 ? 'Next: Consent & Signatures â' : 'Almost done â'}
            </button>
            <button onClick={() => setStep('phq9')} className="w-full mt-2 text-gray-400 text-sm py-2">â Back</button>
          </div>
        )}

        {/* âââ Consent & Signatures âââââââââââââââââââââââââââââ */}
        {step === 'consent' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Consent Forms &amp; Signatures</h2>
            <p className="text-gray-500 text-sm mb-5">Please review and acknowledge each document below</p>

            <div className="space-y-4">
              {documents.map(doc => (
                <div key={doc.id} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-sm font-semibold text-gray-900">{doc.name}</h3>
                    {doc.requires_signature && (
                      <span className="text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full font-medium">Signature required</span>
                    )}
                  </div>
                  {doc.description && <p className="text-xs text-gray-500 mb-3">{doc.description}</p>}

                  {doc.content_url && (
                    <a href={doc.content_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-teal-600 hover:text-teal-700 mb-3">
                      ð View full document
                    </a>
                  )}

                  <label className="flex items-start gap-3 cursor-pointer mt-2">
                    <input type="checkbox" checked={documentAcks[doc.id] || false}
                      onChange={e => setDocumentAcks(a => ({ ...a, [doc.id]: e.target.checked }))}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500" />
                    <span className="text-xs text-gray-600">
                      I have read and agree to the <strong>{doc.name}</strong>
                    </span>
                  </label>

                  {doc.requires_signature && documentAcks[doc.id] && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <SignaturePad
                        label={`Sign for: ${doc.name}`}
                        onSignatureChange={(sig) => setDocumentSignatures(s => ({ ...s, [doc.id]: sig }))}
                      />
                    </div>
                  )}
                </div>
              ))}

              {/* Main consent signature */}
              <div className="border-2 border-teal-200 rounded-xl p-4 bg-teal-50/30">
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Patient Consent Signature</h3>
                <p className="text-xs text-gray-500 mb-4">
                  By signing below, I confirm that all information provided is accurate, I consent to treatment, and I authorize the release of information as described in the documents above.
                </p>
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type your full legal name *</label>
                  <input type="text" value={signedName} onChange={e => setSignedName(e.target.value)}
                    placeholder="e.g., John M. Doe"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 bg-white" />
                </div>
                <SignaturePad label="Draw your signature *" onSignatureChange={setMainSignature} />
              </div>
            </div>

            <button onClick={() => setStep('notes')} disabled={!consentComplete}
              className="w-full mt-6 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition">
              Almost done â
            </button>
            <button onClick={() => setStep('gad7')} className="w-full mt-2 text-gray-400 text-sm py-2">â Back</button>
          </div>
        )}

        {/* âââ Notes & Submit âââââââââââââââââââââââââââââââââââ */}
        {step === 'notes' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Anything else to share?</h2>
            <p className="text-gray-500 text-sm mb-4">Optional: Is there anything specific you want your therapist to know before your appointment?</p>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4}
              placeholder="I've been feeling anxious about work lately..."
              className="w-full border border-gray-200 rounded-xl p-3 text-sm text-gray-700 focus:outline-none focus:border-teal-400 resize-none" />

            {/* If no consent step, show signature here */}
            {documents.length === 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type your full name to sign *</label>
                  <input type="text" value={signedName} onChange={e => setSignedName(e.target.value)}
                    placeholder="e.g., John M. Doe"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                </div>
                <SignaturePad label="Your signature *" onSignatureChange={setMainSignature} />
              </div>
            )}

            <button onClick={handleSubmit}
              disabled={!signedName || !mainSignature}
              className="w-full mt-4 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition">
              Submit Intake Forms â
            </button>
            <button onClick={() => setStep(documents.length > 0 ? 'consent' : 'gad7')} className="w-full mt-2 text-gray-400 text-sm py-2">â Back</button>
          </div>
        )}
      </div>
    </div>
  )
}
