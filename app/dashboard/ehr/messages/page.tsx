// app/dashboard/ehr/messages/page.tsx — therapist inbox for all patient threads.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MessageSquare, Send } from 'lucide-react'

type Thread = {
  id: string; patient_id: string; subject: string
  last_message_at: string | null; last_message_preview: string | null
  unread_by_practice_count: number; created_at: string
}
type Message = { id: string; sender_type: 'patient' | 'practice'; body: string; created_at: string }

export default function MessagesPage() {
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const [patients, setPatients] = useState<Map<string, any>>(new Map())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [active, setActive] = useState<{ thread: Thread; messages: Message[] } | null>(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)

  async function loadThreads() {
    const r = await fetch('/api/ehr/messages')
    if (r.ok) setThreads((await r.json()).threads || [])
    const pr = await fetch('/api/practice/me')
    if (pr.ok) {
      const p = await pr.json()
      const r2 = await fetch(`/api/admin/patients?practice_id=${p.practice?.id}`)
      if (r2.ok) {
        const j = await r2.json()
        setPatients(new Map((j.patients || []).map((p: any) => [p.id, p])))
      }
    }
  }
  async function loadThread(id: string) {
    setActiveId(id)
    const r = await fetch(`/api/ehr/messages/${id}`)
    if (r.ok) setActive(await r.json())
    await loadThreads() // refresh unread counts
  }
  useEffect(() => { loadThreads() /* eslint-disable-line */ }, [])

  async function sendReply(e: React.FormEvent) {
    e.preventDefault()
    if (!active || !reply.trim()) return
    setSending(true)
    try {
      const r = await fetch('/api/ehr/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: active.thread.patient_id, thread_id: activeId, body: reply.trim() }),
      })
      if (!r.ok) throw new Error('Failed')
      setReply('')
      if (activeId) await loadThread(activeId)
    } finally { setSending(false) }
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2 mb-4">
        <MessageSquare className="w-6 h-6 text-teal-600" />
        Messages
      </h1>

      <div className="grid md:grid-cols-[320px_1fr] gap-4">
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden max-h-[600px] overflow-y-auto">
          {threads === null ? (
            <div className="p-4 text-sm text-gray-500">Loading…</div>
          ) : threads.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">No threads yet.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {threads.map((t) => {
                const p = patients.get(t.patient_id)
                const name = p ? `${p.first_name} ${p.last_name}` : 'Patient'
                return (
                  <li key={t.id}>
                    <button onClick={() => loadThread(t.id)}
                      className={`w-full text-left p-3 hover:bg-gray-50 ${activeId === t.id ? 'bg-teal-50' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-900 truncate">{name}</span>
                        {t.unread_by_practice_count > 0 && (
                          <span className="text-[10px] bg-teal-600 text-white rounded-full px-1.5 py-0.5">New</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-600 truncate">{t.subject}</div>
                      {t.last_message_preview && (
                        <div className="text-[11px] text-gray-500 truncate mt-0.5">{t.last_message_preview}</div>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 min-h-[400px] flex flex-col">
          {active ? (
            <>
              <div className="border-b border-gray-100 pb-2 mb-3">
                <div className="text-sm font-semibold text-gray-900">{active.thread.subject}</div>
                <Link href={`/dashboard/patients/${active.thread.patient_id}`}
                  className="text-xs text-teal-700 hover:text-teal-900">
                  Open patient profile →
                </Link>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto max-h-[400px]">
                {active.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.sender_type === 'practice' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${
                      m.sender_type === 'practice' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-900'
                    }`}>
                      <div className="whitespace-pre-wrap">{m.body}</div>
                      <div className={`text-[10px] mt-1 ${m.sender_type === 'practice' ? 'text-teal-100' : 'text-gray-500'}`}>
                        {new Date(m.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={sendReply} className="mt-3 flex items-start gap-2">
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} required
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Reply to patient…" />
                <button type="submit" disabled={sending}
                  className="inline-flex items-center gap-1 text-sm bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg disabled:opacity-50">
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </>
          ) : (
            <p className="text-sm text-gray-500 m-auto">Pick a thread on the left.</p>
          )}
        </div>
      </div>
    </div>
  )
}
