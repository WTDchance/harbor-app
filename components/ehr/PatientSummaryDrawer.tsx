// components/ehr/PatientSummaryDrawer.tsx
// Wave 38 M1 — opens the existing PatientAISummaryCard inline from the
// Today screen so therapists never have to navigate away to read the
// pre-session brief.
//
// Single component, one viewport branch:
//   - <768px: bottom sheet (slides up, swipe-down or X to close)
//   - >=768px: right side panel (slides in from the right, X to close)
//
// Focus trap + ESC close + body scroll lock when open.

'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { X, ArrowRight } from 'lucide-react'
import { PatientAISummaryCard } from './PatientAISummaryCard'

type Props = {
  open: boolean
  onClose: () => void
  patientId: string | null
  patientName?: string | null
}

const DESKTOP_BREAKPOINT = 768

export function PatientSummaryDrawer({ open, onClose, patientId, patientName }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const [isDesktop, setIsDesktop] = useState(false)

  // Touch state for swipe-down to dismiss on mobile
  const touchStartY = useRef<number | null>(null)
  const [dragOffset, setDragOffset] = useState(0)

  // Detect viewport
  useEffect(() => {
    function detect() {
      setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT)
    }
    detect()
    window.addEventListener('resize', detect)
    return () => window.removeEventListener('resize', detect)
  }, [])

  // ESC to close
  useEffect(() => {
    if (!open) return
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Body scroll lock + focus trap
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Focus the close button on open for keyboard users
    const t = setTimeout(() => closeRef.current?.focus(), 50)

    function trap(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', trap)

    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', trap)
      clearTimeout(t)
    }
  }, [open])

  // Reset drag offset on close
  useEffect(() => { if (!open) setDragOffset(0) }, [open])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (isDesktop) return
    touchStartY.current = e.touches[0]?.clientY ?? null
  }, [isDesktop])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (isDesktop || touchStartY.current == null) return
    const dy = (e.touches[0]?.clientY ?? 0) - touchStartY.current
    if (dy > 0) setDragOffset(dy)
  }, [isDesktop])

  const onTouchEnd = useCallback(() => {
    if (isDesktop) return
    if (dragOffset > 100) onClose()
    setDragOffset(0)
    touchStartY.current = null
  }, [isDesktop, dragOffset, onClose])

  if (!open || !patientId) return null

  // ----- Desktop: right side panel -----
  if (isDesktop) {
    return (
      <div
        className="fixed inset-0 z-50 flex"
        role="dialog"
        aria-modal="true"
        aria-label={`Pre-session summary${patientName ? ` for ${patientName}` : ''}`}
      >
        <div
          className="flex-1 bg-black/40 transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
        <div
          ref={panelRef}
          className="w-full max-w-md h-full bg-white shadow-2xl border-l border-gray-200 flex flex-col animate-[slideInRight_.18s_ease-out]"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">
                Pre-session summary
              </div>
              <div className="text-sm font-semibold text-gray-900 truncate">
                {patientName || 'Patient'}
              </div>
            </div>
            <button
              ref={closeRef}
              onClick={onClose}
              className="w-11 h-11 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
              aria-label="Close summary"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <PatientAISummaryCard patientId={patientId} compact />
          </div>
          <div className="px-5 py-3 border-t border-gray-200 bg-gray-50">
            <Link
              href={`/dashboard/patients/${patientId}`}
              className="inline-flex items-center gap-1.5 text-sm text-teal-700 hover:text-teal-900 font-medium"
              onClick={onClose}
            >
              Open full chart
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
        <style jsx>{`
          @keyframes slideInRight {
            from { transform: translateX(100%); }
            to   { transform: translateX(0); }
          }
        `}</style>
      </div>
    )
  }

  // ----- Mobile: bottom sheet -----
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`Pre-session summary${patientName ? ` for ${patientName}` : ''}`}
    >
      <div
        className="absolute inset-0 bg-black/40 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: dragOffset ? `translateY(${dragOffset}px)` : undefined,
          transition: dragOffset ? 'none' : 'transform .18s ease-out',
        }}
        className="relative bg-white rounded-t-2xl shadow-2xl flex flex-col max-h-[85vh] animate-[slideInUp_.18s_ease-out]"
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300" aria-hidden="true" />
        </div>
        <div className="flex items-center justify-between px-4 pb-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">
              Pre-session summary
            </div>
            <div className="text-sm font-semibold text-gray-900 truncate">
              {patientName || 'Patient'}
            </div>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            className="w-11 h-11 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
            aria-label="Close summary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 border-t border-gray-100">
          <PatientAISummaryCard patientId={patientId} compact />
        </div>
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 rounded-b-2xl">
          <Link
            href={`/dashboard/patients/${patientId}`}
            className="inline-flex items-center gap-1.5 text-sm text-teal-700 hover:text-teal-900 font-medium min-h-[44px]"
            onClick={onClose}
          >
            Open full chart
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
      <style jsx>{`
        @keyframes slideInUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
