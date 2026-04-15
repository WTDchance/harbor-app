// app/api/admin/bootstrap-password/route.ts
// Harbor — Emergency password reset for the admin account.
//
// POST /api/admin/bootstrap-password
//   Body: { email: string, new_password: string }
//   Auth: Authorization: Bearer <CRON_SECRET>
//
// Uses the service role to set the password directly, bypassing the
// password-reset email (which is currently broken). Only works for the
// configured ADMIN_EMAIL — we do NOT let this be used to take over any
// other user. Logs every attempt to console for audit.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "chancewonser@gmail.com")
  .toLowerCase();

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { email?: string; new_password?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = body.email?.toLowerCase().trim();
  const newPassword = body.new_password;
  if (!email || !newPassword) {
    return NextResponse.json(
      { error: "email and new_password required" },
      { status: 400 }
    );
  }
  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "new_password must be at least 8 chars" },
      { status: 400 }
    );
  }
  if (email !== ADMIN_EMAIL) {
    return NextResponse.json(
      { error: "Only the ADMIN_EMAIL account can be reset via this endpoint" },
      { status: 403 }
    );
  }

  // Look up auth user by email via admin API
  const { data: list, error: listErr } =
    await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listErr) {
    console.error("[bootstrap-password] listUsers error:", listErr);
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }
  const user = list.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) {
    return NextResponse.json({ error: "Admin user not found" }, { status: 404 });
  }

  const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(
    user.id,
    { password: newPassword }
  );
  if (updErr) {
    console.error("[bootstrap-password] update error:", updErr);
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  console.log(
    `[bootstrap-password] Password reset via CRON_SECRET for admin ${email} (id=${user.id}) at ${new Date().toISOString()}`
  );
  return NextResponse.json({ ok: true, email, user_id: user.id });
}
