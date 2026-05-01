'use client'

import { useEffect, useRef, useState } from 'react'
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
  const [cityFilter, setCityFilter] = useState(city || '')
  const [stateFilter, setStateFilter] = useState(state || '')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const pageRef = useRef(0)
  const lastSearchKeyRef = useRef<string>('')

  const formatPhoneNumber = (phoneNumber: string): string => {
    const cleaned = phoneNumber.replace(/\D/g, '')
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`
    }
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
    }
    return phoneNumber
  }

  const searchPhoneNumbers = async (overrides?: {
    areaCode?: string
    city?: string
    state?: string
    page?: number
  }) => {
    const areaCode = overrides?.areaCode ?? areaCodeFilter.trim()
    const cityArg = (overrides?.city ?? cityFilter).trim()
    const stateArg = (overrides?.state ?? stateFilter).trim()
    const page = overrides?.page ?? 0

    if (!areaCode && !cityArg && !stateArg) {
      setAvailableNumbers([])
      setError(null)
      setInfo('Enter an area code or a city + state to search.')
      return
    }

    setLoading(true)
    setError(null)
    setInfo(null)

    try {
      const response = await fetch('/api/phone-numbers/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(areaCode && { area_code: areaCode }),
          ...(cityArg && { city: cityArg }),
          ...(stateArg && { state: stateArg }),
          ...(page > 0 && { page }),
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to search phone numbers')
      }

      const data = await response.json()
      const numbers: AvailableNumber[] = (data.results || [])
        .slice(0, 10)
        .map((num: { phoneNumber: string; locality: string; region: string }) => ({
          phoneNumber: num.phoneNumber,
          locality: num.locality,
          region: num.region,
          formatted: formatPhoneNumber(num.phoneNumber),
        }))

      setAvailableNumbers(numbers)
      if (numbers.length === 0) {
        if (page > 0) {
          // Ran out of pages; reset to first page silently next time.
          pageRef.current = 0
          setInfo('No more numbers in this set. Showing the first page again on next refresh.')
        } else if (cityArg && stateArg) {
          setError(
            `No local numbers found in ${cityArg}, ${stateArg}. Small towns often have limited carrier inventory — try a nearby larger city, or search by area code instead.`
          )
        } else if (areaCode) {
          setError(`No numbers available in area code ${areaCode}. Try another area code or a nearby city.`)
        } else {
          setError('No numbers matched that search. Try a different area code or city.')
        }
      }
    } catch (err) {
      console.error('Error searching phone numbers:', err)
      setError('Something went wrong. Please try again.')
      setAvailableNumbers([])
    } finally {
      setLoading(false)
    }
  }

  // Auto-run an initial search if the parent already has city + state filled.
  useEffect(() => {
    if (city) setCityFilter(prev => prev || city)
    if (state) setStateFilter(prev => prev || state)
    if (city && state && !areaCodeFilter) {
      pageRef.current = 0
      lastSearchKeyRef.current = `${city}|${state}|`
      searchPhoneNumbers({ city, state, page: 0 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, state])

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    pageRef.current = 0
    lastSearchKeyRef.current = `${cityFilter}|${stateFilter}|${areaCodeFilter}`
    searchPhoneNumbers({ page: 0 })
  }

  const handleRefresh = () => {
    // Rotate to the next page of results without changing the search.
    const key = `${cityFilter}|${stateFilter}|${areaCodeFilter}`
    if (key !== lastSearchKeyRef.current) {
      pageRef.current = 0
      lastSearchKeyRef.current = key
    } else {
      pageRef.current = pageRef.current + 1
    }
    searchPhoneNumbers({ page: pageRef.current })
  }

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
            <input
              type="text"
              placeholder="Portland"
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
            <input
              type="text"
              placeholder="OR"
              maxLength={2}
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value.toUpperCase())}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg uppercase focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Area Code</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="541"
                value={areaCodeFilter}
                onChange={(e) => setAreaCodeFilter(e.target.value.replace(/\D/g, ''))}
                maxLength={3}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-gray-500">
            Search by area code (e.g. 541) or city + state (e.g. Portland, OR). All three can be combined.
          </p>
          <button
            type="submit"
            disabled={loading || (!areaCodeFilter.trim() && !(cityFilter.trim() && stateFilter.trim()))}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
          </button>
        </div>
      </form>

      <div className="flex justify-end">
        <button
          onClick={handleRefresh}
          disabled={loading || (!areaCodeFilter.trim() && !cityFilter.trim() && !stateFilter.trim())}
          title="Show a different set of numbers"
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          {error}
        </div>
      )}

      {info && !error && (
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700">
          {info}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
          <span className="ml-3 text-gray-600">Searching available numbers...</span>
        </div>
      )}

      {!loading && availableNumbers.length > 0 && (
        <>
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
                      {number.locality}
                      {number.locality && number.region ? ', ' : ''}
                      {number.region}
                    </div>
                  </div>
                  {selectedNumber === number.phoneNumber && (
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-teal-500 flex items-center justify-center">
                      <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 text-center">
            Showing up to 10 numbers. Hit <span className="font-medium">Refresh</span> to see another set.
          </p>
        </>
      )}

      {!loading && availableNumbers.length === 0 && !error && !info && (
        <div className="text-center py-12">
          <p className="text-gray-500">
            Enter an area code or city + state above and click <span className="font-medium">Search</span> to find available phone numbers for your practice.
          </p>
        </div>
      )}
    </div>
  )
}
