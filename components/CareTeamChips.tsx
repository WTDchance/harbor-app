'use client'

// Wave 43 / T0 — care team chip-list rendered at the top of the
// patient detail page. Reads the W42 T4 join.

import { useEffect, useState } from 'react'
import { Users, ChevronRight } from 'lucide-react'

interface CareTeamMember {
  id: string
  user_id: string
  user_name: string | null
  user_email: string | null
  role: 'primary_therapist' | 'supervising_psychiatrist' | 'case_manager' | 'intern' | 'consulting_provider'
  active: boolean
}

const ROLE_LABEL: Record<CareTeamMember['role'], string> = {
  primary_therapist: 'Primary therapist',
  supervising_psychiatrist: 'Supervising psychiatrist',
  case_manager: 'Case manager',
  intern: 'Intern',
  consulting_provider: 'Consulting provider',
}

export function CareTeamChips({ patientId }: { patientId: string }) {
  const [members, setMembers] = useState<CareTeamMember[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch(`/api/ehr/patients/${patientId}/care-team`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        const all = Array.isArray(data?.members) ? data.members : []
        setMembers(all.filter((m: CareTeamMember) => m.active))
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [patientId])

  if (!loaded || members.length === 0) return null

  return (
    <div className="flex items-center gap-2 flex-wrap mt-2">
      <Users className="w-3.5 h-3.5 text-gray-400" />
      {members.map((m) => (
        <span
          key={m.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700"
          title={m.user_email ?? undefined}
        >
          <span className="text-gray-500">{ROLE_LABEL[m.role]}:</span>
          <span className="font-medium">{m.user_name ?? '—'}</span>
        </span>
      ))}
    </div>
  )
}
