'use client'

import { useState } from 'react'
import { Save } from 'lucide-react'
import type { Practice } from '@/types'

export default function SettingsPage() {
  // Mock practice data - in a real app, fetch from API
  const [practice, setPractice] = useState<Partial<Practice>>({
    name: 'Hope and Harmony Counseling',
    ai_name: 'Sam',
    phone_number: '+15551234567',
    timezone: 'America/Los_Angeles',
    insurance_accepted: ['Aetna', 'BlueCross', 'Cigna'],
    hours_json: {
      monday: { enabled: true, openTime: '08:00', closeTime: '18:00' },
      tuesday: { enabled: true, openTime: '08:00', closeTime: '18:00' },
      wednesday: { enabled: true, openTime: '10:00', closeTime: '20:00' },
      thursday: { enabled: true, openTime: '08:00', closeTime: '18:00' },
      friday: { enabled: true, openTime: '08:00', closeTime: '17:00' },
      saturday: { enabled: true, openTime: '09:00', closeTime: '13:00' },
      sunday: { enabled: false },
    },
  })
  const [saving, setSaving] = useState(false)

  const insuranceOptions = [
    'Aetna',
    'BlueCross',
    'Cigna',
    'United Healthcare',
    'Humana',
    'Medicare',
    'Medicaid',
  ]

  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  const dayLabels: Record<string, string> = {
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday',
    sunday: 'Sunday',
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      // In a real app, call the API
      // const response = await fetch(`/api/practices?id=${practice.id}`, {
      //   method: 'PATCH',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(practice),
      // })
      await new Promise((resolve) => setTimeout(resolve, 1000))
      alert('Settings saved!')
    } catch (error) {
      console.error('Error saving settings:', error)
      alert('Error saving settings')
    } finally {
      setSaving(false)
    }
  }

  const toggleDay = (day: string) => {
    const hours = practice.hours_json || {}
    setPractice({
      ...practice,
      hours_json: {
        ...hours,
        [day]: {
          ...hours[day as keyof typeof hours],
          enabled: !hours[day as keyof typeof hours]?.enabled,
        },
      },
    })
  }

  const updateTime = (day: string, field: 'openTime' | 'closeTime', value: string) => {
    const hours = practice.hours_json || {}
    setPractice({
      ...practice,
      hours_json: {
        ...hours,
        [day]: {
          ...hours[day as keyof typeof hours],
          [field]: value,
        },
      },
    })
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-2">Configure your practice and AI receptionist</p>
      </div>

      {/* Practice basics */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Practice Information</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Practice Name</label>
            <input
              type="text"
              value={practice.name || ''}
              onChange={(e) => setPractice({ ...practice, name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-600 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              AI Receptionist Name
            </label>
            <input
              type="text"
              value={practice.ai_name || ''}
              onChange={(e) => setPractice({ ...practice, ai_name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-600 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number</label>
            <input
              type="tel"
              value={practice.phone_number || ''}
              disabled
              className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-600 cursor-not-allowed"
            />
            <p className="text-xs text-gray-500 mt-1">Contact support to change phone number</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Timezone</label>
            <select
              value={practice.timezone || 'America/Los_Angeles'}
              onChange={(e) => setPractice({ ...practice, timezone: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-600 focus:border-transparent"
            >
              <option>America/Los_Angeles</option>
              <option>America/Denver</option>
              <option>America/Chicago</option>
              <option>America/New_York</option>
            </select>
          </div>
        </div>
      </div>

      {/* Business hours */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Business Hours</h2>

        <div className="space-y-4">
          {days.map((day) => {
            const dayHours = practice.hours_json?.[day as keyof typeof practice.hours_json]
            const enabled = dayHours?.enabled ?? false

            return (
              <div key={day} className="flex items-center gap-4">
                <label className="flex items-center gap-2 w-32">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleDay(day)}
                    className="w-4 h-4 text-teal-600 rounded"
                  />
                  <span className="text-sm font-medium text-gray-700">{dayLabels[day]}</span>
                </label>

                {enabled && (
                  <>
                    <div className="flex-1">
                      <label className="text-xs text-gray-600">Opens</label>
                      <input
                        type="time"
                        value={dayHours?.openTime || '09:00'}
                        onChange={(e) => updateTime(day, 'openTime', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-600">Closes</label>
                      <input
                        type="time"
                        value={dayHours?.closeTime || '17:00'}
                        onChange={(e) => updateTime(day, 'closeTime', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                      />
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Insurance plans */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Insurance Accepted</h2>

        <div className="space-y-2">
          {insuranceOptions.map((plan) => (
            <label key={plan} className="flex items-center">
              <input
                type="checkbox"
                checked={practice.insurance_accepted?.includes(plan) ?? false}
                onChange={(e) => {
                  if (e.target.checked) {
                    setPractice({
                      ...practice,
                      insurance_accepted: [...(practice.insurance_accepted || []), plan],
                    })
                  } else {
                    setPractice({
                      ...practice,
                      insurance_accepted: practice.insurance_accepted?.filter((p) => p !== plan),
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

      {/* Save button */}
      <div className="flex justify-end gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-teal-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}
