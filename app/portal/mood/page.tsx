// app/portal/mood/page.tsx — patient's daily check-in.
// Quick UI: two sliders (mood + anxiety) + sleep hours + optional note.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Smile } from 'lucide-react'

export default function MoodPage() {
  const router = useRouter()
  const [mood, setMood] = useState(5)
  const [anxiety, setAnxiety] = useState(5)
  const [sleep, setSleep] = useState<string>('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [recent, setRecent] = useState<Array<{ logged_at: string; mood: number }>>([])

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/portal/mood')
      if (res.status === 401) { router.replace('/portal/login'); return }
      const json = await res.json()
      setRecent(json.logs || [])
    })()
  }, [router])

  async function submit() {
    setSubmitting(true)
    try {
      const res = await fetch('/api/portal/mood', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mood,
          anxiety,
          sleep_hours: sleep ? Number(sleep) : null,
          note: note || null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      setDone(true)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed')
    } finally { setSubmitting(false) }
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <Link href="/portal/home" className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-900 mb-4">
        <ChevronLeft className="w-4 h-4" />
        Back to portal
      </Link>

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-1">
          <Smile className="w-5 h-5 text-teal-600" />
          <h1 className="text-xl font-semibold text-gray-900">Daily check-in</h1>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          Takes 30 seconds. Your therapist uses these between-session check-ins to see how you&apos;re doing over time.
        </p>

        {done ? (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800">
            Thanks. Your check-in is in. Come back any time today or tomorrow for another one.
            <div className="mt-3">
              <Link href="/portal/home" className="text-teal-700 hover:text-teal-900 font-medium">
                Back to portal →
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <Slider
              label="Mood"
              hint="1 = worst I've felt · 10 = best I've felt"
              value={mood}
              onChange={setMood}
            />
            <Slider
              label="Anxiety"
              hint="1 = very calm · 10 = extremely anxious"
              value={anxiety}
              onChange={setAnxiety}
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sleep last night</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0} max={14} step={0.5}
                  value={sleep}
                  onChange={(e) => setSleep(e.target.value)}
                  placeholder="e.g. 7"
                  className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <span className="text-sm text-gray-500">hours</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Anything you want to share? (optional)</label>
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Quick note for your therapist to see at your next session."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <button
              onClick={submit}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg px-4 py-2.5 disabled:opacity-50"
            >
              {submitting ? 'Sending…' : 'Send check-in'}
            </button>
          </div>
        )}
      </div>

      {recent.length > 0 && !done && (
        <div className="mt-6 bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Recent check-ins</div>
          <div className="flex items-end gap-1 h-16">
            {recent.slice(0, 14).reverse().map((r, i) => (
              <div
                key={i}
                className="flex-1 bg-teal-500 rounded-t"
                style={{ height: `${(r.mood / 10) * 100}%`, minHeight: 4 }}
                title={`${new Date(r.logged_at).toLocaleDateString()} · mood ${r.mood}/10`}
              />
            ))}
          </div>
          <div className="text-xs text-gray-500 mt-2">Last 14 mood check-ins (earliest → most recent).</div>
        </div>
      )}
    </div>
  )
}

function Slider({ label, hint, value, onChange }: {
  label: string; hint?: string; value: number; onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-sm font-medium text-gray-700">{label}</label>
        <span className="text-lg font-bold text-teal-700">{value}</span>
      </div>
      {hint && <p className="text-xs text-gray-500 mb-2">{hint}</p>}
      <input
        type="range"
        min={1} max={10} step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-teal-600"
      />
      <div className="flex justify-between text-[10px] text-gray-400 mt-1">
        <span>1</span><span>5</span><span>10</span>
      </div>
    </div>
  )
}
