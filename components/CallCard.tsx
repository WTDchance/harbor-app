'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Phone } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { CallLog } from '@/types'

interface CallCardProps {
  call: CallLog
}

export function CallCard({ call }: CallCardProps) {
  const [expanded, setExpanded] = useState(false)

  const durationMinutes = Math.floor(call.duration_seconds / 60)
  const durationSeconds = call.duration_seconds % 60

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow">
      {/* Summary */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-start gap-4 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Phone className="w-4 h-4 text-teal-600" />
            <span className="font-mono text-sm text-gray-700">{call.patient_phone}</span>
          </div>
          <p className="text-sm text-gray-600">
            {formatDistanceToNow(new Date(call.created_at), { addSuffix: true })}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Duration: {durationMinutes}m {durationSeconds}s
          </p>
          {call.summary && (
            <p className="text-sm text-gray-700 mt-2 line-clamp-2">{call.summary}</p>
          )}
        </div>

        <div className="flex items-center">
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>

      {/* Expanded transcript */}
      {expanded && call.transcript && (
        <div className="border-t border-gray-200 bg-gray-50 p-4">
          <h4 className="font-semibold text-sm text-gray-900 mb-3">Full Transcript</h4>
          <div className="bg-white rounded p-3 max-h-64 overflow-y-auto">
            <p className="text-sm text-gray-700 whitespace-pre-wrap font-mono text-xs">
              {call.transcript}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
