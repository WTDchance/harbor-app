// Appointment reminder email. Sent via SES through lib/aws/ses (was Resend).

import { sendViaSes } from './aws/ses'

const REPLY_TO_DEFAULT = process.env.RESEND_FROM_EMAIL || 'Harbor <noreply@harborreceptionist.com>'

interface ReminderEmailParams {
  patientFirstName: string
  practiceName: string
  appointmentDate: string
  appointmentTime?: string
  providerName?: string
  practicePhone?: string
  practiceAddress?: string
}

export async function sendReminderEmail(
  to: string,
  params: ReminderEmailParams,
): Promise<boolean> {
  const { subject, html, text } = buildReminderEmail(params)
  return sendViaSes({
    to,
    subject,
    html,
    text,
    replyTo: REPLY_TO_DEFAULT,
  })
}

export function buildReminderEmail(params: ReminderEmailParams) {
  const { patientFirstName, practiceName, appointmentDate,
    appointmentTime, providerName, practicePhone, practiceAddress } = params
  const timeDisplay = appointmentTime ? ' at ' + appointmentTime : ''
  const providerDisplay = providerName ? ' with ' + providerName : ''
  const subject = 'Appointment Reminder - ' + practiceName
  const textLines = [
    'Hi ' + patientFirstName + '!', '',
    'This is a friendly reminder that you have an appointment'
      + providerDisplay + ' at ' + practiceName + ' on ' + appointmentDate + timeDisplay + '.', '',
  ]
  if (practiceAddress) textLines.push('Location: ' + practiceAddress)
  if (practicePhone) textLines.push('Questions? Call us at ' + practicePhone)
  textLines.push('', 'We look forward to seeing you!', '- ' + practiceName)
  const text = textLines.join('\n')
  const h: string[] = []
  h.push('<div style="font-family:sans-serif;max-width:600px;margin:0 auto">')
  h.push('<div style="background:#0d5c4b;padding:24px 32px;border-radius:8px 8px 0 0">')
  h.push('<h2 style="color:#fff;margin:0">' + practiceName + '</h2>')
  h.push('<p style="color:#a8d5c8;margin:4px 0 0;font-size:14px">Appointment Reminder</p></div>')
  h.push('<div style="padding:32px;background:#fff;border:1px solid #e5e7eb">')
  h.push('<p>Hi ' + patientFirstName + '!</p>')
  h.push('<p>This is a friendly reminder about your upcoming appointment:</p>')
  h.push('<div style="background:#f0f7f4;border-left:4px solid #0d5c4b;padding:16px;margin:16px 0;border-radius:4px">')
  h.push('<strong style="color:#0d5c4b">' + appointmentDate + timeDisplay + '</strong>')
  if (providerName) h.push('<br/>Provider: ' + providerName)
  if (practiceAddress) h.push('<br/>Location: ' + practiceAddress)
  h.push('</div>')
  if (practicePhone) h.push('<p style="color:#666;font-size:14px">Need to reschedule? Call <a href="tel:' + practicePhone + '" style="color:#0d5c4b">' + practicePhone + '</a></p>')
  h.push('<p>We look forward to seeing you!</p></div>')
  h.push('<div style="padding:16px 32px;background:#f9fafb;border-radius:0 0 8px 8px;text-align:center">')
  h.push('<p style="color:#666;font-size:12px;margin:0;font-weight:600">' + practiceName + '</p>')
  if (practicePhone) h.push('<p style="color:#666;font-size:12px;margin:2px 0 0">' + practicePhone + '</p>')
  if (practiceAddress) h.push('<p style="color:#666;font-size:12px;margin:2px 0 0">' + practiceAddress + '</p>')
  h.push('<p style="color:#999;font-size:11px;margin:8px 0 0">Sent by Harbor on behalf of ' + practiceName + '</p>')
  h.push('</div></div>')
  const html = h.join('\n')
  return { subject, html, text }
}
