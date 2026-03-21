// Notification helper for sending messages across multiple channels
// Handles Slack, Smart Light, and Push notifications based on practice preferences

export interface NotificationPreferences {
  crisis: {
    sms: boolean
    push: boolean
    slack: boolean
    smart_light: boolean
  }
  arrival: {
    sms: boolean
    push: boolean
    slack: boolean
    smart_light: boolean
  }
  in_session_mode: boolean
  in_session_silent_only: boolean
  slack_webhook_url?: string | null
  smart_light_webhook_url?: string | null
}

export interface NotificationResult {
  channel: string
  sent?: boolean
  skipped?: boolean
  error?: string
  reason?: string
}

/**
 * Send notification across configured channels
 * Respects in-session mode and per-channel preferences
 */
export async function sendNotification(
  practiceId: string,
  type: 'crisis' | 'arrival',
  message: string,
  prefs: NotificationPreferences
): Promise<NotificationResult[]> {
  const channels = prefs[type] || {}
  const inSession = prefs.in_session_mode && prefs.in_session_silent_only

  const promises: Promise<NotificationResult>[] = []

  // SMS (skip if in-session mode)
  if (channels.sms && !inSession) {
    // SMS is handled by caller (Twilio)
    promises.push(Promise.resolve({
      channel: 'sms',
      skipped: true,
      reason: 'handled by caller',
    }))
  } else if (channels.sms && inSession) {
    promises.push(Promise.resolve({
      channel: 'sms',
      skipped: true,
      reason: 'in-session mode enabled',
    }))
  }

  // Slack
  if (channels.slack && prefs.slack_webhook_url) {
    promises.push(
      fetch(prefs.slack_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: message,
          type,
          timestamp: new Date().toISOString(),
        }),
      })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return { channel: 'slack', sent: true }
        })
        .catch(e => ({
          channel: 'slack',
          error: e.message,
        }))
    )
  }

  // Smart Light
  if (channels.smart_light && prefs.smart_light_webhook_url) {
    promises.push(
      fetch(prefs.smart_light_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          type,
          timestamp: new Date().toISOString(),
          practice_id: practiceId,
        }),
      })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return { channel: 'smart_light', sent: true }
        })
        .catch(e => ({
          channel: 'smart_light',
          error: e.message,
        }))
    )
  }

  return Promise.all(promises)
}
