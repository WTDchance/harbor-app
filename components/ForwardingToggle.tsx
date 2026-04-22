'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Loader2, Phone } from 'lucide-react'

interface RoutingState {
  forwardingEnabled: boolean
  transferEnabled: boolean
  forwardingNumber: string | null
}

export function ForwardingToggle() {
  const [state, setState] = useState<RoutingState>({
    forwardingEnabled: false,
    transferEnabled: false,
    forwardingNumber: null,
  })
  const [phoneInput, setPhoneInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [showConfirmOff, setShowConfirmOff] = useState(false)

  useEffect(() => {
    fetchRoutingState()
  }, [])

  const fetchRoutingState = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/practices/forwarding')
      if (!response.ok) throw new Error('Failed to fetch routing state')

      const data = await response.json()
      setState({
        forwardingEnabled: data.forwarding_enabled ?? false,
        transferEnabled: data.transfer_enabled ?? false,
        forwardingNumber: data.call_forwarding_number ?? null,
      })
      setPhoneInput(formatFromStoredNumber(data.call_forwarding_number))
    } catch (err) {
      console.error('Error fetching routing state:', err)
      setError('Failed to load routing settings')
    } finally {
      setLoading(false)
    }
  }

  // When the server returns `+15551234567`, display it as `(555) 123-4567`.
  const formatFromStoredNumber = (stored: string | null | undefined): string => {
    if (!stored) return ''
    const digits = stored.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
    return formatPhoneNumber(digits)
  }

  const formatPhoneNumber = (value: string): string => {
    const cleaned = value.replace(/\D/g, '')
    if (cleaned.length === 0) return ''
    if (cleaned.length <= 3) return cleaned
    if (cleaned.length <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`
  }

  const handlePhoneInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhoneInput(formatPhoneNumber(e.target.value))
  }

  const validatePhoneNumber = (phone: string): boolean => {
    return phone.replace(/\D/g, '').length === 10
  }

  const toE164 = (phone: string | null): string | null => {
    if (!phone) return null
    const digits = phone.replace(/\D/g, '')
    if (digits.length !== 10) return null
    return `+1${digits}`
  }

  // Forwarding toggle: the big one. Redirects all calls at Twilio level,
  // bypassing Ellie entirely. Requires a valid 10-digit number.
  const handleForwardingToggle = async (newEnabled: boolean) => {
    if (!newEnabled && state.forwardingEnabled) {
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

    await saveRouting({
      forwardingEnabled: newEnabled,
      forwardingNumber: newEnabled ? phoneInput : null,
      transferEnabled: state.transferEnabled,
    })
  }

  // Transfer toggle: independent from forwarding. When ON, Ellie may warm-
  // transfer the call per TRANSFER RULES in her system prompt. When OFF, the
  // transferCall tool is unregistered and she's instructed to refuse transfers
  // and take messages instead.
  const handleTransferToggle = async (newEnabled: boolean) => {
    if (newEnabled && !state.forwardingNumber && !phoneInput.trim()) {
      setError('Enter a phone number first — transfers need somewhere to go.')
      return
    }
    if (newEnabled && phoneInput.trim() && !validatePhoneNumber(phoneInput)) {
      setError('Please enter a valid 10-digit phone number')
      return
    }

    await saveRouting({
      forwardingEnabled: state.forwardingEnabled,
      // Preserve whatever phone is currently saved. If the user typed a new
      // number but hasn't saved it via the forwarding toggle, send it along
      // so the server updates the column — but only when forwarding is OFF,
      // since forwarding-ON already requires a number check.
      forwardingNumber: state.forwardingEnabled
        ? phoneInput
        : (phoneInput.trim() ? phoneInput : null),
      transferEnabled: newEnabled,
    })
  }

  const saveRouting = async (next: {
    forwardingEnabled: boolean
    forwardingNumber: string | null
    transferEnabled: boolean
  }) => {
    setSaving(true)
    setError(null)
    setSuccess(false)
    setShowConfirmOff(false)

    try {
      const response = await fetch('/api/practices/forwarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: next.forwardingEnabled,
          forwarding_number: toE164(next.forwardingNumber),
          transfer_enabled: next.transferEnabled,
        }),
      })

      if (!response.ok) throw new Error('Failed to save routing state')

      const data = await response.json()
      setState({
        forwardingEnabled: data.forwarding_enabled ?? false,
        transferEnabled: data.transfer_enabled ?? false,
        forwardingNumber: data.call_forwarding_number ?? null,
      })
      setPhoneInput(formatFromStoredNumber(data.call_forwarding_number))

      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      console.error('Error saving routing state:', err)
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
          Two independent controls. <strong>Forwarding</strong> sends every incoming call straight to your phone (Ellie never picks up).{' '}
          <strong>Mid-call transfer</strong> lets Ellie screen the caller first and warm-transfer to you only when warranted — useful for clinicians, referral partners, or insurance reps.
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
          <p className="text-sm text-green-800">Settings saved.</p>
        </div>
      )}

      {/* Phone Number Input — shared destination for both routing modes */}
      <div className="border border-gray-200 rounded-lg p-5">
        <label className="block text-sm font-medium text-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <Phone className="w-4 h-4" />
            Your phone number
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
        <p className="text-xs text-gray-500 mt-2">
          10-digit US number. Forwarded calls ring here; mid-call transfers bridge here.
        </p>
      </div>

      {/* Forwarding Toggle */}
      <div className="border border-gray-200 rounded-lg p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">Call Forwarding</p>
            <p className="text-xs text-gray-500 mt-1">
              {state.forwardingEnabled ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-2 h-2 bg-orange-500 rounded-full" />
                  Every call is ringing <strong>{state.forwardingNumber}</strong> directly. Ellie is off the line.
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full" />
                  Ellie is answering your calls.
                </span>
              )}
            </p>
          </div>

          <button
            onClick={() => handleForwardingToggle(!state.forwardingEnabled)}
            disabled={saving}
            className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              state.forwardingEnabled ? 'bg-orange-500' : 'bg-gray-200'
            }`}
            aria-pressed={state.forwardingEnabled}
          >
            <span
              className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                state.forwardingEnabled ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Transfer Toggle */}
      <div className="border border-gray-200 rounded-lg p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">Mid-call warm transfer</p>
            <p className="text-xs text-gray-500 mt-1">
              {state.transferEnabled ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-2 h-2 bg-teal-500 rounded-full" />
                  Ellie may warm-transfer approved callers to your phone mid-call.
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <span className="w-2 h-2 bg-gray-400 rounded-full" />
                  Ellie will decline transfer requests and take a message instead.
                </span>
              )}
            </p>
            {state.forwardingEnabled && (
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-md">
                <p className="text-xs text-amber-900">
                  Forwarding is on, so every call goes straight to your phone and Ellie never answers. This transfer setting has no effect until you turn forwarding off.
                </p>
              </div>
            )}
          </div>

          <button
            onClick={() => handleTransferToggle(!state.transferEnabled)}
            disabled={saving}
            className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              state.transferEnabled ? 'bg-teal-500' : 'bg-gray-200'
            }`}
            aria-pressed={state.transferEnabled}
          >
            <span
              className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                state.transferEnabled ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Confirm turning forwarding off */}
      {showConfirmOff && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-base font-semibold text-gray-900">Turn forwarding off?</h3>
            <p className="text-sm text-gray-600 mt-2">
              Calls will start going to {state.forwardingEnabled ? 'Ellie' : 'Ellie'} again. You can turn this back on any time.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowConfirmOff(false)}
                disabled={saving}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  saveRouting({
                    forwardingEnabled: false,
                    forwardingNumber: state.forwardingNumber,
                    transferEnabled: state.transferEnabled,
                  })
                }
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Turn off forwarding
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
