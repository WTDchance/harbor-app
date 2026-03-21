// Email notification helpers
// Uses Resend (or falls back to basic fetch) for sending emails
// Set RESEND_API_KEY env var to enable. Falls back to console.log if not set.

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.FROM_EMAIL || 'harbor@harborreceptionist.com'

interface EmailPayload {
  to: string
  subject: string
  html: string
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  if (!RESEND_API_KEY) {
    // Fallback: log to console if no email provider configured
    console.log('📧 [EMAIL - no provider configured]')
    console.log(`To: ${payload.to}`)
    console.log(`Subject: ${payload.subject}`)
    return true
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('Email send failed:', err)
      return false
    }

    console.log(`✓ Email sent to ${payload.to}: ${payload.subject}`)
    return true
  } catch (error) {
    console.error('Email error:', error)
    return false
  }
}

export function buildCallSummaryEmail(opts: {
  practiceName: string
  therapistName: string
  callerPhone: string
  duration: number
  summary: string
  transcript: string
  callTime: string
}): string {
  const durationMin = Math.round(opts.duration / 60)
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f0; margin: 0; padding: 20px; }
  .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .header { background: #6B8F71; padding: 24px 32px; color: white; }
  .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
  .header p { margin: 4px 0 0; opacity: 0.85; font-size: 14px; }
  .body { padding: 32px; }
  .meta { display: flex; gap: 24px; margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid #eee; }
  .meta-item label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #999; margin-bottom: 4px; }
  .meta-item value { font-size: 15px; font-weight: 500; color: #222; }
  .section { margin-bottom: 24px; }
  .section h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #6B8F71; margin: 0 0 12px; }
  .summary-box { background: #f9f9f7; border-left: 3px solid #6B8F71; padding: 16px; border-radius: 0 8px 8px 0; font-size: 15px; line-height: 1.6; color: #333; }
  .transcript { background: #f5f5f5; padding: 16px; border-radius: 8px; font-size: 13px; line-height: 1.7; color: #555; white-space: pre-wrap; max-height: 300px; overflow-y: auto; }
  .footer { padding: 20px 32px; background: #f9f9f7; font-size: 12px; color: #999; text-align: center; }
</style></head>
<body>
<div class="container">
  <div class="header">
    <h1>📞 New Call — ${opts.practiceName}</h1>
    <p>Ellie took a call while you were with a patient</p>
  </div>
  <div class="body">
    <div class="meta">
      <div class="meta-item">
        <label>Caller</label>
        <value>${opts.callerPhone}</value>
      </div>
      <div class="meta-item">
        <label>Duration</label>
        <value>${durationMin > 0 ? durationMin + ' min' : '< 1 min'}</value>
      </div>
      <div class="meta-item">
        <label>Time</label>
        <value>${opts.callTime}</value>
      </div>
    </div>

    <div class="section">
      <h2>AI Summary</h2>
      <div class="summary-box">${opts.summary || 'No summary available.'}</div>
    </div>

    ${opts.transcript ? `
    <div class="section">
      <h2>Full Transcript</h2>
      <div class="transcript">${opts.transcript}</div>
    </div>
    ` : ''}
  </div>
  <div class="footer">Sent by Ellie · Harbor AI Receptionist · <a href="https://harborreceptionist.com">harborreceptionist.com</a></div>
</div>
</body>
</html>`
}

export function buildCancellationFillEmail(opts: {
  practiceName: string
  cancelledPatient: string
  slotTime: string
  contactedCount: number
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f0; margin: 0; padding: 20px; }
  .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .header { background: #E8A87C; padding: 24px 32px; color: white; }
  .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
  .body { padding: 32px; font-size: 15px; line-height: 1.7; color: #333; }
  .footer { padding: 20px 32px; background: #f9f9f7; font-size: 12px; color: #999; text-align: center; }
</style></head>
<body>
<div class="container">
  <div class="header">
    <h1>📅 Cancellation — Slot Available</h1>
  </div>
  <div class="body">
    <p><strong>${opts.cancelledPatient}</strong> cancelled their <strong>${opts.slotTime}</strong> appointment.</p>
    <p>Ellie has automatically texted <strong>${opts.contactedCount} patient${opts.contactedCount !== 1 ? 's' : ''}</strong> from the waitlist/high-need list to offer the slot. You'll be notified when someone confirms.</p>
    <p>If no one responds within 2 hours, Ellie will reach out to the next batch.</p>
  </div>
  <div class="footer">Sent by Ellie · Harbor AI Receptionist</div>
</div>
</body>
</html>`
}
