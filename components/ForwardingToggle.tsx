'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Loader2, Phone } from 'lucide-react'

interface ForwardingState {
  enabled: boolean
  forwardingNumber: string | null
}

export function ForwardingToggle() {
  const [state, setState] = useState<ForwardingState>({
    enabled: false,
    forwardingNumber: null,
  })
  const [phoneInput, setPhoneInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [showConfirmOff, setShowConfirmOff] = useState(false)

  useEffect(() => {
    fetchForwardingState()
  }, [])

  const fetchForwardingState = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/practices/forwarding')
      if (!response.ok) throw new Error('Failed to fetch forwarding state')

      const data = await response.json()
      setState({
        enabled: data.forwarding_enabled ?? false,
        forwardingNumber: data.call_forwarding_number ?? null,
      })
      setPhoneInput(data.call_forwarding_number ?? '')
    } catch (err) {
      console.error('Error fetching forwarding state:', err)
      setError('Failed to load forwarding settings')
    } finally {
      setLoading(false)
    }
  }

  const formatPhoneNumber = (value: string): string => {
    const cleaned = value.replace(/\D/g, '')
    if (cleaned.length === 0) return ''
    if (cleaned.length <= 3) return cleaned
    if (cleaned.length <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`
  }

  const handlePhoneInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setPhoneInput(formatPhoneNumber(value))
  }

  const validatePhoneNumber = (phone: string): boolean => {
    const cleaned = phone.replace(/\D/g, '')
    return cleaned.length === 10
  }

  const handleToggle = async (newEnabled: boolean) => {
    if (!newEnabled && state.enabled) {
      setShowConfirmOff(true)
      return
    }

    if (newEnabled && !phoneInput.trim()) {
      setError('Please enter a phone number to enable forwarding')
      return
    }

    if (newEnabled && !validatePhoneNumber(phoneInput)) {
      setError('Please enter a valid 10-digit phone number')
      return
    }

    await saveForwardingState(newEnabled, newEnabled ? phoneInput : null)
  }

  const saveForwardingState = async (enabled: boolean, forwardingNumber: string | null) => {
    setSaving(true)
    setError(null)
    setSuccess(false)
    setShowConfirmOff(false)

    try {
      const response = await fetch('/api/practices/forwarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          forwarding_number: enabled ? forwardingNumber?.replace(/\D/g, '').replace(/^(\d{10})$/, '+1$1') : null,
        }),
      })

      if (!response.ok) throw new Error('Failed to save forwarding state')

      const data = await response.json()
      setState({
        enabled: data.forwarding_enabled ?? false,
        forwardingNumber: data.call_forwarding_number ?? null,
      })

      if (!enabled) {
        setPhoneInput('')
      }

      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      console.error('Error saving forwarding state:', err)
      setError('Failed to save settings. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Info Box */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-900">
          When forwarding is on, incoming calls ring your personal phone instead of Ellie.
          Turn it off anytime to let Ellie handle calls again.
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-800">Settings saved successfully!</p>
        </div>
      )}

      {/* Toggle Card */}
      <div className="border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <p className="text-sm text-gray-600">
              {state.enabled ? (
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                  Calls forwarding to {state.forwardingNumber}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  Your AI receptionist is answering your calls
                </span>
              )}
            </p>
          </div>

          {/* Toggle Switch */}
          <button
            onClick={() => handleToggle(!state.enabled)}
            disabled={saving}
            className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              state.enabled
                ? 'bg-orange-500 hover:bg-orange-600'
                : 'bg-gray-300 hover:bg-gray-400'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <span
              className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                state.enabled ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Phone Number Input (shown when enabled) */}
        {state.enabled && (
          <div className="mt-6 pt-6 border-t border-gray-200 space-y-4">
            <label className="block text-sm font-medium text-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <Phone className="w-4 h-4" />
                Forwarding Number
              </div>
            </label>
            <input
              type="tel"
              placeholder="(555) 123-4567"
              value={phoneInput}
              onChange={handlePhoneInputChange}
              disabled={saving}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              maxLength={14}
            />
            <p className="text-xs text-gray-500">
              Enter the phone number where you want calls forwarded (10-digit US number)
            </p>
          </div>
        )}
      </div>

      {/* Confirmation Modal for turning off */}
      {showConfirmOff && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg max-w-sm mx-auto p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Disable Call Forwarding?</h3>
            <p className="text-gray-600 text-sm">
              Turning off forwarding will let Ellie answer all incoming calls again. Are you sure?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirmOff(false)}
                disabled={saving}
                className="px-4 py-2 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Keep Forwarding
              </button>
              <button
                onClick={() => saveForwardingState(false, null)}
                disabled={saving}
                className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Disable Forwarding
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
          }
