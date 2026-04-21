'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'

// ─── Constants ──────────────────────────────────────────────────────────
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

type Step = 'loading' | 'intro' | 'demographics' | 'insurance' | 'presenting_concerns' | 'medications' | 'medical_history' | 'prior_therapy' | 'substance_use' | 'family_history' | 'phq9' | 'gad7' | 'consent' | 'notes' | 'submitting' | 'done' | 'error'

type IntakeConfig = Record<string, boolean>

const DEFAULT_CONFIG: IntakeConfig = {
  demographics: true, insurance: true, presenting_concerns: true,
  medications: true, medical_history: true, prior_therapy: true,
  substance_use: true, family_history: false, phq9: true, gad7: true,
  consent: true, additional_notes: true,
}

type PresentingConcerns = {
  primary_concern: string
  goals: string
  symptom_duration: string
  coping_strategies: string
  current_risk: string
}

type MedicationEntry = { name: string; dosage: string; prescriber: string; duration: string }

type MedicalHistory = {
  current_conditions: string
  past_surgeries: string
  allergies: string
  primary_care_physician: string
  pcp_phone: string
}

type PriorTherapy = {
  has_prior: boolean | null
  details: string
  what_helped: string
  what_didnt: string
  hospitalization_history: string
}

type SubstanceUse = {
  alcohol: string
  tobacco: string
  cannabis: string
  other: string
  concerns: string
}

type FamilyHistory = {
  conditions: string
  details: string
}

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

// ─── Signature Pad Component ────────────────────────────────────────────
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

// ─── Progress Bar ───────────────────────────────────────────────────────
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

// ─── Main Page ──────────────────────────────────────────────────────────
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
  const [config, setConfig] = useState<IntakeConfig>(DEFAULT_CONFIG)

  // New section states
  const [presentingConcerns, setPresentingConcerns] = useState<PresentingConcerns>({
    primary_concern: '', goals: '', symptom_duration: '', coping_strategies: '', current_risk: ''
  })
  const [medications, setMedications] = useState<MedicationEntry[]>([])
  const [noMedications, setNoMedications] = useState(false)
  const [medicalHistory, setMedicalHistory] = useState<MedicalHistory>({
    current_conditions: '', past_surgeries: '', allergies: '', primary_care_physician: '', pcp_phone: ''
  })
  const [priorTherapy, setPriorTherapy] = useState<PriorTherapy>({
    has_prior: null, details: '', what_helped: '', what_didnt: '', hospitalization_history: ''
  })
  const [substanceUse, setSubstanceUse] = useState<SubstanceUse>({
    alcohol: 'none', tobacco: 'none', cannabis: 'none', other: '', concerns: ''
  })
  const [familyHistory, setFamilyHistory] = useState<FamilyHistory>({
    conditions: '', details: ''
  })

  const [demographics, setDemographics] = useState<Demographics>({
    first_name: '', last_name: '', date_of_birth: '', phone: '', email: '',
    address: '', city: '', state: '', zip: '',
    emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relationship: '',
    preferred_pronouns: '', referral_source: '',
    sms_consent: false
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
          if (data.intake_config) setConfig(prev => ({ ...prev, ...data.intake_config }))
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

  // Build dynamic step order based on practice config
  const steps: Step[] = ['intro']
  if (config.demographics) steps.push('demographics')
  if (config.insurance) steps.push('insurance')
  if (config.presenting_concerns) steps.push('presenting_concerns')
  if (config.medications) steps.push('medications')
  if (config.medical_history) steps.push('medical_history')
  if (config.prior_therapy) steps.push('prior_therapy')
  if (config.substance_use) steps.push('substance_use')
  if (config.family_history) steps.push('family_history')
  if (config.phq9) steps.push('phq9')
  if (config.gad7) steps.push('gad7')
  if (config.consent && documents.length > 0) steps.push('consent')
  if (config.additional_notes) steps.push('notes')

  const currentStepIndex = steps.indexOf(step)
  const totalSteps = steps.length - 1 // exclude intro

  const nextStep = () => {
    const idx = steps.indexOf(step)
    if (idx < steps.length - 1) setStep(steps[idx + 1])
  }
  const prevStep = () => {
    const idx = steps.indexOf(step)
    if (idx > 0) setStep(steps[idx - 1])
  }
  const getNextLabel = (): string => {
    const idx = steps.indexOf(step)
    const next = steps[idx + 1]
    const labels: Record<string, string> = {
      demographics: 'Personal Info', insurance: 'Insurance', presenting_concerns: 'Therapy Goals',
      medications: 'Medications', medical_history: 'Medical History', prior_therapy: 'Prior Treatment',
      substance_use: 'Substance Use', family_history: 'Family History',
      phq9: 'Depression Screening', gad7: 'Anxiety Screening', consent: 'Consent & Signatures', notes: 'Final Notes',
    }
    return labels[next] || 'Next'
  }

  async function handleSubmit() {
    setStep('submitting')
    try {
      const res = await fetch('/api/intake/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          phq9_answers: config.phq9 ? phq9Answers : null,
          gad7_answers: config.gad7 ? gad7Answers : null,
          additional_notes: notes || null,
          demographics: config.demographics ? demographics : null,
          insurance: config.insurance ? insurance : null,
          presenting_concerns: config.presenting_concerns ? presentingConcerns : null,
          medications: config.medications ? (noMedications ? { none: true } : { list: medications }) : null,
          medical_history: config.medical_history ? medicalHistory : null,
          prior_therapy: config.prior_therapy ? priorTherapy : null,
          substance_use: config.substance_use ? substanceUse : null,
          family_history: config.family_history ? familyHistory : null,
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

  // ─── Render States ──────────────────────────────────────────────────
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

        {/* ─── Intro ──────────────────────────────────────────── */}
        {step === 'intro' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-3">{greeting} 👋</h2>
            <p className="text-gray-600 mb-4">
              {practiceLabel} has sent you an intake packet to complete before your first appointment. This helps your therapist prepare for your session.
            </p>
            <div className="bg-teal-50 rounded-xl p-4 mb-6">
              <p className="text-teal-800 text-sm font-medium mb-2">You will complete:</p>
              <ul className="text-teal-700 text-sm space-y-1.5">
                {config.demographics && <li className="flex items-center gap-2"><span className="text-teal-500">📋</span> Personal information</li>}
                {config.insurance && <li className="flex items-center gap-2"><span className="text-teal-500">🏥</span> Insurance details</li>}
                {config.presenting_concerns && <li className="flex items-center gap-2"><span className="text-teal-500">💬</span> Reason for seeking therapy</li>}
                {(config.medications || config.medical_history) && <li className="flex items-center gap-2"><span className="text-teal-500">💊</span> Medical &amp; medication history</li>}
                {config.prior_therapy && <li className="flex items-center gap-2"><span className="text-teal-500">🧠</span> Prior mental health treatment</li>}
                {(config.phq9 || config.gad7) && <li className="flex items-center gap-2"><span className="text-teal-500">📊</span> Mental health screenings</li>}
                {documents.length > 0 && <li className="flex items-center gap-2"><span className="text-teal-500">📝</span> Consent forms &amp; e-signatures</li>}
              </ul>
              <p className="text-teal-600 text-xs mt-3">Takes about {steps.length > 8 ? '10–15' : '5–10'} minutes</p>
            </div>
            <button
              onClick={() => setStep('demographics')}
              className="w-full bg-teal-500 hover:bg-teal-600 text-white font-semibold py-3 rounded-xl transition"
            >
              Get Started →
            </button>
          </div>
        )}

        {/* ─── Demographics ───────────────────────────────────── */}
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

              
          {/* SMS Consent — covers TCPA + HIPAA minimum-necessary risk disclosure.
              Version string is persisted on the patient record when this box is
              checked, so future wording changes don't orphan past consent. */}
          <div className="mt-6 p-4 border border-gray-200 rounded-lg bg-gray-50">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={demographics.sms_consent}
                onChange={e => setDemographics(d => ({ ...d, sms_consent: e.target.checked }))}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-gray-700">
                <strong>SMS consent (optional).</strong> I agree to receive text messages from this practice
                about my care — including appointment reminders, confirmations, cancellations, intake forms,
                and scheduling follow-ups. These messages may include limited identifying details such as my
                name, the therapist&rsquo;s name, and my appointment date/time.
                <br /><br />
                <strong>I understand that standard SMS is not end-to-end encrypted</strong> and
                could potentially be seen by someone with access to my phone or mobile carrier. I accept
                this risk. Message frequency varies based on my appointments. Message and data rates may apply.
                Reply <strong>STOP</strong> to opt out at any time. Reply <strong>HELP</strong> for help.
                View our <a href="/privacy-policy" target="_blank" className="text-teal-600 underline">Privacy Policy</a> and{' '}
                <a href="/sms" target="_blank" className="text-teal-600 underline">SMS Terms</a>.
              </span>
            </label>
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

            <button onClick={nextStep} disabled={!demographicsValid}
              className="w-full mt-6 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition">
              Next: {getNextLabel()} →
            </button>
            <button onClick={prevStep} className="w-full mt-2 text-gray-400 text-sm py-2">← Back</button>
          </div>
        )}

        {/* ─── Insurance ──────────────────────────────────────── */}
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

            <button onClick={nextStep}
              disabled={insurance.has_insurance === null || (insurance.has_insurance && !insurance.insurance_provider)}
              className="w-full mt-6 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition">
              Next: {getNextLabel()} →
            </button>
            <button onClick={prevStep} className="w-full mt-2 text-gray-400 text-sm py-2">← Back</button>
          </div>
        )}

        {/* ─── Presenting Concerns ────────────────────────────── */}
        {step === 'presenting_concerns' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Reason for Seeking Therapy</h2>
            <p className="text-gray-500 text-sm mb-5">Help your therapist understand what brings you in</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">What are your primary concerns? *</label>
                <textarea value={presentingConcerns.primary_concern} onChange={e => setPresentingConcerns(p => ({ ...p, primary_concern: e.target.value }))}
                  rows={3} placeholder="e.g., I've been struggling with anxiety at work and difficulty sleeping..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">What are your goals for therapy?</label>
                <textarea value={presentingConcerns.goals} onChange={e => setPresentingConcerns(p => ({ ...p, goals: e.target.value }))}
                  rows={2} placeholder="e.g., Better manage my stress, improve relationships, develop coping strategies..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">How long have you been experiencing these concerns?</label>
                <select value={presentingConcerns.symptom_duration} onChange={e => setPresentingConcerns(p => ({ ...p, symptom_duration: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 bg-white">
                  <option value="">Select...</option>
                  <option value="less_than_month">Less than a month</option>
                  <option value="1_3_months">1–3 months</option>
                  <option value="3_6_months">3–6 months</option>
                  <option value="6_12_months">6–12 months</option>
                  <option value="1_2_years">1–2 years</option>
                  <option value="more_than_2_years">More than 2 years</option>
                  <option value="lifelong">As long as I can remember</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">What coping strategies have you tried?</label>
                <textarea value={presentingConcerns.coping_strategies} onChange={e => setPresentingConcerns(p => ({ ...p, coping_strategies: e.target.value }))}
                  rows={2} placeholder="e.g., Exercise, meditation, talking to friends..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Are you currently experiencing thoughts of harming yourself or others?</label>
                <select value={presentingConcerns.current_risk} onChange={e => setPresentingConcerns(p => ({ ...p, current_risk: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 bg-white">
                  <option value="">Select...</option>
                  <option value="no">No</option>
                  <option value="passive">Sometimes I have passing thoughts but no plan or intent</option>
                  <option value="yes">Yes — I would like to discuss this with my therapist</option>
                </select>
                {presentingConcerns.current_risk === 'yes' && (
                  <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-xs text-red-700 font-medium">If you are in immediate danger, please call 988 (Suicide & Crisis Lifeline) or 911.</p>
                  </div>
                )}
              </div>
            </div>
            <button onClick={nextStep} disabled={!presentingConcerns.primary_concern.trim()}
              className="w-full mt-6 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition">
              Next: {getNextLabel()} →
            </button>
            <button onClick={prevStep} className="w-full mt-2 text-gray-400 text-sm py-2">← Back</button>
          </div>
        )}

        {/* ─── Medications ───────────────────────────────────── */}
        {step === 'medications' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Current Medications</h2>
            <p className="text-gray-500 text-sm mb-5">List any medications you are currently taking</p>

            <label className="flex items-center gap-3 mb-4 cursor-pointer">
              <input type="checkbox" checked={noMedications} onChange={e => { setNoMedications(e.target.checked); if (e.target.checked) setMedications([]) }}
                className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500" />
              <span className="text-sm text-gray-700">I am not currently taking any medications</span>
            </label>

            {!noMedications && (
              <div className="space-y-3">
                {medications.map((med, i) => (
                  <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-medium text-gray-500">Medication {i + 1}</span>
                      <button onClick={() => setMedications(m => m.filter((_, j) => j !== i))} className="text-xs text-red-400 hover:text-red-600">Remove</button>
                    </div>
                    <input type="text" value={med.name} onChange={e => { const u = [...medications]; u[i] = { ...u[i], name: e.target.value }; setMedications(u) }}
                      placeholder="Medication name" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400" />
                    <div className="grid grid-cols-3 gap-2">
                      <input type="text" value={med.dosage} onChange={e => { const u = [...medications]; u[i] = { ...u[i], dosage: e.target.value }; setMedications(u) }}
                        placeholder="Dosage" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400" />
                      <input type="text" value={med.prescriber} onChange={e => { const u = [...medications]; u[i] = { ...u[i], prescriber: e.target.value }; setMedications(u) }}
                        placeholder="Prescriber" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400" />
                      <input type="text" value={med.duration} onChange={e => { const u = [...medications]; u[i] = { ...u[i], duration: e.target.value }; setMedications(u) }}
                        placeholder="How long?" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400" />
                    </div>
                  </div>
                ))}
                <button onClick={() => setMedications(m => [...m, { name: '', dosage: '', prescriber: '', duration: '' }])}
                  className="w-full py-2 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-500 hover:border-teal-300 hover:text-teal-600 transition">
                  + Add Medication
                </button>
              </div>
            )}

            <button onClick={nextStep}
              disabled={!noMedications && medications.length === 0}
              className="w-full mt-6 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition">
              Next: {getNextLabel()} →
            </button>
            <button onClick={prevStep} className="w-full mt-2 text-gray-400 text-sm py-2">← Back</button>
          </div>
        )}

        {/* ─── Medical History ────────────────────────────────── */}
        {step === 'medical_history' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Medical History</h2>
            <p className="text-gray-500 text-sm mb-5">This helps your therapist understand your overall health</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Current medical conditions</label>
                <textarea value={medicalHistory.current_conditions} onChange={e => setMedicalHistory(h => ({ ...h, current_conditions: e.target.value }))}
                  rows={2} placeholder="e.g., Diabetes, high blood pressure, thyroid condition, chronic pain..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Past surgeries or hospitalizations</label>
                <textarea value={medicalHistory.past_surgeries} onChange={e => setMedicalHistory(h => ({ ...h, past_surgeries: e.target.value }))}
                  rows={2} placeholder="e.g., Appendectomy 2019, none..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Allergies (medications, food, environmental)</label>
                <input type="text" value={medicalHistory.allergies} onChange={e => setMedicalHistory(h => ({ ...h, allergies: e.target.value }))}
                  placeholder="e.g., Penicillin, peanuts, none known"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Primary care physician</label>
                  <input type="text" value={medicalHistory.primary_care_physician} onChange={e => setMedicalHistory(h => ({ ...h, primary_care_physician: e.target.value }))}
                    placeholder="Dr. Name" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">PCP phone number</label>
                  <input type="tel" value={medicalHistory.pcp_phone} onChange={e => setMedicalHistory(h => ({ ...h, pcp_phone: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                </div>
              </div>
            </div>
            <button onClick={nextStep}
              className="w-full mt-6 bg-teal-500 hover:bg-teal-600 text-white font-semibold py-3 rounded-xl transition">
              Next: {getNextLabel()} →
            </button>
            <button onClick={prevStep} className="w-full mt-2 text-gray-400 text-sm py-2">← Back</button>
          </div>
        )}

        {/* ─── Prior Therapy ──────────────────────────────────── */}
        {step === 'prior_therapy' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Prior Mental Health Treatment</h2>
            <p className="text-gray-500 text-sm mb-5">Have you seen a therapist, psychiatrist, or counselor before?</p>

            {priorTherapy.has_prior === null ? (
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setPriorTherapy(p => ({ ...p, has_prior: true }))}
                  className="py-4 border-2 border-gray-200 rounded-xl text-sm font-medium hover:border-teal-400 transition">Yes</button>
                <button onClick={() => setPriorTherapy(p => ({ ...p, has_prior: false }))}
                  className="py-4 border-2 border-gray-200 rounded-xl text-sm font-medium hover:border-teal-400 transition">No, this is my first time</button>
              </div>
            ) : priorTherapy.has_prior ? (
              <div className="space-y-4">
                <div className="flex justify-end"><button onClick={() => setPriorTherapy(p => ({ ...p, has_prior: null }))} className="text-xs text-gray-400 hover:text-gray-600">Change</button></div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Previous therapists/psychiatrists and approximate dates</label>
                  <textarea value={priorTherapy.details} onChange={e => setPriorTherapy(p => ({ ...p, details: e.target.value }))}
                    rows={2} placeholder="e.g., Dr. Smith, CBT, 2022-2023..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 resize-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">What was helpful?</label>
                  <textarea value={priorTherapy.what_helped} onChange={e => setPriorTherapy(p => ({ ...p, what_helped: e.target.value }))}
                    rows={2} placeholder="e.g., Learning CBT techniques for managing anxiety..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 resize-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">What wasn&apos;t helpful or reasons for leaving?</label>
                  <textarea value={priorTherapy.what_didnt} onChange={e => setPriorTherapy(p => ({ ...p, what_didnt: e.target.value }))}
                    rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 resize-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Any psychiatric hospitalizations?</label>
                  <textarea value={priorTherapy.hospitalization_history} onChange={e => setPriorTherapy(p => ({ ...p, hospitalization_history: e.target.value }))}
                    rows={1} placeholder="e.g., None, or describe briefly..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 resize-none" />
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-gray-600 mb-2">No prior mental health treatment noted.</p>
                <button onClick={() => setPriorTherapy(p => ({ ...p, has_prior: null }))} className="text-xs text-teal-500">Change</button>
              </div>
            )}

            <button onClick={nextStep} disabled={priorTherapy.has_prior === null}
              className="w-full mt-6 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition">
              Next: {getNextLabel()} →
            </button>
            <button onClick={prevStep} className="w-full mt-2 text-gray-400 text-sm py-2">← Back</button>
          </div>
        )}

        {/* ─── Substance Use ──────────────────────────────────── */}
        {step === 'substance_use' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Substance Use</h2>
            <p className="text-gray-500 text-sm mb-5">This information is confidential and helps your therapist provide the best care</p>
            <div className="space-y-4">
              {[
                { key: 'alcohol' as const, label: 'Alcohol use' },
                { key: 'tobacco' as const, label: 'Tobacco/nicotine use' },
                { key: 'cannabis' as const, label: 'Cannabis/marijuana use' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <select value={substanceUse[key]} onChange={e => setSubstanceUse(s => ({ ...s, [key]: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 bg-white">
                    <option value="none">None</option>
                    <option value="rarely">Rarely (a few times a year)</option>
                    <option value="occasionally">Occasionally (1–2 times a month)</option>
                    <option value="weekly">Weekly</option>
                    <option value="daily">Daily or almost daily</option>
                  </select>
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Other substances (if applicable)</label>
                <input type="text" value={substanceUse.other} onChange={e => setSubstanceUse(s => ({ ...s, other: e.target.value }))}
                  placeholder="e.g., prescription misuse, recreational drugs..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Any concerns about your substance use?</label>
                <textarea value={substanceUse.concerns} onChange={e => setSubstanceUse(s => ({ ...s, concerns: e.target.value }))}
                  rows={2} placeholder="Optional"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 resize-none" />
              </div>
            </div>
            <button onClick={nextStep}
              className="w-full mt-6 bg-teal-500 hover:bg-teal-600 text-white font-semibold py-3 rounded-xl transition">
              Next: {getNextLabel()} →
            </button>
            <button onClick={prevStep} className="w-full mt-2 text-gray-400 text-sm py-2">← Back</button>
          </div>
        )}

        {/* ─── Family History ─────────────────────────────────── */}
        {step === 'family_history' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Family Mental Health History</h2>
            <p className="text-gray-500 text-sm mb-5">Is there a history of mental health conditions in your immediate family?</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Known conditions in family (check all that apply or describe)</label>
                <textarea value={familyHistory.conditions} onChange={e => setFamilyHistory(f => ({ ...f, conditions: e.target.value }))}
                  rows={2} placeholder="e.g., Depression (mother), Substance abuse (father), Anxiety (sibling), None known..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Any additional details?</label>
                <textarea value={familyHistory.details} onChange={e => setFamilyHistory(f => ({ ...f, details: e.target.value }))}
                  rows={2} placeholder="Optional"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 resize-none" />
              </div>
            </div>
            <button onClick={nextStep}
              className="w-full mt-6 bg-teal-500 hover:bg-teal-600 text-white font-semibold py-3 rounded-xl transition">
              Next: {getNextLabel()} →
            </button>
            <button onClick={prevStep} className="w-full mt-2 text-gray-400 text-sm py-2">← Back</button>
          </div>
        )}

        {/* ─── PHQ-9 ──────────────────────────────────────────── */}
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
            <button onClick={nextStep} disabled={!allPHQ9Answered}
              className="w-full mt-6 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition">
              Next: {getNextLabel()} →
            </button>
            <button onClick={prevStep} className="w-full mt-2 text-gray-400 text-sm py-2">← Back</button>
          </div>
        )}

        {/* ─── GAD-7 ──────────────────────────────────────────── */}
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
            <button onClick={nextStep} disabled={!allGAD7Answered}
              className="w-full mt-6 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition">
              Next: {getNextLabel()} →
            </button>
            <button onClick={prevStep} className="w-full mt-2 text-gray-400 text-sm py-2">← Back</button>
          </div>
        )}

        {/* ─── Consent & Signatures ───────────────────────────── */}
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
                      📄 View full document
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

            <button onClick={nextStep} disabled={!consentComplete}
              className="w-full mt-6 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition">
              Almost done →
            </button>
            <button onClick={prevStep} className="w-full mt-2 text-gray-400 text-sm py-2">← Back</button>
          </div>
        )}

        {/* ─── Notes & Submit ─────────────────────────────────── */}
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
              Submit Intake Forms ✓
            </button>
            <button onClick={prevStep} className="w-full mt-2 text-gray-400 text-sm py-2">← Back</button>
          </div>
        )}
      </div>
    </div>
  )
}
