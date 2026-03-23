// Email notification helpers
// Uses AWS SES for sending emails (HIPAA-compliant, PHI-free email bodies)
// Requires env vars: AWS_SES_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SES_FROM_EMAIL

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'

const sesClient = new SESClient({
    region: process.env.AWS_SES_REGION || 'us-east-1',
    credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
})

const FROM_EMAIL = process.env.AWS_SES_FROM_EMAIL || 'harbor@harborreceptionist.com'

interface EmailPayload {
    to: string
    subject: string
    html: string
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
    try {
          const command = new SendEmailCommand({
                  Source: FROM_EMAIL,
                  Destination: {
                            ToAddresses: [payload.to],
                  },
                  Message: {
                            Subject: {
                                        Data: payload.subject,
                                        Charset: 'UTF-8',
                            },
                            Body: {
                                        Html: {
                                                      Data: payload.html,
                                                      Charset: 'UTF-8',
                                        },
                            },
                  },
          })

      await sesClient.send(command)
          console.log(`✓ Email sent to ${payload.to}: ${payload.subject}`)
          return true
    } catch (error) {
          console.error('Email error:', error)
          return false
    }
}

// PHI-free call summary notification — no phone numbers, transcript, or summary in email body
export function buildCallSummaryEmail(opts: {
    practiceName: string
    crisisDetected?: boolean
}): { subject: string; html: string } {
    const subject = opts.crisisDetected
      ? '🚨 CRISIS ALERT — New call handled by Ellie'
          : 'New call handled by Ellie'

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.harborreceptionist.com'
    const dashboardLink = `${appUrl}/dashboard/calls`
    const headerBg = opts.crisisDetected ? '#DC3545' : '#6B8F71'

  const html = `<!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f0; margin: 0; padding: 20px; }
  .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .header { background: ${headerBg}; padding: 24px 32px; color: white; }
  .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
  .body { padding: 32px; font-size: 15px; line-height: 1.7; color: #333; }
  .button { display: inline-block; background: ${headerBg}; color: white !important; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px; }
  .footer { padding: 20px 32px; background: #f9f9f7; font-size: 12px; color: #999; text-align: center; }
  </style></head>
  <body>
  <div class="container">
    <div class="header">
        <h1>${opts.crisisDetected ? '🚨' : '📞'} ${subject}</h1>
          </div>
            <div class="body">
                <p>Ellie handled a new call for <strong>${opts.practiceName}</strong>.</p>
                    ${opts.crisisDetected ? '<p><strong>⚠️ Crisis keywords were detected during this call. Please review immediately.</strong></p>' : ''}
                        <p>Log in to view the full summary and transcript: <a href="${dashboardLink}">${dashboardLink}</a></p>
                            <a href="${dashboardLink}" class="button">View Call Details →</a>
                              </div>
                                <div class="footer">Sent by Ellie · Harbor AI Receptionist · <a href="https://harborreceptionist.com">harborreceptionist.com</a></div>
                                </div>
                                </body>
                                </html>`

  return { subject, html }
}

// PHI-free cancellation notification — no patient name or appointment details in email body
export function buildCancellationEmail(opts: {
    practiceName: string
}): { subject: string; html: string } {
    const subject = 'Cancellation request received'
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.harborreceptionist.com'
    const dashboardLink = `${appUrl}/dashboard/appointments`

  const html = `<!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f0; margin: 0; padding: 20px; }
  .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .header { background: #E8A87C; padding: 24px 32px; color: white; }
  .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
  .body { padding: 32px; font-size: 15px; line-height: 1.7; color: #333; }
  .button { display: inline-block; background: #E8A87C; color: white !important; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px; }
  .footer { padding: 20px 32px; background: #f9f9f7; font-size: 12px; color: #999; text-align: center; }
  </style></head>
  <body>
  <div class="container">
    <div class="header">
        <h1>📅 Cancellation Request Received</h1>
          </div>
            <div class="body">
                <p>A patient has submitted a cancellation request for <strong>${opts.practiceName}</strong>.</p>
                    <p>Log in to review: <a href="${dashboardLink}">${dashboardLink}</a></p>
                        <a href="${dashboardLink}" class="button">View Appointments →</a>
                          </div>
                            <div class="footer">Sent by Ellie · Harbor AI Receptionist</div>
                            </div>
                            </body>
                            </html>`

  return { subject, html }
}
