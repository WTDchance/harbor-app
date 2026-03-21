'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { Mic, Trash2, Copy, Send } from 'lucide-react'

interface SessionNote {
  id: string
  patient_name?: string
  patient_phone?: string
  session_date: string
  note_text: string
  created_at: string
  updated_at: string
  ehr_synced: boolean
}

export default function NotesPage() {
  const supabase = createClient()
  const [notes, setNotes] = useState<SessionNote[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedNote, setSelectedNote] = useState<SessionNote | null>(null)
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'transcribing' | 'done'>('idle')
  const [editingNote, setEditingNote] = useState<Partial<SessionNote> | null>(null)
  const [saving, setSaving] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  useEffect(() => {
    loadNotes()
  }, [supabase])

  const loadNotes = async () => {
    try {
      const res = await fetch('/api/notes')
      if (res.ok) {
        const data = await res.json()
        setNotes(data.notes || [])
        if (data.notes?.length > 0) {
          setSelectedNote(data.notes[0])
          setEditingNote(data.notes[0])
        }
      }
      setLoading(false)
    } catch (error) {
      console.error('Error loading notes:', error)
      setLoading(false)
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []

      recorder.ondataavailable = (e) => chunksRef.current.push(e.data)
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setRecordingState('transcribing')

        const form = new FormData()
        form.append('audio', blob, 'recording.webm')

        try {
          const res = await fetch('/api/notes/transcribe', {
            method: 'POST',
            body: form,
          })
          const { transcript } = await res.json()
          setEditingNote(prev => ({
            ...prev,
            note_text: transcript || '',
          }))
          setRecordingState('done')
        } catch (error) {
          console.error('Transcription error:', error)
          setRecordingState('idle')
        }

        stream.getTracks().forEach(t => t.stop())
      }

      recorder.start()
      mediaRecorderRef.current = recorder
      setRecordingState('recording')
      setEditingNote({ note_text: '', session_date: new Date().toISOString().split('T')[0] })
    } catch (error) {
      console.error('Error accessing microphone:', error)
      alert('Unable to access microphone. Please check permissions.')
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
  }

  const saveNote = async () => {
    if (!editingNote?.note_text) {
      alert('Please enter or dictate a note')
      return
    }

    setSaving(true)
    try {
      const method = selectedNote?.id ? 'PATCH' : 'POST'
      const url = selectedNote?.id ? `/api/notes/${selectedNote.id}` : '/api/notes'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_name: editingNote.patient_name || null,
          patient_phone: editingNote.patient_phone || null,
          session_date: editingNote.session_date,
          note_text: editingNote.note_text,
        }),
      })

      if (res.ok) {
        const { note } = await res.json()
        if (selectedNote?.id) {
          setNotes(prev => prev.map(n => (n.id === note.id ? note : n)))
        } else {
          setNotes(prev => [note, ...prev])
        }
        setSelectedNote(note)
        setEditingNote(note)
        setRecordingState('idle')
      }
    } catch (error) {
      console.error('Error saving note:', error)
    } finally {
      setSaving(false)
    }
  }

  const deleteNote = async (noteId: string) => {
    if (!confirm('Delete this note? This cannot be undone.')) return

    try {
      const res = await fetch(`/api/notes/${noteId}`, { method: 'DELETE' })
      if (res.ok) {
        setNotes(prev => prev.filter(n => n.id !== noteId))
        if (selectedNote?.id === noteId) {
          setSelectedNote(notes[1] || null)
          setEditingNote(notes[1] || null)
        }
      }
    } catch (error) {
      console.error('Error deleting note:', error)
    }
  }

  const copyNote = () => {
    if (!selectedNote) return
    const text = `Patient: ${selectedNote.patient_name || 'N/A'}\nDate: ${selectedNote.session_date}\n\n${selectedNote.note_text}`
    navigator.clipboard.writeText(text)
    alert('Note copied to clipboard')
  }

  const groupedNotes = notes.reduce((acc, note) => {
    const date = new Date(note.session_date).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
    if (!acc[date]) acc[date] = []
    acc[date].push(note)
    return acc
  }, {} as Record<string, SessionNote[]>)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-5 h-5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex gap-6 h-screen overflow-hidden">
      {/* Left Panel - Notes List */}
      <div className="w-1/3 flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <button
            onClick={() => {
              setSelectedNote(null)
              setEditingNote({ note_text: '', session_date: new Date().toISOString().split('T')[0] })
              setRecordingState('idle')
            }}
            className="w-full px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
          >
            New Note
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {Object.entries(groupedNotes).map(([date, dateNotes]) => (
            <div key={date}>
              <div className="px-4 py-2 bg-gray-50 sticky top-0 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                {date}
              </div>
              {dateNotes.map(note => (
                <div
                  key={note.id}
                  onClick={() => {
                    setSelectedNote(note)
                    setEditingNote(note)
                    setRecordingState('idle')
                  }}
                  className={`p-3 border-b border-gray-100 cursor-pointer transition-colors ${
                    selectedNote?.id === note.id ? 'bg-teal-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {note.patient_name || 'Anonymous'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                    {note.note_text.substring(0, 80)}...
                  </p>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Right Panel - Note Editor */}
      <div className="flex-1 flex flex-col gap-4">
        {/* New Recording Section */}
        {!selectedNote && recordingState === 'idle' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">New Note</h2>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Patient Name (optional)</label>
                <input
                  type="text"
                  value={editingNote?.patient_name || ''}
                  onChange={e =>
                    setEditingNote(prev => ({ ...prev, patient_name: e.target.value }))
                  }
                  placeholder="e.g. John Smith"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Session Date</label>
                <input
                  type="date"
                  value={editingNote?.session_date || new Date().toISOString().split('T')[0]}
                  onChange={e =>
                    setEditingNote(prev => ({ ...prev, session_date: e.target.value }))
                  }
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <button
              onClick={startRecording}
              className="w-full px-6 py-3 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 transition-colors flex items-center justify-center gap-2 mb-3"
            >
              <Mic className="w-5 h-5" />
              Record Note
            </button>

            <div className="relative mb-3">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">or</span>
              </div>
            </div>

            <button
              onClick={() => setRecordingState('done')}
              className="w-full px-4 py-2 text-teal-600 text-sm font-medium hover:bg-teal-50 rounded-lg transition-colors"
            >
              Type your note instead
            </button>
          </div>
        )}

        {/* Recording State */}
        {recordingState === 'recording' && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse" />
              <p className="text-red-700 font-medium">Recording...</p>
            </div>
            <button
              onClick={stopRecording}
              className="px-6 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors"
            >
              Stop Recording
            </button>
          </div>
        )}

        {recordingState === 'transcribing' && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center">
            <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-blue-700 font-medium">Transcribing audio...</p>
          </div>
        )}

        {/* Note Editor */}
        {editingNote && (recordingState === 'done' || recordingState === 'idle' || selectedNote) && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex-1 flex flex-col">
            <div className="space-y-4 mb-4">
              {selectedNote ? (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Patient Name</label>
                    <input
                      type="text"
                      value={editingNote?.patient_name || ''}
                      onChange={e =>
                        setEditingNote(prev => ({ ...prev, patient_name: e.target.value }))
                      }
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Session Date</label>
                      <input
                        type="date"
                        value={editingNote?.session_date || ''}
                        onChange={e =>
                          setEditingNote(prev => ({ ...prev, session_date: e.target.value }))
                        }
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Last Edited</label>
                      <p className="text-sm text-gray-600">
                        {new Date(editingNote?.updated_at || '').toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Patient Name</label>
                    <input
                      type="text"
                      value={editingNote?.patient_name || ''}
                      onChange={e =>
                        setEditingNote(prev => ({ ...prev, patient_name: e.target.value }))
                      }
                      placeholder="Optional"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Session Date</label>
                    <input
                      type="date"
                      value={editingNote?.session_date || new Date().toISOString().split('T')[0]}
                      onChange={e =>
                        setEditingNote(prev => ({ ...prev, session_date: e.target.value }))
                      }
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                </>
              )}
            </div>

            <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Session Notes</label>
            <textarea
              value={editingNote?.note_text || ''}
              onChange={e =>
                setEditingNote(prev => ({ ...prev, note_text: e.target.value }))
              }
              onBlur={() => {
                if (selectedNote && editingNote?.note_text !== selectedNote.note_text) {
                  saveNote()
                }
              }}
              placeholder="Dictated or typed note content..."
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none font-mono text-gray-700"
            />

            <div className="mt-4 flex gap-2">
              {recordingState === 'done' && (
                <>
                  <button
                    onClick={startRecording}
                    className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors flex items-center gap-2"
                  >
                    <Mic className="w-4 h-4" />
                    Re-record
                  </button>
                  <button
                    onClick={saveNote}
                    disabled={saving}
                    className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                  >
                    <Send className="w-4 h-4" />
                    {saving ? 'Saving...' : 'Save Note'}
                  </button>
                </>
              )}

              {selectedNote && (
                <>
                  <button
                    onClick={copyNote}
                    className="px-4 py-2 bg-slate-600 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors flex items-center gap-2"
                  >
                    <Copy className="w-4 h-4" />
                    Copy
                  </button>
                  <button
                    onClick={() => deleteNote(selectedNote.id)}
                    className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                  <button
                    disabled
                    className="px-4 py-2 bg-gray-300 text-gray-600 text-sm font-medium rounded-lg cursor-not-allowed opacity-50"
                    title="EHR integration coming soon"
                  >
                    Sync to EHR
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
