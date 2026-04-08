// Welcome email sent after a new practice completes Stripe checkout and
// provisioning (Twilio + Vapi). Separate from lib/email.ts so the diff for
// this PR is additive only.

import { sendEmail, EMAIL_SUPPORT } from './email'

export interface WelcomeEmailOpts {
  to: string
  practiceName: string
  aiName: string
  phoneNumber: string
  foundingMember: boolean
  dashboardUrl?: string
}

function formatPhoneForDisplay(e164: string): string {
  // +15415394890 → (541) 539-4890
  const m = e164.replace(/\D/g, '').match(/^1?(\d{3})(\d{3})(\d{4})$/)
  if (!m) return e164
  return `(${m[1]}) ${m[2]}-${m[3]}`
}

export async function sendWelcomeEmail(opts: WelcomeEmailOpts): Promise<boolean> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
  const dashboardUrl = opts.dashboardUrl || `${appUrl}/dashboard?welcome=1`
  const prettyNumber = formatPhoneForDisplay(opts.phoneNumber)
  const foundingBadge = opts.foundingMember
    ? `<div style="display:inline-block; background:#fde68a; color:#92400e; font-weight:600; font-size:12px; padding:4px 12px; border-radius:999px; margin-bottom:16px;">🎯 Founding Practice — $197/mo locked in forever</div>`
    : ''

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Welcome to Harbor</title><style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f0; margin: 0; padding: 20px; color: #1f2937; }
.container { max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.08); }
.header { background: linear-gradient(135deg, #0d9488 0%, #065f46 100%); padding: 36px 32px; color: white; text-align: center; }
.header h1 { margin: 0 0 8px; font-size: 28px; font-weight: 700; }
.header p { margin: 0; opacity: 0.9; font-size: 15px; }
.body { padding: 36px 32px; font-size: 15px; line-height: 1.7; }
.phone-card { background: #f0fdfa; border: 2px solid #0d9488; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0; }
.phone-card .label { text-transform: uppercase; font-size: 11px; color: #0f766e; font-weight: 700; letter-spacing: 1px; margin-bottom: 6px; }
.phone-card .number { font-size: 28px; font-weight: 700; color: #134e4a; margin-bottom: 8px; letter-spacing: -0.5px; }
.phone-card .note { font-size: 13px; color: #64748b; }
.button { display: inline-block; background: #0d9488; color: white !important; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 15px; margin-top: 8px; }
h2 { font-size: 18px; margin: 28px 0 12px; color: #134e4a; }
ul { padding-left: 20px; margin: 12px 0; }
li { margin-bottom: 8px; }
.footer { padding: 24px 32px; background: #f9fafb; font-size: 12px; color: #9ca3af; text-align: center; border-top: 1px solid #f3f4f6; }
.footer a { color: #0d9488; text-decoration: none; }
</style></head>
<body>
<div class="container">
  <div class="header">
    <h1>Welcome to Harbor! 🎉</h1>
    <p>${opts.aiName} is live and answering calls for ${opts.practiceName}</p>
  </div>
  <div class="body">
    ${foundingBadge}
    <p>Hi there — your Harbor account is fully set up and ready to go. ${opts.aiName} has been briefed on your practice and is standing by 24/7 to answer calls, screen new patients, and book appointments.</p>

    <div class="phone-card">
      <div class="label">Your Harbor phone number</div>
      <div class="number">${prettyNumber}</div>
      <div class="note">Forward your existing line here, or give this number out directly to patients.</div>
    </div>

    <h2>Your first 10 minutes</h2>
    <ul>
      <li><strong>Test the line.</strong> Call ${prettyNumber} from your cell. Say "I'd like to schedule an appointment" — you'll hear ${opts.aiName} in action.</li>
      <li><strong>Connect your calendar.</strong> Head to <a href="${appUrl}/dashboard/settings">Dashboard → Settings</a> and connect Google Calendar so ${opts.aiName} can book real appointments.</li>
      <li><strong>Review your intake forms.</strong> Customize the starter HIPAA, informed consent, and telehealth templates from <a href="${appUrl}/dashboard/intake/documents">Dashboard → Intake → Documents</a>.</li>
      <li><strong>Forward your existing number.</strong> If you have a legacy practice line, set it to forward to ${prettyNumber} so no calls are missed.</li>
    </ul>

    <h2>How it works from here</h2>
    <p>After every call, you'll get an email summary here with transcript, caller details, PHQ-2/GAD-2 scores (if new patient), and any appointment requests. Crisis calls trigger an immediate red-flag alert. Everything lives in your dashboard in real time.</p>

    <div style="text-align:center; margin-top: 32px;">
      <a href="${dashboardUrl}" class="button">Open My Dashboard →</a>
    </div>

    <p style="margin-top: 32px; font-size: 13px; color: #6b7280;">
      Need help? Just reply to this email — it goes straight to our support team.
    </p>
  </div>
  <div class="footer">
    <p>Harbor · AI Receptionist for Therapy Practices<br>
    <a href="https://harborreceptionist.com">harborreceptionist.com</a></p>
  </div>
</div>
</body>
</html>`

  return sendEmail({
    to: opts.to,
    subject: `Welcome to Harbor — ${opts.aiName} is live for ${opts.practiceName}`,
    html,
    from: EMAIL_SUPPORT,
  })
}
