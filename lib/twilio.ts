// Twilio client and helper functions for SMS and voice
// Handles sending SMS messages and managing phone numbers

import twilio from 'twilio'

const accountSid = process.env.TWILIO_ACCOUNT_SID || ''
const authToken = process.env.TWILIO_AUTH_TOKEN || ''
const fromNumber = process.env.TWILIO_PHONE_NUMBER || ''

if (!accountSid || !authToken || !fromNumber) {
  console.warn('⚠️ Twilio environment variables not configured. SMS operations will fail.')
}

// Initialize Twilio client
// This requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN
const twilioClient = accountSid && authToken
  ? twilio(accountSid, authToken)
  : null

/**
 * Send an SMS message via Twilio
 * Used for appointment confirmations, reminders, and SMS replies
 *
 * @param toNumber - Recipient phone number (e.g., '+15551234567')
 * @param body - Message content (max 160 chars for best results)
 * @returns Message SID if successful, null if failed
 */
export async function sendSMS(
  toNumber: string,
  body: string
): Promise<string | null> {
  if (!twilioClient) {
    console.warn('⚠️ Twilio not configured - SMS not sent')
    return null
  }

  try {
    const message = await twilioClient.messages.create({
      from: fromNumber,
      to: toNumber,
      body: body,
    })

    console.log(`✓ SMS sent to ${toNumber}: ${message.sid}`)
    return message.sid
  } catch (error) {
    console.error('Error sending SMS:', error)
    throw error
  }
}

/**
 * Send SMS from a specific Twilio number (for multi-number setups)
 *
 * @param fromTwilioNumber - Twilio number to send from
 * @param toNumber - Recipient phone number
 * @param body - Message content
 */
export async function sendSMSFromNumber(
  fromTwilioNumber: string,
  toNumber: string,
  body: string
): Promise<string | null> {
  if (!twilioClient) {
    console.warn('⚠️ Twilio not configured - SMS not sent')
    return null
  }

  try {
    const message = await twilioClient.messages.create({
      from: fromTwilioNumber,
      to: toNumber,
      body: body,
    })

    console.log(`✓ SMS sent from ${fromTwilioNumber} to ${toNumber}`)
    return message.sid
  } catch (error) {
    console.error('Error sending SMS:', error)
    throw error
  }
}

/**
 * List all Twilio phone numbers for a practice
 * Used to find which practice owns an incoming SMS
 */
export async function listPhoneNumbers() {
  if (!twilioClient) {
    console.warn('⚠️ Twilio not configured')
    return []
  }

  try {
    const incomingPhoneNumbers = await twilioClient
      .incomingPhoneNumbers.list()

    return incomingPhoneNumbers.map((number) => ({
      sid: number.sid,
      phoneNumber: number.phoneNumber,
      friendlyName: number.friendlyName,
      smsUrl: number.smsUrl,
    }))
  } catch (error) {
    console.error('Error listing phone numbers:', error)
    return []
  }
}

/**
 * Get Twilio webhook URL for a given number
 * Useful for configuring which endpoint receives SMS
 */
export async function getPhoneNumberWebhook(phoneNumberSid: string) {
  if (!twilioClient) {
    console.warn('⚠️ Twilio not configured')
    return null
  }

  try {
    const incomingPhoneNumber = await twilioClient
      .incomingPhoneNumbers(phoneNumberSid)
      .fetch()

    return {
      phoneNumber: incomingPhoneNumber.phoneNumber,
      smsUrl: incomingPhoneNumber.smsUrl,
      smsMethod: incomingPhoneNumber.smsMethod,
    }
  } catch (error) {
    console.error('Error getting phone number webhook:', error)
    return null
  }
}

/**
 * Update Twilio phone number webhook
 * This is called during practice setup to route SMS to our app
 */
export async function updatePhoneNumberWebhook(
  phoneNumberSid: string,
  smsUrl: string,
  smsMethod: 'GET' | 'POST' = 'POST'
) {
  if (!twilioClient) {
    console.warn('⚠️ Twilio not configured - webhook not updated')
    return false
  }

  try {
    await twilioClient
      .incomingPhoneNumbers(phoneNumberSid)
      .update({
        smsUrl: smsUrl,
        smsMethod: smsMethod,
      })

    console.log(`✓ Updated SMS webhook for ${phoneNumberSid}`)
    return true
  } catch (error) {
    console.error('Error updating phone number webhook:', error)
    throw error
  }
}

/**
 * Generate TwiML response for SMS
 * Used in API routes to tell Twilio how to respond
 *
 * @param message - Message to send back
 */
export function generateSMSResponse(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(message)}</Message>
</Response>`
}

/**
 * Helper to escape XML special characters
 * Important for SMS message bodies
 */
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/[<]/g, '&lt;')
    .replace(/[>]/g, '&gt;')
    .replace(/[&]/g, '&amp;')
    .replace(/['"]/g, '&quot;')
}

/**
 * Format phone number to E.164 format (required by Twilio)
 * E.164: +[country code][number], e.g., +15551234567
 */
export function formatPhoneNumber(phone: string): string {
  // Remove any non-digit characters
  const digits = phone.replace(/\D/g, '')

  // Add +1 if it's 10 digits (US/Canada)
  if (digits.length === 10) {
    return `+1${digits}`
  }

  // If already 11 digits (with leading 1), add +
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  }

  // If already in correct format
  if (digits.length >= 11) {
    return `+${digits}`
  }

  // Fallback - return as-is with +
  return `+${digits}`
}

/**
 * Extract phone number from Twilio webhook payload
 * Standard Twilio SMS webhook payload
 */
export function extractPhoneFromTwilioPayload(payload: Record<string, any>): {
  from: string
  to: string
  body: string
  messageSid: string
} {
  return {
    from: payload.From || '',
    to: payload.To || '',
    body: payload.Body || '',
    messageSid: payload.MessageSid || '',
  }
}
