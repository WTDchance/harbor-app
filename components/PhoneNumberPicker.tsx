'use client'

import { useEffect, useState } from 'react'
import { Search, RefreshCw, Loader2 } from 'lucide-react'

interface AvailableNumber {
  phoneNumber: string
  locality: string
  region: string
  formatted: string
}

interface PhoneNumberPickerProps {
  city: string
  state: string
  onSelect: (phoneNumber: string) => void
  selectedNumber: string | null
}

export function PhoneNumberPicker({
  city,
  state,
  onSelect,
  selectedNumber,
}: PhoneNumberPickerProps) {
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([])
  const [loading, setLoading] = useState(false)
  const [areaCodeFilter, setAreaCodeFilter] = useState('')
  const [error, setError] = useState<string | null>(null)

  const formatPhoneNumber = (phoneNumber: string): string => {
    const cleaned = phoneNumber.replace(/\\D/g, '')
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`
    }
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
    }
    return phoneNumber
  }

  const searchPhoneNumbers = async (filterAreaCode?: string) => {
    if (!city || !state) {
      setError('Please provide city and state')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/phone-numbers/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city,
          state,
          ...(filterAreaCode && { area_code: filterAreaCode }),
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to search phone numbers')
      }

      const data = await response.json()
      const numbers = (data.results || []).map(
        (num: { phoneNumber: string; locality: string; region: string }) => ({
          phoneNumber: num.phoneNumber,
          locality: num.locality,
          region: num.region,
          formatted: formatPhoneNumber(num.phoneNumber),
        })
      )

      setAvailableNumbers(numbers)
      if (numbers.length === 0) {
        setError(
          filterAreaCode
            ? `No numbers available in area code ${filterAreaCode}. Try another area code.`
            : 'No numbers available in that area. Try a nearby area code.'
        )
      }
    } catch (err) {
      console.error('Error searching phone numbers:', err)
      setError('Something went wrong. Please try again.')
      setAvailableNumbers([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (city && state && !areaCodeFilter) {
      searchPhoneNumbers()
    }
  }, [city, state])

  const handleAreaCodeSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (areaCodeFilter.trim()) {
      searchPhoneNumbers(areaCodeFilter.trim())
    }
  }

  const handleRefresh = () => {
    setAreaCodeFilter('')
    searchPhoneNumbers()
  }

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* Search by Area Code */}
      <form onSubmit={handleAreaCodeSearch} className="space-y-3">
        <label className="block text-sm font-medium text-gray-700">
          Search by Area Code
        </label>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="e.g., 541"
              value={areaCodeFilter}
              onChange={(e) => setAreaCodeFilter(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              maxLength={3}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !areaCodeFilter.trim()}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'Search'
            )}
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Leave blank to see all available numbers in {city}, {state}
        </p>
      </form>

      {/* Refresh Button */}
      <div className="flex justify-end">
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
          <span className="ml-3 text-gray-600">Searching available numbers...</span>
        </div>
      )}

      {/* Phone Numbers Grid */}
      {!loading && availableNumbers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {availableNumbers.map((number) => (
            <button
              key={number.phoneNumber}
              onClick={() => onSelect(number.phoneNumber)}
              className={`p-4 text-left border-2 rounded-lg transition-all ${
                selectedNumber === number.phoneNumber
                  ? 'ring-2 ring-teal-500 bg-teal-50 border-teal-500'
                  : 'border-gray-300 bg-white hover:border-teal-300 hover:bg-teal-50'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="text-lg font-semibold text-gray-900">
                    {number.formatted}
                  </div>
                  <div className="mt-1 text-sm text-gray-600">
                    {number.locality}, {number.region}
                  </div>
                </div>
                {selectedNumber === number.phoneNumber && (
                  <div className="flex-shrink-0 w-5 h-5 rounded-full bg-teal-500 flex items-center justify-center">
                    <svg
                      className="w-3 h-3 text-white"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && availableNumbers.length === 0 && !error && (
        <div className="text-center py-12">
          <p className="text-gray-500">
            {areaCodeFilter
              ? 'No results found. Try another area code.'
              : 'Click "Search" to find available phone numbers for your practice.'}
          </p>
        </div>
      )}
    </div>
  )
}
