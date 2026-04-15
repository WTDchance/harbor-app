// app/api/admin/email-health/route.ts
// Harbor — Email infrastructure diagnostic.
//
// GET /api/admin/email-health  — reports presence of env vars + Resend
//   account/domain status. Safe to expose (no secrets returned).
//
// POST /api/admin/email-health?to=<addr> — sends a test email via the same
//   Resend client our app uses. Auth: Bearer CRON_SECRET (so we can run it
//   without a logged-in admin while we debug the email outage).

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

function authed(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") || "";
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  return !!process.env.CRON_SECRET && auth === expected;
}

async function fetchResendDomains(apiKey: string) {
  const res = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, body };
}

export async function GET(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const env = {
    RESEND_API_KEY_present: !!process.env.RESEND_API_KEY,
    RESEND_API_KEY_prefix: process.env.RESEND_API_KEY?.slice(0, 5) || null,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL || null,
    RESEND_CHANCE_EMAIL: process.env.RESEND_CHANCE_EMAIL || null,
    RESEND_SUPPORT_EMAIL: process.env.RESEND_SUPPORT_EMAIL || null,
    RESEND_SALES_EMAIL: process.env.RESEND_SALES_EMAIL || null,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || null,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL || null,
  };

  let domains: any = { skipped: "no RESEND_API_KEY" };
  if (process.env.RESEND_API_KEY) {
    domains = await fetchResendDomains(process.env.RESEND_API_KEY);
  }

  return NextResponse.json({ env, domains });
}

export async function POST(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const to = url.searchParams.get("to");
  if (!to) {
    return NextResponse.json({ error: "?to= required" }, { status: 400 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: "RESEND_API_KEY not set" },
      { status: 500 }
    );
  }

  const from =
    process.env.RESEND_FROM_EMAIL ||
    process.env.RESEND_SUPPORT_EMAIL ||
    "Support@harborreceptionist.com";

  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from,
    to: [to],
    subject: "Harbor email health check",
    html: `<p>This is a Harbor email diagnostic from ${new Date().toISOString()}.</p>`,
  });

  return NextResponse.json({
    from,
    to,
    sent_at: new Date().toISOString(),
    result,
  });
}
