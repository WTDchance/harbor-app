"use client";
// app/dashboard/messaging/page.tsx
// Harbor - Unified SMS Inbox
// Shows all text conversations for a practice in a sidebar/inbox format.
// Features: conversation list, chat view, send replies, patient name linking,
// search/filter, auto-refresh, mobile responsive

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";

const supabase = createClient();

type Message = {
  direction: "inbound" | "outbound";
  content: string;
  timestamp: string;
  message_sid?: string;
  metadata?: { crisis?: boolean };
};

type Conversation = {
  id: string;
  patient_phone: string;
  patient_name: string | null;
  patient_id: string | null;
  message_count: number;
  last_message_preview: string | null;
  last_message_direction: string | null;
  last_message_at: string | null;
  created_at: string;
  messages: Message[];
};

function formatPhone(phone: string) {
  if (!phone) return "--";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function formatTimestamp(ts: string | null) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return d.toLocaleDateString("en-US", { weekday: "short" });
  } else {
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }
}

function formatMessageTime(ts: string) {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatMessageDate(ts: string) {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// --- Conversation List Item ---
function ConversationItem({
  conv,
  isSelected,
  onClick,
}: {
  conv: Conversation;
  isSelected: boolean;
  onClick: () => void;
}) {
  const displayName = conv.patient_name || formatPhone(conv.patient_phone);
  const initials = conv.patient_name
    ? conv.patient_name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "#";

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors border-b border-gray-50 ${
        isSelected
          ? "bg-teal-50 border-l-2 border-l-teal-500"
          : "hover:bg-gray-50 border-l-2 border-l-transparent"
      }`}
    >
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold ${
          isSelected
            ? "bg-teal-100 text-teal-700"
            : "bg-gray-100 text-gray-600"
        }`}
      >
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-gray-900 truncate">
            {displayName}
          </span>
          <span className="text-xs text-gray-400 shrink-0">
            {formatTimestamp(conv.last_message_at)}
          </span>
        </div>
        <p className="text-xs text-gray-500 truncate mt-0.5">
          {conv.last_message_direction === "outbound" && (
            <span className="text-gray-400">You: </span>
          )}
          {conv.last_message_preview || "No messages"}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-gray-400">
            {conv.message_count} message{conv.message_count !== 1 ? "s" : ""}
          </span>
          {conv.patient_name && (
            <span className="inline-flex items-center px-1.5 py-0 rounded text-xs bg-teal-50 text-teal-600">
              Patient
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// --- Chat Bubble ---
function ChatBubble({ message }: { message: Message }) {
  const isOutbound = message.direction === "outbound";
  const isCrisis = message.metadata?.crisis;

  return (
    <div
      className={`flex ${isOutbound ? "justify-end" : "justify-start"} mb-2`}
    >
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
          isCrisis
            ? "bg-red-50 border border-red-200 text-red-900"
            : isOutbound
            ? "bg-teal-600 text-white"
            : "bg-gray-100 text-gray-900"
        }`}
      >
        <p className="text-sm whitespace-pre-wrap break-words">
          {message.content}
        </p>
        <p
          className={`text-xs mt-1 ${
            isCrisis
              ? "text-red-400"
              : isOutbound
              ? "text-teal-200"
              : "text-gray-400"
          }`}
        >
          {formatMessageTime(message.timestamp)}
          {isCrisis && " ⚠️ Crisis detected"}
        </p>
      </div>
    </div>
  );
}

// --- Date Separator ---
function DateSeparator({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 border-t border-gray-200" />
      <span className="text-xs text-gray-400 font-medium">{date}</span>
      <div className="flex-1 border-t border-gray-200" />
    </div>
  );
}

// --- Empty State ---
function EmptyInbox() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            className="text-gray-400"
          >
            <path
              d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-1">
          No conversations yet
        </h3>
        <p className="text-sm text-gray-500 max-w-xs mx-auto">
          When patients text your practice number, conversations will appear
          here. Ellie handles responses automatically.
        </p>
      </div>
    </div>
  );
}

// --- No Selection State ---
function NoSelection() {
  return (
    <div className="flex-1 flex items-center justify-center bg-gray-50">
      <div className="text-center px-6">
        <div className="w-14 h-14 rounded-2xl bg-white border border-gray-200 flex items-center justify-center mx-auto mb-4 shadow-sm">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            className="text-gray-400"
          >
            <path
              d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-gray-700 mb-1">
          Select a conversation
        </h3>
        <p className="text-sm text-gray-400">
          Choose a conversation from the left to view messages
        </p>
      </div>
    </div>
  );
}

// --- Main Component ---
export default function MessagingPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  const selectedConversation = conversations.find((c) => c.id === selectedId);

  // Fetch conversations
  const fetchConversations = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch("/api/sms/conversations?limit=100", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!res.ok) {
        throw new Error("Failed to fetch conversations");
      }

      const data = await res.json();
      setConversations(data.conversations || []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();

    // Auto-refresh every 15 seconds
    refreshTimerRef.current = setInterval(fetchConversations, 15000);

    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [fetchConversations]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [selectedId, conversations]);

  // Send reply
  async function handleSendReply() {
    if (!replyText.trim() || !selectedConversation || sending) return;

    setSending(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      // Get practice ID via server-side resolver (respects act-as cookie)
      const meRes = await fetch("/api/practice/me");
      if (!meRes.ok) {
        setError("Could not find practice");
        return;
      }
      const meData = await meRes.json();
      const practiceId = meData.practice?.id;
      if (!practiceId) {
        setError("Could not find practice");
        return;
      }

      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          to: selectedConversation.patient_phone,
          body: replyText.trim(),
          practiceId,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to send message");
      }

      setReplyText("");
      // Refresh conversations to show new message
      await fetchConversations();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  // Filter conversations by search
  const filteredConversations = conversations.filter((conv) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (conv.patient_name && conv.patient_name.toLowerCase().includes(q)) ||
      conv.patient_phone.includes(q) ||
      (conv.last_message_preview &&
        conv.last_message_preview.toLowerCase().includes(q))
    );
  });

  // Group messages by date for display
  function getMessagesWithDates(messages: Message[]) {
    const result: { type: "date" | "message"; data: any }[] = [];
    let lastDate = "";

    for (const msg of messages) {
      const msgDate = formatMessageDate(msg.timestamp);
      if (msgDate !== lastDate) {
        result.push({ type: "date", data: msgDate });
        lastDate = msgDate;
      }
      result.push({ type: "message", data: msg });
    }

    return result;
  }

  // Handle selecting a conversation
  function handleSelectConversation(id: string) {
    setSelectedId(id);
    setMobileShowChat(true);
    setReplyText("");
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Loading messages...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-white overflow-hidden">
      {/* --- Conversation List (Left Panel) --- */}
      <div
        className={`w-full md:w-96 md:min-w-[320px] md:max-w-[384px] flex flex-col border-r border-gray-200 bg-white ${
          mobileShowChat ? "hidden md:flex" : "flex"
        }`}
      >
        {/* Header */}
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-900">Messages</h1>
            <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded-full">
              {conversations.length} conversation
              {conversations.length !== 1 ? "s" : ""}
            </span>
          </div>
          {/* Search */}
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
            >
              <circle
                cx="7"
                cy="7"
                r="5"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M11 11l3.5 3.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-gray-50"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <div className="px-4 py-8 text-center">
              {searchQuery ? (
                <p className="text-sm text-gray-500">
                  No conversations match &ldquo;{searchQuery}&rdquo;
                </p>
              ) : (
                <EmptyInbox />
              )}
            </div>
          ) : (
            filteredConversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conv={conv}
                isSelected={conv.id === selectedId}
                onClick={() => handleSelectConversation(conv.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* --- Chat View (Right Panel) --- */}
      <div
        className={`flex-1 flex flex-col min-w-0 ${
          !mobileShowChat ? "hidden md:flex" : "flex"
        }`}
      >
        {!selectedConversation ? (
          <NoSelection />
        ) : (
          <>
            {/* Chat Header */}
            <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center gap-3">
              {/* Mobile back button */}
              <button
                onClick={() => setMobileShowChat(false)}
                className="md:hidden text-gray-500 hover:text-gray-700 -ml-1"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                >
                  <path
                    d="M12 4l-6 6 6 6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold bg-teal-100 text-teal-700`}
              >
                {selectedConversation.patient_name
                  ? selectedConversation.patient_name
                      .split(" ")
                      .map((w) => w[0])
                      .join("")
                      .toUpperCase()
                      .slice(0, 2)
                  : "#"}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-gray-900 truncate">
                  {selectedConversation.patient_name ||
                    formatPhone(selectedConversation.patient_phone)}
                </h2>
                <p className="text-xs text-gray-500">
                  {formatPhone(selectedConversation.patient_phone)}
                  {selectedConversation.patient_name && (
                    <>
                      {" "}
                      &middot;{" "}
                      {selectedConversation.message_count} messages
                    </>
                  )}
                </p>
              </div>
              {selectedConversation.patient_id && (
                <Link
                  href={`/dashboard/patients/${selectedConversation.patient_id}`}
                  className="text-xs text-teal-600 hover:text-teal-700 font-medium px-3 py-1.5 rounded-lg hover:bg-teal-50 transition-colors"
                >
                  View Patient
                </Link>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 bg-gray-50">
              {error && (
                <div className="bg-red-50 text-red-700 px-3 py-2 rounded-lg text-sm mb-3">
                  {error}
                </div>
              )}

              {selectedConversation.messages.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-400">No messages yet</p>
                </div>
              ) : (
                getMessagesWithDates(selectedConversation.messages).map(
                  (item, i) => {
                    if (item.type === "date") {
                      return <DateSeparator key={`date-${i}`} date={item.data} />;
                    }
                    return <ChatBubble key={`msg-${i}`} message={item.data} />;
                  }
                )
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply Input */}
            <div className="px-4 py-3 border-t border-gray-200 bg-white">
              <div className="flex items-end gap-2">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendReply();
                    }
                  }}
                  placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
                  rows={1}
                  className="flex-1 resize-none border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-gray-50 max-h-32"
                  style={{
                    minHeight: "42px",
                    height: replyText.split("\n").length > 1 ? "auto" : "42px",
                  }}
                />
                <button
                  onClick={handleSendReply}
                  disabled={!replyText.trim() || sending}
                  className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                    replyText.trim() && !sending
                      ? "bg-teal-600 text-white hover:bg-teal-700"
                      : "bg-gray-100 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  {sending ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <path
                        d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1.5 ml-1">
                Messages are sent via your practice phone number. AI auto-replies handle
                most incoming texts.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
