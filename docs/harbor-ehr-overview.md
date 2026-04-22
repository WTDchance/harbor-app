# Harbor EHR — What We Built

A therapist-specific EHR, built inside Harbor. The product thesis:
**therapists spend more time on paperwork than on patients — Harbor flips that.**

Every feature below is live on the `feature/ehr-v0` branch, isolated from
production, running against the dev database, ready to demo.

---

## Who uses what

Harbor EHR has three audiences. Everything is built with each of their
time in mind.

- **The therapist** (Dr. Trace, mom, every founding member) — sees their
  patient, does the clinical work, documents, signs, bills, and gets home
  on time.
- **The patient** — has a portal they actually use. Fills out assessments.
  Does daily check-ins. Joins telehealth. Signs consents.
- **The practice operator** (which for a solo therapist is the same person,
  but in a group practice is a different human) — sees what's signed, what's
  overdue, what's been billed, who needs what.

---

## The headline features

### For the therapist

**1. AI-drafted progress notes — two ways**
- Talk for 15 seconds. Dictate a few bullet points of what happened in the
  session. Claude turns it into a full SOAP note in clinical language —
  Subjective, Objective, Assessment, Plan, suggested CPT code, provisional
  ICD-10 codes. Therapist reviews, edits, signs.
- For intake calls, Claude reads Ellie's call transcript and drafts the
  intake note directly. Every intake call becomes a documented session
  without the therapist touching a keyboard.

**2. Note templates**
- Six presets: Individual follow-up (SOAP), Initial intake, Couples session
  (DAP), Medication management (DAP), Crisis contact (BIRP), Freeform.
- Picking a template pre-fills structure + suggested CPT.

**3. Voice dictation, everywhere**
- Brief for the AI draft? Talk it, don't type it.
- Works on Chrome via the browser's native speech recognition (zero API
  cost). Works on Safari / iPad via OpenAI Whisper fallback.

**4. Note lifecycle that holds up in audit**
- Status: draft → signed → amended.
- Signed notes are immutable. Content hash recorded on signing.
- Amendments create a linked new row. Original stays untouched. Full
  audit trail of what was first documented vs. what was clarified later.

**5. CPT / ICD-10 pickers**
- Searchable chip-multi-select. Type "anxiety" → F41.1 auto-suggests.
- Free-text entry for anything exotic.
- Note templates pre-suggest the right CPT (90791 for intake, 90834 for
  45-minute individual, 90847 for couples, etc.).

**6. Goal linking**
- Every note shows the active treatment plan's goals as checkboxes.
- "Which goals did this session address?"
- Rolls up into treatment-plan progress over time.

**7. Treatment plans**
- Presenting problem, working diagnoses (ICD-10 picker), goals + measurable
  objectives, frequency, start + review dates.
- One active plan per patient enforced by the database.
- "Active" plans appear on the patient profile at a glance.

**8. Safety plans — Stanley-Brown format**
- Six-step clinical standard: warning signs, internal coping, distraction
  people/places, support contacts, professional contacts, means restriction,
  reasons for living.
- Prominent red-outlined card on the patient profile when active.
- 988 Lifeline explicit in the UI.

**9. Audit log**
- Every view, create, update, delete, sign, amend, AI draft, portal
  submission — logged with who / when / what / details.
- Viewer page in the sidebar with text-search filter.
- What makes Harbor defensible under HIPAA audit.

**10. Data export**
- Full patient record exportable as printable HTML (print → PDF) or JSON.
- Covers demographics, every progress note, all treatment plans, safety
  plans, assessments, appointments, consents, and call log summaries.
- HIPAA right-of-access — required when a patient asks for their record.

---

### For the patient (portal)

**1. Patient portal**
- Patient signs in with a one-time token the therapist generates
  (copy-and-paste link, or SMS when that pipeline is wired).
- Lands in a clean dashboard — no therapist chrome, just their stuff.

**2. Pending assessments, right at the top**
- PHQ-9, GAD-7, PHQ-2, GAD-2, PCL-5 (PTSD), AUDIT-C (alcohol).
- Beautiful, phone-friendly question-by-question UI.
- Progress counter, "All questions answered" confirmation, validated
  submission.
- Auto-scored on submit. Shows score + severity + crisis resources when
  alerts fire.

**3. Daily check-in**
- 30-second mood + anxiety + sleep + optional note.
- Mood history visualized as a mini bar chart after submitting.
- Feeds into the therapist's view.

**4. Upcoming appointments**
- With a "Join video" button when the therapist has started a telehealth
  session for that appointment. One click, in the browser, no installs.

**5. Forms & agreements**
- HIPAA NPP, Informed Consent, Financial Agreement, Telehealth Consent,
  SMS Consent.
- One-click sign: type name, tap Sign. IP + timestamp captured.
- Signed-vs-pending statuses rendered as check / clock / empty circle.

**6. Treatment plan (read-only)**
- Presenting problem, goals, frequency — so the patient knows why they're
  doing what they're doing.

---

### For assessments specifically (this is the differentiator)

No other therapy EHR on the market ships this stack out of the box.

**Full instrument library**
- 6 validated instruments with full, stable question IDs. Easy to extend.

**Patient self-administration via portal**
- Therapist clicks Assign → patient sees it next time they sign in →
  they fill it out → score auto-calculates.
- Versus other EHRs where the therapist has to hand out paper, score it
  manually, and type the result into the system.

**Auto-recurring assignments**
- "Send a PHQ-9 every 4 weeks." Cron takes care of it. Patient just sees
  the new one appear on their portal.
- Cadence: weekly / biweekly / monthly / every 8 weeks / every 12 weeks.

**Suicide-risk auto-alert**
- PHQ-9 Q9 endorsed (any level) → automatic crisis_alerts row, red badge
  on the assessment card, big callout in the UI. Therapist notified
  immediately, not "when they open the chart next time."

**Symptom-level breakdown**
- Not just the total score. Every item rendered as a progress bar
  color-keyed by severity. Therapist sees at a glance which symptoms are
  driving the total — sleep, energy, concentration, SI — without opening
  a raw export.

**Severity bands, rendered**
- The trend chart's background is shaded with the instrument's own
  clinical severity bands (minimal / mild / moderate / severe). Visual
  context, zero math for the therapist.

**Population norm comparison**
- Every score shows a percentile vs. the outpatient baseline for that
  instrument (PHQ-9, GAD-7, PCL-5, AUDIT-C norms from validation
  literature).
- "Your patient is at the 78th percentile" — immediate clinical context.

**Reliable Change Index**
- Dashed lines on the chart mark the baseline ± reliable-change threshold.
- Clinical-context strip below the chart: "Reliable improvement (−6; RCI
  ≥ 5)". No stats background required — the UI speaks the clinician's
  language.

**AI clinical interpretation**
- "Interpret with AI" button. Claude Sonnet reads the patient's full
  trend, the latest item-level responses, the active treatment plan, and
  the last 3 signed notes. Produces a 3–5 paragraph clinical summary the
  therapist can review and paste into a progress note.
- Leads with risk content when present. Cannot diagnose or prescribe.
  Can't minimize. Caps at 300 words. Not a replacement for clinical
  judgment — a second set of eyes.

---

## Workflow — what mom's Monday looks like

1. **8:55 AM** — opens Harbor. Sidebar: Overview, Patients, Appointments,
   **Progress Notes**, **EHR Audit Log**, Crisis Alerts, Settings.
2. **9:00 AM** — first patient arrives. Starts the session, clicks
   **Telehealth** on today's appointment — room opens in a new tab.
3. **9:45 AM** — session ends. Clicks **Document** on that appointment.
   Note-new page opens, patient + appointment already linked. She picks
   the "Individual follow-up" template, hits **Dictate**, talks for 20
   seconds about what they covered. Claude drafts the SOAP in 3
   seconds. She edits two sentences, checks off two goals, adds CPT
   90834, clicks **Sign note**. Done in 90 seconds.
4. **10:00 AM** — next patient. Same flow.
5. **Midday** — opens a patient from last Friday. Their portal shows the
   PHQ-9 she assigned is now completed, down from 18 to 11. The chart
   shows the improvement inside the shaded severity band. She clicks
   **Interpret with AI** — gets a clinical summary she copies into her
   next progress note.
6. **End of day** — hits **Export record** on a patient transferring
   to another provider. Prints the HTML summary as a PDF. Done.
7. **Home by 5:30** — no "notes night."

---

## The technical part (brief)

- **Branch**: `feature/ehr-v0`. Zero production impact until a single
  deliberate merge. 7 migrations, 30+ API routes, 25+ UI components.
- **Database**: Everything under `ehr_*` table prefix. One feature flag
  (`practices.ehr_enabled`) gates every route + card. Non-EHR practices
  see nothing change.
- **Isolation**: Built and tested against DB #2 (separate Supabase
  project). No patient data from production ever crosses.
- **Audit**: Every clinically-meaningful event writes to `audit_logs`
  with severity + JSON details.
- **Voice**: Web Speech API native, Whisper fallback for iPad/Safari.
- **AI**: Claude Sonnet 4.6 for all clinical-adjacent drafting and
  interpretation. Prompt caching on. Hard rails against hallucination
  and minimization in every prompt.
- **Telehealth v1**: Jitsi public (no BAA). Swap the provider URL
  in one file to upgrade to BAA-backed (Doxy.me / Daily.co-on-paid /
  self-hosted Jitsi) before real patient sessions.

---

## What ships next (Week 4 preview)

- Supervision / co-signing workflow (associates + supervisors)
- Release of Information form (authorize sharing with PCP/psychiatrist)
- Continuity-of-care summary (auto-generated export for referring
  providers)
- Mandatory reporting log (child/elder abuse, duty-to-warn templates
  and audit trail)
- Productivity reports (hours seen, notes outstanding, no-show rate,
  goal-progress rollups)
- Credentialing tracker (license expiry, CEUs, insurance panels)
- Session timer (live clock during session, stamps appointment duration
  automatically for billing)
- Homework tracking (what was assigned, did patient complete)

---

*Harbor EHR is not another billing-first EHR that bolted on clinical
features. Every feature here was built around one question: "does this
save the therapist time or give the therapist clarity?" If the answer
was no, it didn't ship.*
