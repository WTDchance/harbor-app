const AGENTMAIL_API_KEY = process.env.AGENTMAIL_API_KEY!
const BASE_URL = 'https://api.agentmail.to/v0'

function agentMailFetch(path: string, options?: RequestInit) {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${AGENTMAIL_API_KEY}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
}

export async function listInboxes() {
  const res = await agentMailFetch('/inboxes')
  if (!res.ok) throw new Error(`AgentMail listInboxes failed: ${res.status}`)
  return res.json()
}

export async function createInbox(username: string, displayName?: string) {
  const res = await agentMailFetch('/inboxes', {
    method: 'POST',
    body: JSON.stringify({ username, display_name: displayName }),
  })
  if (!res.ok) throw new Error(`AgentMail createInbox failed: ${res.status}`)
  return res.json()
}

export async function getMessage(inboxId: string, messageId: string) {
  const res = await agentMailFetch(`/inboxes/${inboxId}/messages/${messageId}`)
  if (!res.ok) throw new Error(`AgentMail getMessage failed: ${res.status}`)
  return res.json()
}

export async function sendEmail({
  inboxId,
  to,
  subject,
  text,
  html,
}: {
  inboxId: string
  to: string[]
  subject: string
  text?: string
  html?: string
}) {
  const res = await agentMailFetch(`/inboxes/${inboxId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ to, subject, text, html }),
  })
  if (!res.ok) throw new Error(`AgentMail sendEmail failed: ${res.status}`)
  return res.json()
}

export async function deleteInbox(inboxId: string) {
  const res = await agentMailFetch(`/inboxes/${inboxId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`AgentMail deleteInbox failed: ${res.status}`)
  return res.status === 204 ? null : res.json()
    }
