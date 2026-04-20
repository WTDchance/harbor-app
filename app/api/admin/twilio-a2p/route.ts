// Admin Twilio A2P bind/diagnose endpoint.
//
// GET  /api/admin/twilio-a2p  -> { services: [...], numbers: [...], incoming_phone_numbers: [...] }
//   Lists Messaging Services (+ their attached phone numbers and A2P campaign SIDs)
//   and the account's full phone-number inventory.
//
// POST /api/admin/twilio-a2p
//   Body: { messaging_service_sid: "MG...", phone_number_sid: "PN..." }
//   Attaches the given phone-number SID to the given Messaging Service pool.
//
// POST /api/admin/twilio-a2p?action=attach_by_number
//   Body: { messaging_service_sid: "MG...", phone_number: "+15415023993" }
//   Same as above but looks up the PN sid by E.164 first (saves a round trip).
//
// Guarded by CRON_SECRET.

import { NextRequest, NextResponse } from "next/server"

const BASE = "https://api.twilio.com/2010-04-01"
const MSG_V1 = "https://messaging.twilio.com/v1"

function authHeader(): { Authorization: string } | null {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  const b64 = Buffer.from(sid + ":" + token).toString("base64")
  return { Authorization: "Basic " + b64 }
}

async function tw(path: string, init?: RequestInit) {
  const auth = authHeader()
  if (!auth) throw new Error("Twilio credentials not configured")
  const url = path.startsWith("http") ? path : MSG_V1 + path
  const resp = await fetch(url, {
    ...init,
    headers: { ...(init?.headers || {}), ...auth },
  })
  const json: any = await resp.json().catch(() => ({}))
  return { ok: resp.ok, status: resp.status, json }
}

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") || ""
  const expected = "Bearer " + (process.env.CRON_SECRET || "")
  return !!process.env.CRON_SECRET && auth === expected
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // 1. All Messaging Services
  const servicesRes = await tw("/Services?PageSize=50")
  if (!servicesRes.ok) return NextResponse.json({ error: "failed to list services", detail: servicesRes.json }, { status: 502 })
  const services = servicesRes.json?.services || []

  // For each service, fetch its phone-number pool + campaign
  const detailed = await Promise.all(
    services.map(async (s: any) => {
      const [phones, campaigns] = await Promise.all([
        tw("/Services/" + s.sid + "/PhoneNumbers?PageSize=50"),
        tw("/Services/" + s.sid + "/Compliance/Usa2p?PageSize=50"),
      ])
      return {
        sid: s.sid,
        friendly_name: s.friendly_name,
        usecase: s.usecase,
        use_inbound_webhook_on_number: s.use_inbound_webhook_on_number,
        phone_numbers: (phones.json?.phone_numbers || []).map((p: any) => ({
          sid: p.sid,
          phone_number: p.phone_number,
          country_code: p.country_code,
        })),
        a2p_campaigns: (campaigns.json?.compliance || []).map((c: any) => ({
          sid: c.sid,
          brand_registration_sid: c.brand_registration_sid,
          campaign_status: c.campaign_status,
          use_case: c.use_case,
          description: c.description,
        })),
      }
    })
  )

  // 2. All incoming phone numbers on the account
  const sid = process.env.TWILIO_ACCOUNT_SID
  const numbersRes = await tw(BASE + "/Accounts/" + sid + "/IncomingPhoneNumbers.json?PageSize=50")
  const incoming = (numbersRes.json?.incoming_phone_numbers || []).map((n: any) => ({
    sid: n.sid,
    phone_number: n.phone_number,
    friendly_name: n.friendly_name,
    sms_application_sid: n.sms_application_sid,
    sms_url: n.sms_url,
    voice_url: n.voice_url,
  }))

  return NextResponse.json({
    services: detailed,
    incoming_phone_numbers: incoming,
  })
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const action = req.nextUrl.searchParams.get("action") || "attach"

  if (action === "move" || action === "move_by_number") {
    // Move a phone number OUT of every other Messaging Service sender pool
    // and INTO the specified one. Required after a campaign approval attaches
    // the campaign to a different MS than where the numbers currently live
    // (Twilio error 21712 on direct attach).
    const targetSid = body?.messaging_service_sid
    let phoneSid: string | undefined = body?.phone_number_sid
    if (!targetSid) return NextResponse.json({ error: "messaging_service_sid required" }, { status: 400 })

    if (!phoneSid && action === "move_by_number") {
      const e164 = body?.phone_number
      if (!e164) return NextResponse.json({ error: "phone_number required" }, { status: 400 })
      const acct = process.env.TWILIO_ACCOUNT_SID
      const r = await tw(BASE + "/Accounts/" + acct + "/IncomingPhoneNumbers.json?PhoneNumber=" + encodeURIComponent(e164))
      const match = (r.json?.incoming_phone_numbers || [])[0]
      if (!match) return NextResponse.json({ error: "phone_number not found on account: " + e164 }, { status: 404 })
      phoneSid = match.sid
    }
    if (!phoneSid) return NextResponse.json({ error: "phone_number_sid required" }, { status: 400 })

    // 1. Find every other Messaging Service that currently holds this PN.
    const servicesRes = await tw("/Services?PageSize=50")
    const services = servicesRes.json?.services || []
    const removedFrom: string[] = []
    for (const s of services) {
      if (s.sid === targetSid) continue
      const poolRes = await tw("/Services/" + s.sid + "/PhoneNumbers?PageSize=50")
      const pool = poolRes.json?.phone_numbers || []
      const has = pool.some((p: any) => p.sid === phoneSid)
      if (has) {
        const delRes = await tw("/Services/" + s.sid + "/PhoneNumbers/" + phoneSid, { method: "DELETE" })
        if (!delRes.ok) {
          return NextResponse.json({ ok: false, step: "detach", from: s.sid, error: delRes.json }, { status: 502 })
        }
        removedFrom.push(s.sid)
      }
    }

    // 2. Attach to target service.
    const form = new URLSearchParams()
    form.set("PhoneNumberSid", phoneSid)
    const addRes = await tw("/Services/" + targetSid + "/PhoneNumbers", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    })
    if (!addRes.ok) return NextResponse.json({ ok: false, step: "attach", error: addRes.json }, { status: 502 })
    return NextResponse.json({ ok: true, detached_from: removedFrom, attached: addRes.json })
  }

  if (action === "attach" || action === "attach_by_number") {
    const serviceSid = body?.messaging_service_sid
    let phoneSid: string | undefined = body?.phone_number_sid
    if (!serviceSid) return NextResponse.json({ error: "messaging_service_sid required" }, { status: 400 })

    if (!phoneSid && action === "attach_by_number") {
      const e164 = body?.phone_number
      if (!e164) return NextResponse.json({ error: "phone_number required" }, { status: 400 })
      const sid = process.env.TWILIO_ACCOUNT_SID
      const r = await tw(BASE + "/Accounts/" + sid + "/IncomingPhoneNumbers.json?PhoneNumber=" + encodeURIComponent(e164))
      const match = (r.json?.incoming_phone_numbers || [])[0]
      if (!match) return NextResponse.json({ error: "phone_number not found on account: " + e164 }, { status: 404 })
      phoneSid = match.sid
    }
    if (!phoneSid) return NextResponse.json({ error: "phone_number_sid required" }, { status: 400 })

    const form = new URLSearchParams()
    form.set("PhoneNumberSid", phoneSid)
    const r = await tw("/Services/" + serviceSid + "/PhoneNumbers", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    })
    if (!r.ok) return NextResponse.json({ ok: false, status: r.status, error: r.json }, { status: 502 })
    return NextResponse.json({ ok: true, attached: r.json })
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
