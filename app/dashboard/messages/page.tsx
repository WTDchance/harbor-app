'use client'

import { useState, useEffect } from 'react'
import { MessageSquare } from 'lucide-react'
import { MessageThread } from '@/components/MessageThread'
import type { SMSConversation } from '@/types'

export default function MessagesPage() {
  const [conversations, setConversations] = useState<SMSConversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch SMS conversations
    const fetchConversations = async () => {
      try {
        // Mock data for demo
        setConversations([
          {
            id: 'conv-001',
            practice_id: 'practice-001',
            patient_phone: '+15551112222',
            messages_json: [
              {
                direction: 'outbound',
                content:
                  'Hi Jessica! This is Sam from Hope and Harmony. Just confirming your appointment tomorrow at 2 PM. Reply YES to confirm or call us at 555-1234567.',
                timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
              },
              {
                direction: 'inbound',
                content: 'YES, confirmed! See you tomorrow',
                timestamp: new Date(Date.now() - 1.5 * 60 * 60 * 1000).toISOString(),
              },
              {
                direction: 'outbound',
                content:
                  "Perfect! We'll see you tomorrow at 2 PM. Thank you for choosing Hope and Harmony.",
                timestamp: new Date(Date.now() - 1.4 * 60 * 60 * 1000).toISOString(),
              },
            ],
            last_message_at: new Date(Date.now() - 1.4 * 60 * 60 * 1000).toISOString(),
            created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          },
          {
            id: 'conv-002',
            practice_id: 'practice-001',
            patient_phone: '+15551113333',
            messages_json: [
              {
                direction: 'inbound',
                content: 'Can I schedule an appointment for next week?',
                timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
              },
              {
                direction: 'outbound',
                content:
                  'Of course! I have availability Monday at 10am, Tuesday at 2pm, or Thursday at 4pm. Which works best for you?',
                timestamp: new Date(Date.now() - 2.9 * 60 * 60 * 1000).toISOString(),
              },
              {
                direction: 'inbound',
                content: 'Tuesday at 2pm is perfect',
                timestamp: new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString(),
              },
            ],
            last_message_at: new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString(),
            created_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
          },
        ])

        setSelectedId('conv-001')
      } catch (error) {
        console.error('Error fetching conversations:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchConversations()
  }, [])

  const selectedConversation = conversations.find((c) => c.id === selectedId)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Messages</h1>
        <p className="text-gray-600 mt-2">SMS conversations with patients</p>
      </div>

      {loading ? (
        <div className="text-center py-8">
          <p className="text-gray-500">Loading messages...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Conversation list */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg border border-gray-200 divide-y overflow-hidden">
              {conversations.length === 0 ? (
                <div className="p-8 text-center">
                  <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-600">No conversations yet</p>
                </div>
              ) : (
                conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    onClick={() => setSelectedId(conversation.id)}
                    className={`w-full p-4 text-left hover:bg-gray-50 transition-colors ${
                      selectedId === conversation.id ? 'bg-teal-50 border-l-4 border-teal-600' : ''
                    }`}
                  >
                    <p className="font-mono text-sm font-semibold text-gray-900">
                      {conversation.patient_phone}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(conversation.last_message_at).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-gray-600 mt-1 line-clamp-1">
                      {conversation.messages_json[conversation.messages_json.length - 1]?.content}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Conversation detail */}
          <div className="lg:col-span-2">
            {selectedConversation ? (
              <MessageThread conversation={selectedConversation} />
            ) : (
              <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
                <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600">Select a conversation to view messages</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
