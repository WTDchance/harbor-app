'use client'

import { useEffect, useState } from 'react'
import { TrendingUp, Plus, Send, Copy, X, ChevronDown, CheckCircle, Clock, AlertCircle } from 'lucide-react'

type Assessment = {
  id: string
  patient_name: string
  patient_phone: string
  assessment_type: string
  token: string
  status: string
  score: number | null
  severity: string | null
  completed_at: string | null
  created_at: string
}

const ASSESSMENT_TYPES = [
  { value: 'phq9', label: 'PHQ-9 (Depression)' },
  { value: 'gad7', label: 'GAD-7 (Anxiety)' },
  { value: 'pcl5', label: 'PCL-5 (PTSD)' },
  { value: 'audit', label: 'AUDIT (Alcohol Use)' },
]

function getSeverityColor(severity: string | null) {
  if (!severity) return 'text-slate-400'
  const s = severity.toLowerCase()
  if (s.includes('minimal') || s.includes('none')) return 'text-green-400'
  if (s.includes('mild')) return 'text-yellow-400'
  if (s.includes('moderate')) return 'text-orange-400'
  if (s.includes('severe')) return 'text-red-400'
  return 'text-slate-400'
}

export default function OutcomesPage() {
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [loading, setLoading] = useState(true)
  const [showSendModal, setShowSendModal] = useState(false)
  const [sendForm, setSendForm] = useState({ patient_name: '', patient_phone: '', assessment_type: 'phq9' })
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all')

  useEffect(() => {
    fetchAssessments()
  }, [])

  async function fetchAssessments() {
    try {
      const res = await fetch('/api/assessments')
      if (res.ok) {
        const data = await res.json()
        setAssessments(data.assessments || [])
      }
    } catch {
      // silently fail — show empty state
    } finally {
      setLoading(false)
    }
  }

  async function sendAssessment() {
    setSending(true)
    setSendError('')
    try {
      const res = await fetch('/api/assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sendForm),
      })
      const data = await res.json()
      if (data.error) {
        setSendError(data.error)
        setSending(false)
        return
      }
      setAssessments((prev) => [data.assessment, ...prev])
      setShowSendModal(false)
      setSendForm({ patient_name: '', patient_phone: '', assessment_type: 'phq9' })
    } catch {
      setSendError('Failed to send assessment. Please try again.')
    } finally {
      setSending(false)
    }
  }

  function copyLink(assessment: Assessment) {
    const url = `${window.location.origin}/assessment/${assessment.token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(assessment.id)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  const filtered = assessments
    .filter((a) => {
      if (filter === 'pending') return a.status === 'pending' || a.status === 'sent'
      if (filter === 'completed') return a.status === 'completed'
      return true
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const completedCount = assessments.filter((a) => a.status === 'completed').length
  const pendingCount = assessments.filter((a) => a.status !== 'completed').length

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">Outcome Tracking</h1>
          <p className="text-slate-400 text-sm mt-1">Send and track patient assessments</p>
        </div>
        <button
          onClick={() => setShowSendModal(true)}
          className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Send Assessment
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <div className="text-slate-400 text-sm mb-1">Total Sent</div>
          <div className="text-white text-2xl font-bold">{assessments.length}</div>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <div className="text-slate-400 text-sm mb-1">Completed</div>
          <div className="text-green-400 text-2xl font-bold">{completedCount}</div>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <div className="text-slate-400 text-sm mb-1">Awaiting Response</div>
          <div className="text-yellow-400 text-2xl font-bold">{pendingCount}</div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {(['all', 'pending', 'completed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-yellow-400 text-slate-900'
                : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-500">Loading assessments...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <TrendingUp className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 text-lg font-medium">No assessments yet</p>
          <p className="text-slate-500 text-sm mt-1">
            Send your first assessment to start tracking patient outcomes.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((assessment) => (
            <div
              key={assessment.id}
              className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex items-center justify-between"
            >
              <div className="flex items-start gap-4">
                <div className="mt-0.5">
                  {assessment.status === 'completed' ? (
                    <CheckCircle className="w-5 h-5 text-green-400" />
                  ) : (
                    <Clock className="w-5 h-5 text-yellow-400" />
                  )}
                </div>
                <div>
                  <div className="text-white font-medium">{assessment.patient_name}</div>
                  <div className="text-slate-400 text-sm">{assessment.patient_phone}</div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-slate-500 text-xs">
                      {ASSESSMENT_TYPES.find((t) => t.value === assessment.assessment_type)?.label || assessment.assessment_type}
                    </span>
                    <span className="text-slate-600 text-xs">
                      {new Date(assessment.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {assessment.status === 'completed' && assessment.score !== null && (
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-slate-400 text-sm">Score: <span className="text-white font-medium">{assessment.score}</span></span>
                      {assessment.severity && (
                        <span className={`text-sm font-medium ${getSeverityColor(assessment.severity)}`}>
                          {assessment.severity}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {assessment.status !== 'completed' && (
                  <button
                    onClick={() => copyLink(assessment)}
                    className="flex items-center gap-1 text-slate-400 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-slate-700 transition-colors"
                    title="Copy assessment link"
                  >
                    {copiedId === assessment.id ? (
                      <><CheckCircle className="w-4 h-4 text-green-400" /><span className="text-green-400">Copied!</span></>
                    ) : (
                      <><Copy className="w-4 h-4" /><span>Copy link</span></>
                    )}
                  </button>
                )}
                <span className={`text-xs px-2 py-1 rounded-full ${
                  assessment.status === 'completed'
                    ? 'bg-green-900/40 text-green-400'
                    : 'bg-yellow-900/40 text-yellow-400'
                }`}>
                  {assessment.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showSendModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white text-xl font-bold">Send Assessment</h2>
              <button onClick={() => setShowSendModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {sendError && (
              <div className="bg-red-900/30 border border-red-700 text-red-400 text-sm rounded-lg px-4 py-3 mb-4">
                {sendError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Patient Name</label>
                <input
                  type="text"
                  value={sendForm.patient_name}
                  onChange={(e) => setSendForm((f) => ({ ...f, patient_name: e.target.value }))}
                  placeholder="Jane Smith"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Patient Phone</label>
                <input
                  type="tel"
                  value={sendForm.patient_phone}
                  onChange={(e) => setSendForm((f) => ({ ...f, patient_phone: e.target.value }))}
                  placeholder="(555) 123-4567"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Assessment Type</label>
                <select
                  value={sendForm.assessment_type}
                  onChange={(e) => setSendForm((f) => ({ ...f, assessment_type: e.target.value }))}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-yellow-400 transition-colors"
                >
                  {ASSESSMENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowSendModal(false)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-medium py-3 px-6 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={sendAssessment}
                disabled={sending || !sendForm.patient_name || !sendForm.patient_phone}
                className="flex-1 bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-slate-900 font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {sending ? 'Sending...' : <><Send className="w-4 h-4" /> Send via SMS</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
