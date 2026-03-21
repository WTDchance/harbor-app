import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const FORMAT_PROMPTS: Record<string, string> = {
  soap: `You are a clinical documentation assistant for a licensed therapist. Reformat the following dictated session note into a professional SOAP note with these exact sections:

**S — Subjective:** What the patient reported, said, or presented (their words, feelings, complaints, self-report)
**O — Objective:** Observable, measurable facts: therapist's observations, behaviors noted, mental status, engagement level, any assessments used
**A — Assessment:** Clinical impression, progress toward goals, interpretation of the session, any risk assessment
**P — Plan:** Interventions used this session, homework assigned, plan for next session, any referrals or follow-up

Write in professional third-person clinical language ("Patient reported...", "Therapist utilized..."). Be concise but clinically complete. If the dictation does not clearly provide content for a section, write what can be reasonably inferred and note [inferred] or leave a brief placeholder. Do not add fabricated clinical details.`,

  dap: `You are a clinical documentation assistant for a licensed therapist. Reformat the following dictated session note into a professional DAP note with these exact sections:

**D — Data:** Objective and subjective information from the session — what the patient reported, how they presented, observable behaviors, affect, and any relevant disclosures
**A — Assessment:** Therapist's clinical interpretation, progress toward treatment goals, clinical impressions, any risk factors noted
**P — Plan:** Interventions used, therapeutic techniques applied, homework or tasks assigned, plan for next session

Write in professional clinical language. Be concise but complete. If the dictation does not clearly provide content for a section, note [to be completed] as a placeholder.`,

  birp: `You are a clinical documentation assistant for a licensed therapist. Reformat the following dictated session note into a professional BIRP note with these exact sections:

**B — Behavior:** Patient's presenting behaviors, affect, mood, and self-reported experiences during the session
**I — Intervention:** Therapeutic interventions, techniques, and approaches used by the therapist during the session
**R — Response:** How the patient responded to the interventions — engagement level, insight gained, emotional response, shifts observed
**P — Plan:** Plan for follow-up, homework assigned, goals for next session, any referrals

Write in professional third-person clinical language. Be concise but clinically accurate.`,

  progress: `You are a clinical documentation assistant for a licensed therapist. Reformat the following dictated session note into a clean, professional progress note structured as flowing paragraphs (not bullet points) with these components naturally integrated:

1. Presenting concerns and patient's report for this session
2. Interventions and techniques used
3. Patient response and progress toward goals
4. Plan and next steps

Write in professional third-person clinical language. The result should read like a polished clinical progress note suitable for a medical record.`
}

export async function POST(req: NextRequest) {
  try {
    const { transcript, format = 'soap' } = await req.json()

    if (!transcript) {
      return NextResponse.json({ error: 'No transcript provided' }, { status: 400 })
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({
        formatted_note: `[Demo mode — add ANTHROPIC_API_KEY to enable AI formatting]\n\n**S — Subjective:**\n${transcript}\n\n**O — Objective:**\n[To be completed]\n\n**A — Assessment:**\n[To be completed]\n\n**P — Plan:**\n[To be completed]`,
        format
      })
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const systemPrompt = FORMAT_PROMPTS[format] || FORMAT_PROMPTS.soap

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: `Please reformat this dictated session note:\n\n${transcript}` }],
      system: systemPrompt
    })

    const formatted_note = message.content[0].type === 'text' ? message.content[0].text : ''
    return NextResponse.json({ formatted_note, format })
  } catch (error: any) {
    console.error('Note formatting error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
