// app/api/intake/resend/route.ts
// Resend intake forms to a patient via SMS and/or email
// Uses the existing token from the intake_forms record (does not create a new one)

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import twilio from "twilio";
import { sendEmail, buildIntakeEmail } from "@/lib/email";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { intake_form_id, delivery_method } = body;

    if (!intake_form_id) {
      return NextResponse.json(
        { error: "intake_form_id is required" },
        { status: 400 }
      );
    }

    // Look up the intake form with its existing token
    const { data: form, error: formError } = await supabaseAdmin
      .from("intake_forms")
      .select(
        "id, token, practice_id, patient_id, patient_name, patient_phone, patient_email, status"
      )
      .eq("id", intake_form_id)
      .single();

    if (formError || !form) {
      return NextResponse.json(
        { error: "Intake form not found" },
        { status: 404 }
      );
    }

    if (!form.token) {
      return NextResponse.json(
        { error: "Intake form has no token - cannot resend" },
        { status: 400 }
      );
    }

    // Get practice info for the message
    const { data: practice } = await supabaseAdmin
      .from("practices")
      .select("name, ai_name")
      .eq("id", form.practice_id)
      .single();

    if (!practice) {
      return NextResponse.json(
        { error: "Practice not found" },
        { status: 404 }
      );
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://harborreceptionist.com";
    const intakeUrl = `${baseUrl}/intake/${form.token}`;
    const practiceName = practice.name || "the practice";
    const firstName = form.patient_name?.split(" ")[0] || "there";

    let smsSent = false;
    let emailSent = false;
    const method = delivery_method || "sms";

    // Send via SMS
    if ((method === "sms" || method === "both") && form.patient_phone) {
      try {
        const client = twilio(
          process.env.TWILIO_ACCOUNT_SID!,
          process.env.TWILIO_AUTH_TOKEN!
        );
        const phone = form.patient_phone.startsWith("+")
          ? form.patient_phone
          : `+1${form.patient_phone.replace(/\\D/g, "")}`;

        await client.messages.create({
          body: `Hi ${firstName}! ${practiceName} has resent your intake forms. Please complete them when you get a chance: ${intakeUrl}`,
          from: process.env.TWILIO_PHONE_NUMBER!,
          to: phone,
        });
        smsSent = true;
        console.log(`[Intake Resend] SMS sent to ${phone}`);
      } catch (err) {
        console.error("[Intake Resend] SMS failed:", err);
      }
    }

    // Send via email
    if ((method === "email" || method === "both") && form.patient_email) {
      try {
        const emailHtml = buildIntakeEmail({
          firstName,
          practiceName,
          intakeUrl,
        });
        await sendEmail({
          to: form.patient_email,
          subject: `${practiceName} - Complete Your Intake Forms`,
          html: emailHtml,
        });
        emailSent = true;
        console.log(`[Intake Resend] Email sent to ${form.patient_email}`);
      } catch (err) {
        console.error("[Intake Resend] Email failed:", err);
      }
    }

    if (!smsSent && !emailSent) {
      return NextResponse.json(
        {
          error:
            "Failed to send via any method. Check that the patient has a phone number or email on file.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      sms_sent: smsSent,
      email_sent: emailSent,
    });
  } catch (err) {
    console.error("[Intake Resend] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
