// app/api/admin/act-as/route.ts
// Harbor — Super-admin "Act as Practice" endpoint.
//
// POST { practiceId: string }  → sets the harbor_act_as_practice cookie so
//   subsequent requests resolve that practice_id via getEffectivePracticeId().
// DELETE                        → clears the cookie (exit admin view).
//
// Admin-only: the authenticated user's email must match ADMIN_EMAIL.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { ACT_AS_COOKIE } from "@/lib/active-practice";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "chancewonser@gmail.com")
  .toLowerCase();

async function authAdmin(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user?.email) return null;
  if (user.email.toLowerCase() !== ADMIN_EMAIL) return null;
  return user;
}

export async function POST(req: NextRequest) {
  const admin = await authAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { practiceId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const practiceId = body.practiceId?.trim();
  if (!practiceId) {
    return NextResponse.json({ error: "practiceId required" }, { status: 400 });
  }

  const { data: practice } = await supabase
    .from("practices")
    .select("id, name")
    .eq("id", practiceId)
    .maybeSingle();

  if (!practice) {
    return NextResponse.json({ error: "Practice not found" }, { status: 404 });
  }

  const res = NextResponse.json({ ok: true, practice });
  res.cookies.set(ACT_AS_COOKIE, practice.id, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours
  });
  return res;
}

export async function DELETE(req: NextRequest) {
  const admin = await authAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACT_AS_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

export async function GET(req: NextRequest) {
  const admin = await authAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const cookie = req.cookies.get(ACT_AS_COOKIE)?.value || null;
  if (!cookie) return NextResponse.json({ practiceId: null, practice: null });
  const { data: practice } = await supabase
    .from("practices")
    .select("id, name")
    .eq("id", cookie)
    .maybeSingle();
  return NextResponse.json({ practiceId: cookie, practice });
}
