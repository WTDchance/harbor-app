'use client'

import { formatDistanceToNow } from 'date-fns'
import type { SMSConversation } from '@/types'

interface MessageThreadProps {
  conversation: SMSConversation
}

export function MessageThread({ conversation }: MessageThreadProps) {
  const messages = conversation.messages_json || []

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <p className="text-sm font-semibold text-gray-900">{conversation.patient_phone}</p>
        <p className="text-xs text-gray-500 mt-1">
          Updated {formatDistanceToNow(new Date(conversation.last_message_at), { addSuffix: true })}
        </p>
      </div>

      {/* Messages */}
      <div className="p-4 max-h-96 overflow-y-auto space-y-3">
        {messages.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No messages yet</p>
        ) : (
          messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-xs px-4 py-2 rounded-lg ${
                  message.direction === 'outbound'
                    ? 'bg-teal-600 text-white'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                <p className="text-sm break-words">{message.content}</p>
                <p
                  className={`text-xs mt-1 ${
                    message.direction === 'outbound'
                      ? 'text-teal-100'
                      : 'text-gray-500'
                  }`}
                >
                  {new Date(message.timestamp).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
