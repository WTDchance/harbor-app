// app/portal/messages/page.tsx — patient's secure inbox + thread view.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, MessageSquare, Send } from 'lucide-react'

type Thread = {
  id: string
  subject: string
  last_message_at: string | null
  last_message_preview: string | null
  unread_by_patient_count: number
  created_at: string
}
type Message = { id: string; sender_type: 'patient' | 'practice'; body: string; created_at: string }

export default function PortalMessagesPage() {
  const router = useRouter()
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [active, setActive] = useState<{ thread: Thread; messages: Message[] } | null>(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [newBody, setNewBody] = useState('')
  const [newSubject, setNewSubject] = useState('')
  const [composing, setComposing] = useState(false)

  async function loadThreads() {
    const res = await fetch('/api/portal/messages')
    if (res.status === 401) { router.replace('/portal/login'); return }
    const json = await res.json()
    setThreads(json.threads || [])
  }
  async function loadThread(id: string) {
    setActiveId(id)
    const res = await fetch(`/api/portal/messages/${id}`)
    if (res.ok) setActive(await res.json())
  }
  useEffect(() => { loadThreads() /* eslint-disable-line */ }, [])

  async function sendReply(e: React.FormEvent) {
    e.preventDefault()
    if (!reply.trim() || !activeId) return
    setSending(true)
    try {
      const res = await fetch('/api/portal/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: activeId, body: reply.trim() }),
      })
      if (!res.ok) throw new Error('Failed')
      setReply('')
      await loadThread(activeId)
      await loadThreads()
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed') }
    finally { setSending(false) }
  }

  async function startNew(e: React.FormEvent) {
    e.preventDefault()
    if (!newBody.trim()) return
    setSending(true)
    try {
      const res = await fetch('/api/portal/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: newSubject.trim() || 'New conversation', body: newBody.trim() }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed')
      setComposing(false); setNewBody(''); setNewSubject('')
      await loadThreads()
      loadThread(j.thread_id)
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed') }
    finally { setSending(false) }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/portal/home" className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-900 mb-4">
        <ChevronLeft className="w-4 h-4" />
        Back to portal
      </Link>
      <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2 mb-4">
        <MessageSquare className="w-6 h-6 text-teal-600" />
        Messages
      </h1>

      <div className="grid md:grid-cols-[280px_1fr] gap-4">
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="border-b border-gray-100 p-2">
            <button onClick={() => { setComposing(true); setActive(null); setActiveId(null) }}
              className="w-full inline-flex items-center justify-center gap-1.5 text-sm bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-md">
              New message
            </button>
          </div>
          {threads === null ? (
            <div className="p-4 text-sm text-gray-500">Loading…</div>
          ) : threads.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">No conversations yet.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {threads.map((t) => (
                <li key={t.id}>
                  <button onClick={() => { setComposing(false); loadThread(t.id) }}
                    className={`w-full text-left p-3 hover:bg-gray-50 ${activeId === t.id ? 'bg-teal-50' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">{t.subject}</span>
                      {t.unread_by_patient_count > 0 && (
                        <span className="text-[10px] bg-teal-600 text-white rounded-full px-1.5 py-0.5">New</span>
                      )}
                    </div>
                    {t.last_message_preview && (
                      <div className="text-xs text-gray-500 truncate mt-0.5">{t.last_message_preview}</div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 min-h-[320px] flex flex-col">
          {composing ? (
            <form onSubmit={startNew} className="flex flex-col flex-1 gap-2">
              <input value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="Subject"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <textarea value={newBody} onChange={(e) => setNewBody(e.target.value)} rows={6} required
                placeholder="Write your message to your therapist…"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setComposing(false)} className="text-sm text-gray-600 px-3">Cancel</button>
                <button type="submit" disabled={sending}
                  className="inline-flex items-center gap-1.5 text-sm bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg disabled:opacity-50">
                  <Send className="w-3.5 h-3.5" />
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </form>
          ) : active ? (
            <>
              <div className="text-sm font-semibold text-gray-900 border-b border-gray-100 pb-2 mb-3">
                {active.thread.subject}
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto">
                {active.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.sender_type === 'patient' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${
                      m.sender_type === 'patient' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-900'
                    }`}>
                      <div className="whitespace-pre-wrap">{m.body}</div>
                      <div className={`text-[10px] mt-1 ${m.sender_type === 'patient' ? 'text-teal-100' : 'text-gray-500'}`}>
                        {new Date(m.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={sendReply} className="mt-3 flex items-start gap-2">
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} required
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Reply…" />
                <button type="submit" disabled={sending}
                  className="inline-flex items-center gap-1 text-sm bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg disabled:opacity-50">
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </>
          ) : (
            <p className="text-sm text-gray-500 m-auto">Select a conversation or start a new one.</p>
          )}
        </div>
      </div>
    </div>
  )
}
