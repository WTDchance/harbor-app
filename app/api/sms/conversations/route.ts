// app/api/sms/conversations/route.ts
// Harbor - SMS Conversations API
// GET: List all SMS conversations for the authenticated user's practice
// Returns conversations with patient name lookups and message previews

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getEffectivePracticeId } from "@/lib/active-practice";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/sms/conversations
 * Returns all SMS conversations for the practice, enriched with patient names.
 *
 * Query params:
 *   - limit (optional, default 50)
 *   - offset (optional, default 0)
 *
 * Response: { conversations: [...], total: number }
 */
export async function GET(request: NextRequest) {
  try {
    // Auth: extract user from Authorization header
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.replace("Bearer ", "");

    // Verify the JWT and get user
    const supabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get the user's practice_id (admin may override via act-as cookie)
    const practiceId = await getEffectivePracticeId(supabaseAdmin, user);
    if (!practiceId) {
      return NextResponse.json(
        { error: "No practice found for user" },
        { status: 403 }
      );
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const offset = parseInt(searchParams.get("offset") || "0");

    // Fetch conversations for this practice
    const { data: conversations, error: convError } = await supabaseAdmin
      .from("sms_conversations")
      .select("*")
      .eq("practice_id", practiceId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (convError) {
      console.error("Error fetching conversations:", convError);
      return NextResponse.json(
        { error: "Failed to fetch conversations" },
        { status: 500 }
      );
    }

    // Get total count
    const { count: total } = await supabaseAdmin
      .from("sms_conversations")
      .select("*", { count: "exact", head: true })
      .eq("practice_id", practiceId);

    // Collect unique phone numbers to batch-lookup patient names
    const phoneNumbers = [
      ...new Set(
        (conversations || []).map((c) => c.patient_phone).filter(Boolean)
      ),
    ];

    // Batch fetch patient records
    let patientMap = {};
    if (phoneNumbers.length > 0) {
      const { data: patients } = await supabaseAdmin
        .from("patients")
        .select("id, first_name, last_name, phone")
        .eq("practice_id", practiceId)
        .in("phone", phoneNumbers);

      if (patients) {
        for (const p of patients) {
          if (p.phone) {
            patientMap[p.phone] = {
              id: p.id,
              first_name: p.first_name || "",
              last_name: p.last_name || "",
            };
          }
        }
      }
    }

    // Enrich conversations with patient info and last message preview
    const enriched = (conversations || []).map((conv) => {
      const messages = conv.messages_json || [];
      const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
      const patient = patientMap[conv.patient_phone] || null;

      return {
        id: conv.id,
        patient_phone: conv.patient_phone,
        patient_name: patient
          ? `${patient.first_name} ${patient.last_name}`.trim()
          : null,
        patient_id: patient?.id || null,
        message_count: messages.length,
        last_message_preview: lastMessage
          ? lastMessage.content?.substring(0, 120) +
            (lastMessage.content?.length > 120 ? "..." : "")
          : null,
        last_message_direction: lastMessage?.direction || null,
        last_message_at: conv.last_message_at,
        created_at: conv.created_at,
        messages: messages,
      };
    });

    return NextResponse.json({
      conversations: enriched,
      total: total || 0,
    });
  } catch (error) {
    console.error("SMS conversations API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
