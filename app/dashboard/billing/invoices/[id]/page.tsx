// app/dashboard/billing/invoices/[id]/page.tsx
//
// Wave 43 — EHR-side invoice detail page. The home for the W41 T5 patch's
// claim resubmit / cancel actions, plus initial submit and superbill
// generation. Surfaces the full submissions timeline (PCN, PCCN, ack
// status, 277CA messages, predecessor links) and an audit-log feed
// scoped to this invoice + its claim_submission rows.
//
// Server-rendered with RDS pool. Action buttons live in a client
// component (InvoiceActions) because they POST + need confirm modals
// and a corrections form. The ?action=resubmit / ?action=cancel deep
// links from the list page open the relevant flow on mount.

import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import {
  ChevronLeft, FileText, ScrollText, History, AlertCircle, ShieldCheck,
} from 'lucide-react'

import { pool } from '@/lib/aws/db'
import { getApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { InvoiceActions } from './InvoiceActions'

export const dynamic = 'force-dynamic'

// ----- types -----------------------------------------------------------

type Invoice = {
  id: string
  practice_id: string
  patient_id: string
  charge_ids: string[]
  subtotal_cents: number
  total_cents: number
  paid_cents: number
  status: string
  submission_status: string | null
  submitted_at: string | null
  payer_id_837: string | null
  stripe_invoice_id: string | null
  stripe_payment_url: string | null
  due_date: string | null
  created_at: string
}

type Patient = {
  id: string
  first_name: string | null
  last_name: string | null
  date_of_birth: string | null
  insurance_provider: string | null
  insurance_member_id: string | null
  insurance_group_number: string | null
}

type Payer = {
  stedi_id: string
  display_name: string
  is_medicare: boolean | null
}

type Charge = {
  id: string
  cpt_code: string
  units: number
  fee_cents: number
  allowed_cents: number
  copay_cents: number
  billed_to: string
  status: string
  service_date: string
  place_of_service: string | null
  appointment_id: string | null
  note_id: string | null
  modifiers: string[] | null
  icd10_codes: string[] | null
}

type Submission = {
  id: string
  submitted_at: string
  submitted_by_user_id: string | null
  submitted_by_email: string | null
  payer_id_837: string
  payer_name: string | null
  control_number: string
  pcn: string
  payer_claim_control_number: string | null
  stedi_submission_id: string | null
  http_status: number | null
  is_accepted: boolean | null
  rejection_reason: string | null
  status: string
  acknowledgment_status: string | null
  acknowledgment_received_at: string | null
  acknowledgment_messages: unknown
  is_in_adjudication: boolean
  is_cancellation: boolean
  original_submission_id: string | null
}

type Authorization = {
  auth_number: string
  payer: string
  valid_from: string | null
  valid_to: string | null
  sessions_authorized: number
  sessions_used: number
}

type AuditEntry = {
  id: string
  timestamp: string
  user_email: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  details: Record<string, unknown> | null
  severity: string | null
}

// ----- helpers ---------------------------------------------------------

function cents(n: number | null | undefined): string {
  if (n == null) return '$0.00'
  return `$${(n / 100).toFixed(2)}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function statusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case 'paid':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200'
    case 'accepted':
      return 'bg-blue-50 text-blue-800 border-blue-200'
    case 'rejected':
    case 'denied':
    case 'error':
      return 'bg-red-50 text-red-800 border-red-200'
    case 'submitting':
    case 'pending':
      return 'bg-amber-50 text-amber-800 border-amber-200'
    default:
      return 'bg-gray-50 text-gray-700 border-gray-200'
  }
}

function statusLabel(status: string | null | undefined): string {
  if (!status || status === 'not_submitted') return 'Not submitted'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

// ----- queries ---------------------------------------------------------

async function loadInvoiceDetail(args: { practiceId: string; invoiceId: string }): Promise<{
  invoice: Invoice | null
  patient: Patient | null
  payer: Payer | null
  charges: Charge[]
  submissions: Submission[]
  authorization: Authorization | null
  audit: AuditEntry[]
} | null> {
  const inv = await pool.query<Invoice>(
    `SELECT id, practice_id, patient_id, charge_ids, subtotal_cents, total_cents,
            paid_cents, status, submission_status, submitted_at, payer_id_837,
            stripe_invoice_id, stripe_payment_url, due_date::text AS due_date,
            created_at
       FROM ehr_invoices
      WHERE id = $1 AND practice_id = $2`,
    [args.invoiceId, args.practiceId],
  )
  if (inv.rows.length === 0) return null
  const invoice = inv.rows[0]

  const pat = await pool.query<Patient>(
    `SELECT id, first_name, last_name, date_of_birth::text AS date_of_birth,
            insurance_provider, insurance_member_id, insurance_group_number
       FROM patients
      WHERE id = $1 AND practice_id = $2 AND deleted_at IS NULL`,
    [invoice.patient_id, args.practiceId],
  )
  const patient = pat.rows[0] ?? null

  let payer: Payer | null = null
  if (invoice.payer_id_837) {
    const pay = await pool.query<Payer>(
      `SELECT stedi_id, display_name, is_medicare
         FROM stedi_payers
        WHERE stedi_id = $1`,
      [invoice.payer_id_837],
    )
    payer = pay.rows[0] ?? null
  }

  let charges: Charge[] = []
  if (invoice.charge_ids.length > 0) {
    const chg = await pool.query<Charge>(
      `SELECT c.id, c.cpt_code, c.units, c.fee_cents, c.allowed_cents,
              c.copay_cents, c.billed_to, c.status, c.service_date::text AS service_date,
              c.place_of_service, c.appointment_id, c.note_id,
              a.modifiers AS modifiers,
              n.icd10_codes AS icd10_codes
         FROM ehr_charges c
         LEFT JOIN appointments a ON a.id = c.appointment_id
         LEFT JOIN ehr_progress_notes n ON n.id = c.note_id
        WHERE c.id = ANY($1::uuid[])
          AND c.practice_id = $2
        ORDER BY c.service_date ASC, c.created_at ASC`,
      [invoice.charge_ids, args.practiceId],
    )
    charges = chg.rows
  }

  const subs = await pool.query<Submission>(
    `SELECT s.id, s.submitted_at, s.submitted_by_user_id, u.email AS submitted_by_email,
            s.payer_id_837, sp.display_name AS payer_name,
            s.control_number, s.pcn, s.payer_claim_control_number,
            s.stedi_submission_id, s.http_status, s.is_accepted, s.rejection_reason,
            s.status, s.acknowledgment_status, s.acknowledgment_received_at,
            s.acknowledgment_messages, s.is_in_adjudication, s.is_cancellation,
            s.original_submission_id
       FROM ehr_claim_submissions s
       LEFT JOIN users u ON u.id = s.submitted_by_user_id
       LEFT JOIN stedi_payers sp ON sp.stedi_id = s.payer_id_837
      WHERE s.invoice_id = $1 AND s.practice_id = $2
      ORDER BY s.submitted_at DESC, s.id DESC`,
    [invoice.id, args.practiceId],
  )
  const submissions = subs.rows

  let authorization: Authorization | null = null
  if (patient) {
    const auth = await pool.query<Authorization>(
      `SELECT auth_number, payer, valid_from::text AS valid_from,
              valid_to::text AS valid_to, sessions_authorized, sessions_used
         FROM ehr_insurance_authorizations
        WHERE patient_id = $1 AND practice_id = $2
          AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
        ORDER BY valid_from DESC NULLS LAST
        LIMIT 1`,
      [patient.id, args.practiceId],
    )
    authorization = auth.rows[0] ?? null
  }

  const submissionIds = submissions.map((s) => s.id)
  const audit = await pool.query<AuditEntry>(
    `SELECT id, timestamp, user_email, action, resource_type, resource_id,
            details, severity
       FROM audit_logs
      WHERE practice_id = $3
        AND (
          resource_id::text = $1
          OR resource_id::text = ANY($2::text[])
          OR (details ? 'invoice_id' AND details->>'invoice_id' = $1)
        )
      ORDER BY timestamp ASC
      LIMIT 200`,
    [invoice.id, submissionIds, args.practiceId],
  )

  return {
    invoice, patient, payer, charges, submissions, authorization, audit: audit.rows,
  }
}

// ----- page ------------------------------------------------------------

export default async function InvoiceDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ action?: string }>
}) {
  const { id } = await params
  const sp = await searchParams

  const ctx = await getApiSession()
  if (!ctx) redirect(`/login?next=/dashboard/billing/invoices/${id}`)
  if (!ctx.practice || ctx.practice.ehr_enabled !== true) redirect('/dashboard')
  if (!ctx.practiceId) redirect('/dashboard')

  const data = await loadInvoiceDetail({ practiceId: ctx.practiceId, invoiceId: id })
  if (!data || !data.invoice) notFound()

  const { invoice, patient, payer, charges, submissions, authorization, audit } = data

  await auditEhrAccess({
    ctx,
    action: 'invoice.detail_viewed',
    resourceType: 'ehr_invoice',
    resourceId: invoice.id,
    details: {
      patient_id: invoice.patient_id,
      submission_count: submissions.length,
      submission_status: invoice.submission_status,
    },
  })

  const latest = submissions.find((s) => !s.is_cancellation) ?? null
  const hasAnySubmission = submissions.length > 0
  const canSubmit = !hasAnySubmission
  const canResubmit = latest?.acknowledgment_status === 'rejected'
  const canCancel = !!latest?.is_in_adjudication && payer?.is_medicare !== true
  const isCashPay = charges.length > 0 && charges.every((c) => c.billed_to === 'patient_self_pay')

  const rejectionReasons = renderAckMessages(latest?.acknowledgment_messages)

  const serviceDates = charges.map((c) => c.service_date).filter(Boolean) as string[]
  const fromDate = serviceDates.length ? serviceDates.reduce((a, b) => (a < b ? a : b)) : null
  const toDate = serviceDates.length ? serviceDates.reduce((a, b) => (a > b ? a : b)) : null
  const superbillUrl = patient && fromDate && toDate
    ? `/api/ehr/billing/superbill?patient_id=${patient.id}&from=${fromDate}&to=${toDate}`
    : null

  const patientFullName = patient
    ? `${patient.first_name ?? ''} ${patient.last_name ?? ''}`.trim() || '(no name)'
    : '(no patient)'

  return (
    <div className="max-w-5xl mx-auto py-6 px-4">
      <Link
        href="/dashboard/billing/invoices"
        className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-4"
      >
        <ChevronLeft className="w-4 h-4" /> All invoices
      </Link>

      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-gray-400 mb-1">
              Invoice #{invoice.id.slice(0, 8)}
            </div>
            <h1 className="text-2xl font-semibold text-gray-900 truncate">{patientFullName}</h1>
            <div className="text-sm text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {patient?.date_of_birth && <span>DOB {formatDate(patient.date_of_birth)}</span>}
              <span>·</span>
              <span>{payer?.display_name || invoice.payer_id_837 || 'No payer'}</span>
              <span>·</span>
              <span className="font-mono">{cents(invoice.total_cents)}</span>
            </div>
          </div>
          <span
            className={`shrink-0 inline-block px-3 py-1 rounded-full text-xs font-medium border ${statusBadgeClass(invoice.submission_status)}`}
          >
            {statusLabel(invoice.submission_status)}
          </span>
        </div>
      </div>

      <InvoiceActions
        invoiceId={invoice.id}
        canSubmit={canSubmit}
        canResubmit={canResubmit}
        canCancel={canCancel}
        isCashPay={isCashPay}
        superbillUrl={superbillUrl}
        autoOpenAction={
          sp.action === 'resubmit' && canResubmit
            ? 'resubmit'
            : sp.action === 'cancel' && canCancel
              ? 'cancel'
              : null
        }
        rejectionReasons={rejectionReasons}
        defaultCorrections={{
          principalDiagnosis: charges[0]?.icd10_codes?.[0] ?? '',
          placeOfServiceCode: charges[0]?.place_of_service ?? '',
          priorAuthorizationNumber: authorization?.auth_number ?? '',
        }}
      />

      <Section title="Patient" icon={<ScrollText className="w-4 h-4" />}>
        <Grid>
          <Field label="Name" value={patientFullName} />
          <Field label="Date of birth" value={formatDate(patient?.date_of_birth ?? null)} />
          <Field label="Insurance" value={patient?.insurance_provider || 'Self-pay / none'} />
          <Field label="Member ID" value={patient?.insurance_member_id || '—'} mono />
          <Field label="Group #" value={patient?.insurance_group_number || '—'} mono />
          <Field
            label="Auth #"
            value={authorization?.auth_number || '—'}
            mono
            sub={
              authorization
                ? `${authorization.sessions_used}/${authorization.sessions_authorized} sessions used`
                : undefined
            }
          />
        </Grid>
      </Section>

      <Section title="Charges" icon={<FileText className="w-4 h-4" />}>
        {charges.length === 0 ? (
          <div className="text-sm text-gray-500">No charges.</div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2">CPT</th>
                    <th className="text-left px-3 py-2">Modifiers</th>
                    <th className="text-left px-3 py-2">Service date</th>
                    <th className="text-right px-3 py-2">Units</th>
                    <th className="text-right px-3 py-2">Fee</th>
                    <th className="text-left px-3 py-2">ICD-10</th>
                    <th className="text-left px-3 py-2">POS</th>
                    <th className="text-left px-3 py-2">Billed to</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {charges.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2 font-mono">{c.cpt_code}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {(c.modifiers ?? []).join(', ') || '—'}
                      </td>
                      <td className="px-3 py-2">{formatDate(c.service_date)}</td>
                      <td className="px-3 py-2 text-right">{c.units}</td>
                      <td className="px-3 py-2 text-right font-mono">{cents(c.fee_cents)}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {(c.icd10_codes ?? []).join(', ') || '—'}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{c.place_of_service || '—'}</td>
                      <td className="px-3 py-2 text-xs capitalize">{c.billed_to.replace(/_/g, ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden space-y-3">
              {charges.map((c) => (
                <div key={c.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="font-mono font-medium">{c.cpt_code}</span>
                    <span className="font-mono">{cents(c.fee_cents)}</span>
                  </div>
                  <div className="text-xs text-gray-500 grid grid-cols-2 gap-x-2 gap-y-0.5">
                    <span>Service date: {formatDate(c.service_date)}</span>
                    <span>Units: {c.units}</span>
                    <span>POS: {c.place_of_service || '—'}</span>
                    <span>Billed: {c.billed_to.replace(/_/g, ' ')}</span>
                    {c.modifiers && c.modifiers.length > 0 && (
                      <span className="col-span-2 font-mono">Mods: {c.modifiers.join(', ')}</span>
                    )}
                    {c.icd10_codes && c.icd10_codes.length > 0 && (
                      <span className="col-span-2 font-mono">ICD-10: {c.icd10_codes.join(', ')}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      <Section title="Submission timeline" icon={<History className="w-4 h-4" />}>
        {submissions.length === 0 ? (
          <div className="text-sm text-gray-500">
            No claim submissions yet. Use the Submit button above to send the
            initial 837P to the payer via Stedi.
          </div>
        ) : (
          <div className="space-y-3">
            {submissions.map((s, idx) => (
              <SubmissionCard
                key={s.id}
                submission={s}
                isLatest={idx === 0}
                predecessor={
                  s.original_submission_id
                    ? submissions.find((x) => x.id === s.original_submission_id) ?? null
                    : null
                }
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Activity log" icon={<ShieldCheck className="w-4 h-4" />}>
        {audit.length === 0 ? (
          <div className="text-sm text-gray-500">No activity recorded yet.</div>
        ) : (
          <ul className="space-y-2">
            {audit.map((a) => (
              <li key={a.id} className="text-xs flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
                <span className="text-gray-400 shrink-0 font-mono">
                  {formatDateTime(a.timestamp)}
                </span>
                <span className="font-mono text-gray-700">{a.action}</span>
                {a.user_email && <span className="text-gray-500">· {a.user_email}</span>}
                {a.severity && a.severity !== 'info' && (
                  <span className="inline-block px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] uppercase">
                    {a.severity}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

// ----- presentational helpers -----------------------------------------

function Section({
  title, icon, children,
}: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-3">
        {icon}
        {title}
      </div>
      {children}
    </div>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{children}</div>
}

function Field({
  label, value, mono = false, sub,
}: { label: string; value: string; mono?: boolean; sub?: string }) {
  return (
    <div className="border border-gray-100 rounded-lg p-3">
      <div className="text-[11px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`text-sm text-gray-900 mt-0.5 ${mono ? 'font-mono' : ''}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function SubmissionCard({
  submission: s, isLatest, predecessor,
}: {
  submission: Submission
  isLatest: boolean
  predecessor: Submission | null
}) {
  const ackMessages = parseAckMessages(s.acknowledgment_messages)
  return (
    <div className="border border-gray-200 rounded-lg p-3 sm:p-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2">
        <div className="text-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-gray-500">PCN</span>
            <span className="font-mono text-sm">{s.pcn}</span>
            {isLatest && (
              <span className="inline-block px-1.5 py-0.5 rounded bg-teal-50 text-teal-800 text-[10px] uppercase">
                Latest
              </span>
            )}
            {s.is_cancellation && (
              <span className="inline-block px-1.5 py-0.5 rounded bg-red-50 text-red-800 text-[10px] uppercase">
                Cancellation (CFC=8)
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            Submitted {formatDateTime(s.submitted_at)}
            {s.submitted_by_email && ` by ${s.submitted_by_email}`}
          </div>
        </div>
        <span
          className={`shrink-0 inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${statusBadgeClass(s.acknowledgment_status ?? s.status)}`}
        >
          {statusLabel(s.acknowledgment_status ?? s.status)}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-3">
        <KV label="Method" value="API (Stedi 837P)" />
        <KV
          label="HTTP"
          value={s.http_status != null ? String(s.http_status) : '—'}
          mono
        />
        <KV label="PCCN" value={s.payer_claim_control_number || '—'} mono />
        <KV label="In adjudication" value={s.is_in_adjudication ? 'Yes' : 'No'} />
        {s.acknowledgment_received_at && (
          <KV label="Ack received" value={formatDateTime(s.acknowledgment_received_at)} />
        )}
        {s.stedi_submission_id && (
          <KV label="Stedi ID" value={s.stedi_submission_id} mono />
        )}
        {predecessor && (
          <KV label="Replaces" value={`PCN ${predecessor.pcn}`} mono />
        )}
      </div>

      {ackMessages.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-1">
            277CA acknowledgment
          </div>
          <ul className="space-y-1">
            {ackMessages.map((m, i) => (
              <li key={i} className="text-xs text-gray-700 flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600" />
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.rejection_reason && (
        <div className="mt-3 border-t border-gray-100 pt-3 text-xs text-red-700">
          Rejection: {s.rejection_reason}
        </div>
      )}
    </div>
  )
}

function KV({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`text-gray-800 ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  )
}

// ----- 277CA acknowledgment_messages JSONB rendering ------------------

function parseAckMessages(raw: unknown): string[] {
  if (!raw) return []
  if (typeof raw === 'string') return [raw]
  if (Array.isArray(raw)) {
    return raw.map((m) => {
      if (typeof m === 'string') return m
      if (m && typeof m === 'object') {
        const obj = m as Record<string, unknown>
        const code = typeof obj.code === 'string' ? obj.code : null
        const msg = typeof obj.message === 'string'
          ? obj.message
          : typeof obj.description === 'string'
            ? obj.description
            : typeof obj.text === 'string'
              ? obj.text
              : null
        if (code && msg) return `${code} — ${msg}`
        return msg ?? code ?? JSON.stringify(obj)
      }
      return String(m)
    })
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    if (Array.isArray(obj.messages)) return parseAckMessages(obj.messages)
    if (Array.isArray(obj.errors)) return parseAckMessages(obj.errors)
  }
  return []
}

function renderAckMessages(raw: unknown): string {
  const list = parseAckMessages(raw)
  return list.join('\n')
}
