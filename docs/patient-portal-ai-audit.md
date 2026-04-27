# Patient portal — AI safety audit

_Audited 2026-04-26 (Wave 36 + Tier-1 push)._

## Rule

> **No AI on patient-facing surfaces suggesting treatment.** AI in the
> patient portal is restricted to non-clinical UX (e.g., scheduling).

This audit walks `app/portal/*` (rendered pages) and `app/api/portal/*`
(API surface those pages call) and confirms whether any AI-generated
content reaches the patient.

## Method

```
grep -rln "anthropic|bedrock|generateText|claude|openai|gpt-" app/portal app/api/portal
grep -rln "bedrock|invokeModel|@ai-sdk|@anthropic" app/api/portal app/portal
grep -rnE "(generate|suggest|recommend|summary|insight|AI|claude|gpt)" \
      app/portal/*/page.tsx
```

## Findings

**No AI calls reach the patient portal.** Zero matches for any LLM
SDK, vendor name, or "invokeModel"-style call inside `app/portal` or
`app/api/portal`.

The single hit for the word "summary" was a UI label
(`app/portal/home/page.tsx:207`, "Recently-completed assessments
(brief summary)") for displaying questionnaire scores — not AI-generated
content.

## Surfaces present in the portal

| surface          | source                              | clinical AI?     |
|------------------|-------------------------------------|------------------|
| Login            | `app/portal/login/page.tsx`         | no               |
| Home             | `app/portal/home/page.tsx`          | no               |
| Schedule         | `app/portal/schedule/page.tsx`      | no               |
| Homework         | `app/portal/homework/page.tsx`      | no               |
| Mood log         | `app/portal/mood/page.tsx`          | no               |
| Assessments      | `app/portal/assessments/[id]/page.tsx` | no            |
| Messages         | `app/portal/messages/page.tsx`      | no (text passthrough only) |
| Invoices         | `app/portal/invoices/page.tsx`      | no               |
| Superbills       | `app/portal/superbills/page.tsx`    | no               |

The therapist-side AI surfaces (`/api/ehr/notes/draft-from-brief`,
`/api/ehr/patients/[id]/summary`, `/api/ehr/patients/[id]/suggested-goals`,
`/api/ehr/patients/[id]/suggested-diagnoses`) are explicitly behind the
EHR auth boundary (`requireEhrApiSession`) and only reachable from
`/dashboard/*` — never from `/portal/*`.

## Verdict

**Clean.** No clinical AI on patient surfaces. The absolute rule is
honored.

## Watch-outs for future PRs

If a future feature wants to ship "AI-summarized homework feedback" or
"AI-generated session prep notes" *to the patient*, that would breach
the rule and must be either (a) gated behind a therapist authorship/
review step, or (b) restricted to non-clinical UX (scheduling, billing
explanations).

The cheapest mechanical guard would be a single pre-commit grep that
fails if any `app/portal/*` or `app/api/portal/*` file imports from
`@/lib/aws/bedrock` or `@anthropic-ai/sdk`. Worth wiring as a CI check
before opening the portal up to more therapists.
