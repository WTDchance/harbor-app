// app/dashboard/billing/invoices/page.tsx
//
// Wave 43 — EHR-side invoice list. Lives at /dashboard/billing/invoices and
// is the landing page for the Wave 41 T5 attention tile that links here
// with ?submission_status=rejected. URL params drive every filter so the
// page is shareable and back-button-friendly.
//
// Server component. RDS via pool. Cognito session + ehr_enabled gating.
// Cursor pagination on (created_at DESC, id DESC) — page size 25.
//
// Action buttons:
//   - View          — always
//   - Submit claim  — when no submission exists yet (one-click POST)
//   - Resubmit      — when latest submission acknowledgment_status='rejected'
//                     (links to detail; corrections form lives there)
//   - Cancel        — when latest submission is_in_adjudication=true and
//                     payer non-Medicare (links to detail; confirm-modal
//                     lives there too)

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileText, Filter as FilterIcon, ChevronLeft, ChevronRight } from 'lucide-react'

import { pool } from '@/lib/aws/db'
import { getApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { InvoiceRowSubmitButton } from './InvoiceRowSubmitButton'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

// ----- types -----------------------------------------------------------

type InvoiceListRow = {
  id: string
  patient_id: string
  patient_first: string | null
  patient_last: string | null
  payer_id_837: string | null
  payer_name: string | null
  service_date: string | null
  total_cents: number
  submission_status: string | null
  status: string
  created_at: string
  latest_submission_id: string | null
  latest_acknowledgment_status: string | null
  latest_acknowledgment_received_at: string | null
  latest_is_in_adjudication: boolean | null
  latest_is_medicare: boolean | null
  has_any_submission: boolean
}

type SearchParams = {
  submission_status?: string
  from?: string
  to?: string
  q?: string
  payer?: string
  cursor?: string
}

// ----- helpers ---------------------------------------------------------

function cents(n: number | null | undefined): string {
  if (n == null) return '$0.00'
  return `$${(n / 100).toFixed(2)}`
}

function formatDateShort(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const SUBMISSION_STATUS_VALUES = [
  'not_submitted', 'submitting', 'accepted', 'rejected', 'paid', 'denied',
] as const

function normaliseSubmissionStatus(v: string | undefined): string | null {
  if (!v) return null
  const lower = v.toLowerCase().trim()
  if (lower === 'none') return 'not_submitted'
  if (lower === 'pending') return 'submitting'
  if ((SUBMISSION_STATUS_VALUES as readonly string[]).includes(lower)) return lower
  return null
}

function statusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case 'paid':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200'
    case 'accepted':
      return 'bg-blue-50 text-blue-800 border-blue-200'
    case 'rejected':
    case 'denied':
      return 'bg-red-50 text-red-800 border-red-200'
    case 'submitting':
      return 'bg-amber-50 text-amber-800 border-amber-200'
    default:
      return 'bg-gray-50 text-gray-700 border-gray-200'
  }
}

function statusLabel(status: string | null | undefined): string {
  if (!status || status === 'not_submitted') return 'Not submitted'
  if (status === 'submitting') return 'Submitting'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString('base64url')
}

function decodeCursor(c: string | undefined): { createdAt: string; id: string } | null {
  if (!c) return null
  try {
    const decoded = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'))
    if (Array.isArray(decoded) && typeof decoded[0] === 'string' && typeof decoded[1] === 'string') {
      return { createdAt: decoded[0], id: decoded[1] }
    }
  } catch {
    return null
  }
  return null
}

// ----- query -----------------------------------------------------------

async function loadInvoices(args: {
  practiceId: string
  submissionStatus: string | null
  fromDate: string | null
  toDate: string | null
  patientQuery: string | null
  payerQuery: string | null
  cursor: { createdAt: string; id: string } | null
}): Promise<{ rows: InvoiceListRow[]; nextCursor: string | null }> {
  const params: unknown[] = [args.practiceId]
  const where: string[] = ['i.practice_id = $1']

  if (args.submissionStatus) {
    params.push(args.submissionStatus)
    where.push(`COALESCE(i.submission_status, 'not_submitted') = $${params.length}`)
  }
  if (args.fromDate) {
    params.push(args.fromDate)
    where.push(`i.created_at >= $${params.length}::date`)
  }
  if (args.toDate) {
    params.push(args.toDate)
    where.push(`i.created_at < ($${params.length}::date + INTERVAL '1 day')`)
  }
  if (args.patientQuery) {
    params.push(`%${args.patientQuery}%`)
    where.push(
      `(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')) ILIKE $${params.length}`,
    )
  }
  if (args.payerQuery) {
    params.push(`%${args.payerQuery}%`)
    where.push(
      `(COALESCE(sp.display_name, i.payer_id_837, '') ILIKE $${params.length})`,
    )
  }
  if (args.cursor) {
    params.push(args.cursor.createdAt)
    params.push(args.cursor.id)
    where.push(
      `(i.created_at, i.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
    )
  }

  params.push(PAGE_SIZE + 1)

  const sql = `
    SELECT
      i.id,
      i.patient_id,
      p.first_name AS patient_first,
      p.last_name  AS patient_last,
      i.payer_id_837,
      sp.display_name AS payer_name,
      (
        SELECT MIN(c.service_date)::text
          FROM ehr_charges c
         WHERE c.id = ANY(i.charge_ids)
      ) AS service_date,
      i.total_cents,
      i.submission_status,
      i.status,
      i.created_at,
      latest.id                          AS latest_submission_id,
      latest.acknowledgment_status       AS latest_acknowledgment_status,
      latest.acknowledgment_received_at  AS latest_acknowledgment_received_at,
      latest.is_in_adjudication          AS latest_is_in_adjudication,
      latest_payer.is_medicare           AS latest_is_medicare,
      (latest.id IS NOT NULL)            AS has_any_submission
    FROM ehr_invoices i
    LEFT JOIN patients p ON p.id = i.patient_id
    LEFT JOIN stedi_payers sp ON sp.stedi_id = i.payer_id_837
    LEFT JOIN LATERAL (
      SELECT s.id,
             s.acknowledgment_status,
             s.acknowledgment_received_at,
             s.is_in_adjudication,
             s.payer_id_837
        FROM ehr_claim_submissions s
       WHERE s.invoice_id = i.id
         AND s.is_cancellation = false
       ORDER BY s.submitted_at DESC, s.id DESC
       LIMIT 1
    ) latest ON true
    LEFT JOIN stedi_payers latest_payer ON latest_payer.stedi_id = latest.payer_id_837
    WHERE ${where.join(' AND ')}
    ORDER BY i.created_at DESC, i.id DESC
    LIMIT $${params.length}
  `

  const { rows } = await pool.query<InvoiceListRow>(sql, params)

  let nextCursor: string | null = null
  let trimmed = rows
  if (rows.length > PAGE_SIZE) {
    trimmed = rows.slice(0, PAGE_SIZE)
    const last = trimmed[trimmed.length - 1]
    nextCursor = encodeCursor(last.created_at, last.id)
  }

  return { rows: trimmed, nextCursor }
}

// ----- filter-form ----------------------------------------------------

function FilterBar({ params }: { params: SearchParams }) {
  return (
    <form
      method="GET"
      className="bg-white border border-gray-200 rounded-xl p-4 mb-4"
      action="/dashboard/billing/invoices"
    >
      <div className="flex items-center gap-2 mb-3 text-sm font-medium text-gray-700">
        <FilterIcon className="w-4 h-4" />
        Filter invoices
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Status
          <select
            name="submission_status"
            defaultValue={params.submission_status ?? ''}
            className="h-11 px-3 rounded-md border border-gray-300 text-sm bg-white"
          >
            <option value="">All</option>
            <option value="none">None (not submitted)</option>
            <option value="pending">Pending (submitting)</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="paid">Paid</option>
            <option value="denied">Denied</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          From
          <input
            type="date"
            name="from"
            defaultValue={params.from ?? ''}
            className="h-11 px-3 rounded-md border border-gray-300 text-sm bg-white"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          To
          <input
            type="date"
            name="to"
            defaultValue={params.to ?? ''}
            className="h-11 px-3 rounded-md border border-gray-300 text-sm bg-white"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Patient name
          <input
            type="text"
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="e.g. Jane Doe"
            className="h-11 px-3 rounded-md border border-gray-300 text-sm bg-white"
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Payer
          <input
            type="text"
            name="payer"
            defaultValue={params.payer ?? ''}
            placeholder="e.g. Aetna"
            className="h-11 px-3 rounded-md border border-gray-300 text-sm bg-white"
            autoComplete="off"
          />
        </label>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 mt-3">
        <button
          type="submit"
          className="h-11 px-4 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium"
        >
          Apply filters
        </button>
        <Link
          href="/dashboard/billing/invoices"
          className="h-11 px-4 rounded-md border border-gray-300 text-gray-700 text-sm font-medium inline-flex items-center justify-center"
        >
          Clear
        </Link>
      </div>
    </form>
  )
}

// ----- page ------------------------------------------------------------

export default async function InvoiceListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const ctx = await getApiSession()
  if (!ctx) redirect('/login?next=/dashboard/billing/invoices')
  if (!ctx.practice || ctx.practice.ehr_enabled !== true) redirect('/dashboard')
  if (!ctx.practiceId) redirect('/dashboard')

  const submissionStatus = normaliseSubmissionStatus(sp.submission_status)
  const fromDate = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : null
  const toDate = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : null
  const patientQuery = sp.q?.trim() || null
  const payerQuery = sp.payer?.trim() || null
  const cursor = decodeCursor(sp.cursor)

  const { rows, nextCursor } = await loadInvoices({
    practiceId: ctx.practiceId,
    submissionStatus,
    fromDate,
    toDate,
    patientQuery,
    payerQuery,
    cursor,
  })

  await auditEhrAccess({
    ctx,
    action: 'invoice.list_viewed',
    resourceType: 'ehr_invoice',
    resourceId: null,
    details: {
      submission_status: submissionStatus,
      from: fromDate,
      to: toDate,
      patient_query: patientQuery ? '[redacted]' : null,
      payer_query: payerQuery,
      cursor_present: cursor !== null,
      result_count: rows.length,
    },
  })

  const buildPageUrl = (newCursor: string | null): string => {
    const u = new URLSearchParams()
    if (sp.submission_status) u.set('submission_status', sp.submission_status)
    if (fromDate) u.set('from', fromDate)
    if (toDate) u.set('to', toDate)
    if (patientQuery) u.set('q', patientQuery)
    if (payerQuery) u.set('payer', payerQuery)
    if (newCursor) u.set('cursor', newCursor)
    const qs = u.toString()
    return qs ? `/dashboard/billing/invoices?${qs}` : '/dashboard/billing/invoices'
  }

  return (
    <div className="max-w-6xl mx-auto py-6 px-4">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Invoices</h1>
          <p className="text-sm text-gray-500 mt-1">
            Insurance claim lifecycle. Submit, track 277CA acknowledgments, resubmit
            corrections (CFC=1 / CFC=7), and cancel pending claims (CFC=8).
          </p>
        </div>
      </div>

      <FilterBar params={sp} />

      {rows.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <FileText className="w-10 h-10 mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">No invoices match these filters.</p>
        </div>
      ) : (
        <>
          <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2">Patient</th>
                  <th className="text-left px-4 py-2">Payer</th>
                  <th className="text-left px-4 py-2">Service date</th>
                  <th className="text-right px-4 py-2">Total</th>
                  <th className="text-left px-4 py-2">Submission</th>
                  <th className="text-left px-4 py-2">Last ack</th>
                  <th className="text-right px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <InvoiceRow key={r.id} row={r} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {rows.map((r) => (
              <InvoiceCardMobile key={r.id} row={r} />
            ))}
          </div>

          <div className="flex items-center justify-between mt-4">
            {sp.cursor ? (
              <Link
                href="/dashboard/billing/invoices"
                className="inline-flex items-center gap-1 h-11 px-3 rounded-md border border-gray-300 text-sm text-gray-700"
              >
                <ChevronLeft className="w-4 h-4" /> Back to start
              </Link>
            ) : (
              <span />
            )}
            {nextCursor ? (
              <Link
                href={buildPageUrl(nextCursor)}
                className="inline-flex items-center gap-1 h-11 px-3 rounded-md border border-gray-300 text-sm text-gray-700"
              >
                Next <ChevronRight className="w-4 h-4" />
              </Link>
            ) : (
              <span className="text-xs text-gray-400">End of list</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function patientName(r: InvoiceListRow): string {
  const first = r.patient_first ?? ''
  const last = r.patient_last ?? ''
  const full = `${first} ${last}`.trim()
  return full || '(no name)'
}

function rowCanResubmit(r: InvoiceListRow): boolean {
  return r.latest_acknowledgment_status === 'rejected'
}

function rowCanCancel(r: InvoiceListRow): boolean {
  return r.latest_is_in_adjudication === true && r.latest_is_medicare !== true
}

function InvoiceRow({ row }: { row: InvoiceListRow }) {
  const status = row.submission_status ?? 'not_submitted'
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900">{patientName(row)}</div>
      </td>
      <td className="px-4 py-3 text-gray-700">
        {row.payer_name || row.payer_id_837 || '—'}
      </td>
      <td className="px-4 py-3 text-gray-700">{formatDateShort(row.service_date)}</td>
      <td className="px-4 py-3 text-right font-mono">{cents(row.total_cents)}</td>
      <td className="px-4 py-3">
        <span
          className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${statusBadgeClass(status)}`}
        >
          {statusLabel(status)}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-gray-600">
        {row.latest_acknowledgment_status ? (
          <>
            <div className="capitalize">{row.latest_acknowledgment_status}</div>
            <div className="text-gray-400">{formatDateShort(row.latest_acknowledgment_received_at)}</div>
          </>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2 flex-wrap">
          <Link
            href={`/dashboard/billing/invoices/${row.id}`}
            className="inline-flex items-center justify-center h-11 min-w-[44px] px-3 rounded-md border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            View
          </Link>
          {!row.has_any_submission && (
            <InvoiceRowSubmitButton invoiceId={row.id} />
          )}
          {rowCanResubmit(row) && (
            <Link
              href={`/dashboard/billing/invoices/${row.id}?action=resubmit`}
              className="inline-flex items-center justify-center h-11 min-w-[44px] px-3 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium"
            >
              Resubmit
            </Link>
          )}
          {rowCanCancel(row) && (
            <Link
              href={`/dashboard/billing/invoices/${row.id}?action=cancel`}
              className="inline-flex items-center justify-center h-11 min-w-[44px] px-3 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-medium"
            >
              Cancel
            </Link>
          )}
        </div>
      </td>
    </tr>
  )
}

function InvoiceCardMobile({ row }: { row: InvoiceListRow }) {
  const status = row.submission_status ?? 'not_submitted'
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="font-medium text-gray-900 truncate">{patientName(row)}</div>
          <div className="text-xs text-gray-500 truncate">
            {row.payer_name || row.payer_id_837 || 'No payer'}
          </div>
        </div>
        <span
          className={`shrink-0 inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${statusBadgeClass(status)}`}
        >
          {statusLabel(status)}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-gray-600 mb-3">
        <div>
          <div className="text-gray-400">Service date</div>
          <div>{formatDateShort(row.service_date)}</div>
        </div>
        <div className="text-right">
          <div className="text-gray-400">Total</div>
          <div className="font-mono text-gray-900">{cents(row.total_cents)}</div>
        </div>
      </div>
      {row.latest_acknowledgment_status && (
        <div className="text-xs text-gray-500 mb-3">
          Last ack: <span className="capitalize">{row.latest_acknowledgment_status}</span>
          {row.latest_acknowledgment_received_at &&
            ` · ${formatDateShort(row.latest_acknowledgment_received_at)}`}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Link
          href={`/dashboard/billing/invoices/${row.id}`}
          className="inline-flex items-center justify-center h-11 px-3 rounded-md border border-gray-300 text-sm font-medium text-gray-700"
        >
          View detail
        </Link>
        {!row.has_any_submission && <InvoiceRowSubmitButton invoiceId={row.id} fullWidth />}
        {rowCanResubmit(row) && (
          <Link
            href={`/dashboard/billing/invoices/${row.id}?action=resubmit`}
            className="inline-flex items-center justify-center h-11 px-3 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium"
          >
            Fix and resubmit
          </Link>
        )}
        {rowCanCancel(row) && (
          <Link
            href={`/dashboard/billing/invoices/${row.id}?action=cancel`}
            className="inline-flex items-center justify-center h-11 px-3 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
          >
            Cancel claim with payer
          </Link>
        )}
      </div>
    </div>
  )
}
