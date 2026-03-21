'use client'

import { useState, useEffect } from 'react'
import { MessageSquare } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'

interface Message {
  direction: 'inbound' | 'outbound'
  content: string
  timestamp: string
  message_sid?: string
}

interface Conversation {
  id: string
  practice_id: string
  patient_phone: string
  patient_name?: string
  messages_json: Message[]
  last_message_at: string
}

export default function MessagesPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchConversations = async () => {
      try {
        const supabase = createClient()

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setLoading(false)
          return
        }

        const { data: practice } = await supabase
          .from('practices')
          .select('id')
          .eq('notification_email', user.email)
          .single()

        if (!practice) {
          setLoading(false)
          return
        }

        const { data, error } = await supabase
          .from('sms_conversations')
          .select('*')
          .eq('practice_id', practice.id)
          .order('last_message_at', { ascending: false })

        if (error) {
          console.error('Error fetching conversations:', error)
          setConversations([])
        } else {
          setConversations(data || [])
          if (data && data.length > 0) {
            setSelectedId(data[0].id)
          }
        }
      } catch (error) {
        console.error('Error fetching conversations:', error)
        setConversations([])
      } finally {
        setLoading(false)
      }
    }

    fetchConversations()
  }, [])

  const selectedConversation = conversations.find((c) => c.id === selectedId)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Messages</h1>
        <p className="text-gray-600 mt-2">SMS conversations with patients</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg border border-gray-200 divide-y overflow-hidden">
              {conversations.length === 0 ? (
                <div className="p-8 text-center">
                  <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-600 font-medium">No messages yet</p>
                  <p className="text-sm text-gray-500 mt-1">Patient SMS conversations will appear here</p>
                </div>
              ) : (
                conversations.map((conversation) => {
                  const lastMsg = conversation.messages_json?.[conversation.messages_json.length - 1]
                  return (
                    <button
                      key={conversation.id}
                      onClick={() => setSelectedId(conversation.id)}
                      className={`w-full p-4 text-left hover:bg-gray-50 transition-colors ${
                        selectedId === conversation.id ? 'bg-teal-50 border-l-4 border-teal-600' : ''
                      }`}
                    >
                      <p className="font-semibold text-gray-900 text-sm">
                        {conversation.patient_name || conversation.patient_phone}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {new Date(conversation.last_message_at).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                        })}
                      </p>
                      {lastMsg && (
                        <p className="text-xs text-gray-600 mt-1 line-clamp-1">
                          {lastMsg.direction === 'outbound' ? '→ ' : ''}{lastMsg.content}
                        </p>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>

          <div className="lg:col-span-2">
            {selectedConversation ? (
              <div className="bg-white rounded-lg border border-gray-200 flex flex-col h-[600px]">
                <div className="p-4 border-b">
                  <p className="font-semibold text-gray-900">
                    {selectedConversation.patient_name || selectedConversation.patient_phone}
                  </p>
                  <p className="text-sm text-gray-500">{selectedConversation.patient_phone}</p>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {(selectedConversation.messages_json || []).map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl text-sm ${
                          msg.direction === 'outbound'
                            ? 'bg-teal-600 text-white rounded-br-sm'
                            : 'bg-gray-100 text-gray-900 rounded-bl-sm'
                        }`}
                      >
                        <p>{msg.content}</p>
                        <p className={`text-xs mt-1 ${msg.direction === 'outbound' ? 'text-teal-100' : 'text-gray-400'}`}>
                          {new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
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
