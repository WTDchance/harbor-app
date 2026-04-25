'use client'

import { useEffect, useState } from 'react'
import { Users, Plus, Mail, Phone, Code, Loader } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'

interface TeamMember {
  id: string
  therapist_name: string
  therapist_email: string | null
  therapist_phone: string | null
  vapi_assistant_id: string | null
  specialties: string[]
  is_active: boolean
  created_at: string
}

const SPECIALTIES = ['Anxiety', 'Depression', 'Trauma/PTSD', 'Couples Therapy', 'Family Therapy',
  'Grief & Loss', 'Addiction', 'OCD', 'ADHD', 'Eating Disorders', 'Teen/Adolescent', 'LGBTQ+']

export default function TeamPage() {
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [practice, setPractice] = useState<any>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    therapist_name: '',
    therapist_email: '',
    therapist_phone: '',
    specialties: [] as string[],
  })
  const supabase = createClient()

  useEffect(() => {
    const loadTeam = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      // Resolve practice via server-side endpoint (respects act-as cookie)
      const meRes = await fetch('/api/practice/me')
      const meData = meRes.ok ? await meRes.json() : null
      const practiceData = meData?.practice

      if (practiceData) {
        setPractice(practiceData)

        // Fetch team members
        const response = await fetch(`/api/team?practice_id=${practiceData.id}`)
        if (response.ok) {
          const data = await response.json()
          setMembers(data.members || [])
        }
      }

      setLoading(false)
    }

    loadTeam()
  }, [supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!practice) return

    setSubmitting(true)
    try {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          practice_id: practice.id,
          therapist_name: form.therapist_name,
          therapist_email: form.therapist_email,
          therapist_phone: form.therapist_phone,
          specialties: form.specialties,
        }),
      })

      if (res.ok) {
        const data = await res.json()

        // Refresh members list
        const response = await fetch(`/api/team?practice_id=${practice.id}`)
        if (response.ok) {
          const teamData = await response.json()
          setMembers(teamData.members || [])
        }

        // Reset form
        setForm({
          therapist_name: '',
          therapist_email: '',
          therapist_phone: '',
          specialties: [],
        })
        setShowForm(false)

        alert('Team member added successfully!')
      } else {
        alert('Failed to add team member')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Error adding team member')
    }
    setSubmitting(false)
  }

  const toggleSpecialty = (specialty: string) => {
    setForm(f => ({
      ...f,
      specialties: f.specialties.includes(specialty)
        ? f.specialties.filter(s => s !== specialty)
        : [...f.specialties, specialty]
    }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team Members</h1>
          <p className="text-gray-500 mt-1">Manage therapists and their Ellie assistants</p>
        </div>
        {members.length > 0 && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-teal-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Therapist
          </button>
        )}
      </div>

      {/* Add member form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Add a New Therapist</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Therapist Name</label>
                <input
                  type="text"
                  value={form.therapist_name}
                  onChange={e => setForm(f => ({ ...f, therapist_name: e.target.value }))}
                  placeholder="Dr. Jane Smith"
                  required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={form.therapist_email}
                  onChange={e => setForm(f => ({ ...f, therapist_email: e.target.value }))}
                  placeholder="jane@example.com"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={form.therapist_phone}
                onChange={e => setForm(f => ({ ...f, therapist_phone: e.target.value }))}
                placeholder="+1 (555) 000-0000"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Specialties</label>
              <div className="flex flex-wrap gap-2">
                {SPECIALTIES.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSpecialty(s)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      form.specialties.includes(s)
                        ? 'bg-teal-600 text-white border-teal-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-teal-400'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="flex-1 border border-gray-200 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !form.therapist_name}
                className="flex-1 bg-teal-600 text-white py-2.5 rounded-lg font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    Adding...
                  </>
                ) : (
                  'Add Therapist'
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Team members list */}
      {members.length === 0 && !showForm ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 mb-4">No team members yet</p>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-teal-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add First Therapist
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {members.map(member => (
            <div key={member.id} className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-gray-900">{member.therapist_name}</h3>
              </div>

              {/* Contact info */}
              <div className="space-y-2 mb-4">
                {member.therapist_email && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Mail className="w-4 h-4" />
                    <a href={`mailto:${member.therapist_email}`} className="hover:text-teal-600">
                      {member.therapist_email}
                    </a>
                  </div>
                )}
                {member.therapist_phone && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Phone className="w-4 h-4" />
                    {member.therapist_phone}
                  </div>
                )}
              </div>

              {/* Specialties */}
              {member.specialties && member.specialties.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-gray-500 mb-2">Specialties</p>
                  <div className="flex flex-wrap gap-1">
                    {member.specialties.map(s => (
                      <span key={s} className="bg-teal-100 text-teal-700 text-xs px-2 py-1 rounded">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Vapi ID */}
              {member.vapi_assistant_id && (
                <div className="pt-4 border-t border-gray-100">
                  <div className="flex items-center gap-2 text-xs">
                    <Code className="w-4 h-4 text-gray-400" />
                    <code className="text-gray-500 font-mono">{member.vapi_assistant_id.slice(0, 12)}...</code>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
