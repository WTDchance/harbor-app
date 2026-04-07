// Twilio phone-number provisioning helpers used during new-practice signup.
// Kept separate from lib/twilio.ts so the SMS send path stays focused.

import twilio from 'twilio'

const accountSid = process.env.TWILIO_ACCOUNT_SID || ''
const authToken = process.env.TWILIO_AUTH_TOKEN || ''

const client = accountSid && authToken ? twilio(accountSid, authToken) : null

// Map a US state code to a reasonable fallback area code so we can still
// provision even when a practice skips area code / city.
const STATE_AREA_CODE_FALLBACK: Record<string, string> = {
  AL: '205', AK: '907', AZ: '602', AR: '501', CA: '415',
  CO: '303', CT: '203', DE: '302', FL: '305', GA: '404',
  HI: '808', ID: '208', IL: '312', IN: '317', IA: '515',
  KS: '316', KY: '502', LA: '504', ME: '207', MD: '410',
  MA: '617', MI: '313', MN: '612', MS: '601', MO: '314',
  MT: '406', NE: '402', NV: '702', NH: '603', NJ: '201',
  NM: '505', NY: '212', NC: '704', ND: '701', OH: '216',
  OK: '405', OR: '541', PA: '215', RI: '401', SC: '803',
  SD: '605', TN: '615', TX: '512', UT: '801', VT: '802',
  VA: '703', WA: '206', WV: '304', WI: '414', WY: '307',
}

export interface PurchasedNumber {
  phoneNumber: string
  sid: string
}

/**
 * Purchase a Twilio local number for a new practice.
 * Tries to match the practice's state; falls back to any available US local
 * number if nothing in-state is available.
 */
export async function purchaseTwilioNumber(opts: {
  state?: string | null
  areaCode?: string | null
  friendlyName?: string
}): Promise<PurchasedNumber> {
  if (!client) {
    throw new Error('Twilio client not configured - cannot purchase number')
  }

  const areaCode =
    opts.areaCode ||
    (opts.state ? STATE_AREA_CODE_FALLBACK[opts.state.toUpperCase()] : undefined)

  // 1. Search for an available local number.
  let available = await client
    .availablePhoneNumbers('US')
    .local.list({
      areaCode: areaCode ? Number(areaCode) : undefined,
      smsEnabled: true,
      voiceEnabled: true,
      limit: 5,
    })
    .catch(() => [])

  // Fallback: no numbers in-state -> try any local US number.
  if (available.length === 0) {
    available = await client
      .availablePhoneNumbers('US')
      .local.list({ smsEnabled: true, voiceEnabled: true, limit: 5 })
      .catch(() => [])
  }

  if (available.length === 0) {
    throw new Error('No available Twilio numbers to purchase')
  }

  const target = available[0].phoneNumber

  // 2. Purchase it. Point voiceUrl at Vapi so inbound calls route to the
  //    assistant immediately; SMS can be wired up later.
  const purchased = await client.incomingPhoneNumbers.create({
    phoneNumber: target,
    friendlyName: opts.friendlyName || `Harbor - ${target}`,
    voiceUrl: 'https://api.vapi.ai/twilio/inbound_call',
    voiceMethod: 'POST',
  })

  return { phoneNumber: purchased.phoneNumber, sid: purchased.sid }
}

/**
 * Release a previously purchased number - used for rollback if provisioning
 * fails later in the pipeline.
 */
export async function releaseTwilioNumber(sid: string): Promise<void> {
  if (!client) return
  try {
    await client.incomingPhoneNumbers(sid).remove()
  } catch (e) {
    console.error(`Failed to release Twilio number ${sid}:`, e)
  }
}
