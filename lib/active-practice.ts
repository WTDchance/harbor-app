// lib/active-practice.ts
// Harbor — Super-admin "Act as Practice" helper.
//
// Resolves the effective practice_id for a request. When the authenticated
// user is the admin (email === ADMIN_EMAIL) AND a `harbor_act_as_practice`
// cookie is set, that cookie's practice_id is returned instead of the user's
// own practice_id. Otherwise, falls back to the user's practice_id from the
// `users` table.
//
// This lets Chance (admin) view and operate any practice's dashboard without
// switching accounts. Non-admin users are unaffected — the cookie is ignored
// for them, so it's safe even if set.

import { cookies } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export const ACT_AS_COOKIE = "harbor_act_as_practice";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "chancewonser@gmail.com")
  .toLowerCase();

function isAdmin(user: User | null | undefined): boolean {
  return !!user?.email && user.email.toLowerCase() === ADMIN_EMAIL;
}

/**
 * Resolve the effective practice_id for this request.
 * Returns null if no practice can be resolved.
 */
export async function getEffectivePracticeId(
  supabase: SupabaseClient,
  user: User | null | undefined
): Promise<string | null> {
  if (!user) return null;

  // Admin override via cookie
  if (isAdmin(user)) {
    try {
      const cookieStore = await cookies();
      const override = cookieStore.get(ACT_AS_COOKIE)?.value;
      if (override) {
        // Verify the practice exists to avoid acting on bad data
        const { data: practice } = await supabase
          .from("practices")
          .select("id")
          .eq("id", override)
          .maybeSingle();
        if (practice?.id) return practice.id;
      }
    } catch {
      // cookies() may fail in rare contexts — fall through to users lookup
    }
  }

  const { data: userRecord } = await supabase
    .from("users")
    .select("practice_id")
    .eq("id", user.id)
    .maybeSingle();

  return userRecord?.practice_id ?? null;
}

/**
 * Returns { practiceId, isImpersonating } — isImpersonating is true when the
 * admin has an act-as cookie set to a practice that is NOT their own.
 */
export async function getActivePracticeContext(
  supabase: SupabaseClient,
  user: User | null | undefined
): Promise<{ practiceId: string | null; isImpersonating: boolean }> {
  const practiceId = await getEffectivePracticeId(supabase, user);
  if (!practiceId || !isAdmin(user)) {
    return { practiceId, isImpersonating: false };
  }
  try {
    const cookieStore = await cookies();
    const override = cookieStore.get(ACT_AS_COOKIE)?.value;
    return { practiceId, isImpersonating: !!override && override === practiceId };
  } catch {
    return { practiceId, isImpersonating: false };
  }
}

export function isAdminUser(user: User | null | undefined): boolean {
  return isAdmin(user);
}

/**
 * Convenience helper for API routes that use the service-role client +
 * Bearer-token auth pattern. Resolves the effective practice_id given the
 * already-authenticated user, consulting the act-as cookie when the user
 * is the admin.
 */
export async function resolvePracticeIdForApi(
  supabase: SupabaseClient,
  user: User
): Promise<string | null> {
  return getEffectivePracticeId(supabase, user);
}
