h"use client";
// app/dashboard/patients/[id]/page.tsx
// Harbor — Patient Hub Detail View
// Unified patient profile with outcome trend chart, intake history, and appointments

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from hh"@/lib/supabase-browser";

const supabase = createClient();

type OutcomePoint = {
  intake_form_id: string;
  date: string;
  phq9_score: number | null;
  phq9_severity: string | null;
  gad7_score: number | null;
  gad7_severity: string | null;
};

type IntakeForm = {
  id: string;
  patient_name: string | null;
  patient_email: string | null;
  patient_phone: string | null;
  patient_dob: string | null;
  patient_address: string | null;
  phq9_answers: number[] | null;
  phq9_score: number | null;
  phq9_severity: string | null;
  gad7_answers: number[] | null;
  gad7_score: number | null;
  gad7_severity: string | null;
  additional_notes: string | null;
  completed_at: string | null;
  created_at: string;
  status: string;
  appointment_id: string | null;
  intake_document_signatures: {
    id: string;
    signed_name: string | null;
    signed_at: string;
    intake_documents: { id: string; name: string; requires_signature: boolean } | null;
  }[];
};

type Appointment = {
  id: string;
  scheduled_at: string;
  appointment_type: string;
  status: string;
  providers: { full_name: string } | null;
};

type PatientProfile = {
  key: string;
  patient_name: string | null;
  patient_email: string | null;
  patient_phone: string | null;
  patient_dob: string | null;
  patient_address: string | null;
  intake_count: number;
  last_seen: string | null;
};

type PatientData = {
  patient: PatientProfile;
  intake_forms: IntakeForm[];
  appointments: Appointment[];
  outcome_history: OutcomePoint[];
};

const SEVERITY_COLORS: Record<string, string> = {
  Minimal: "bg-green-100 text-green-800 border-green-200",
  Mild: "bg-yellow-100 text-yellow-800 border-yellow-200",
  Moderate: "bg-orange-100 text-orange-800 border-orange-200",
  "Moderately Severe": "bg-red-100 text-red-800 border-red-200",
  Severe: "bg-red-200 text-red-900 border-red-300",
};

const APPT_STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-gray-100 text-gray-600",
  "no-show": "bg-red-100 text-red-800",
};

async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function apiFetch(url: string, options?: RequestInit) {
  const token = await getAuthToken();
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  });
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatDateShort(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

function ageFromDob(dob: string | null) {
  if (!dob) return null;
  const age = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return isNaN(age) ? null : age;
}

function OutcomeChart({ history }: { history: OutcomePoint[] }) {
  if (history.length === 0) {
    return <div className="h-40 flex items-center justify-center text-gray-400 text-sm">No outcome data yet</div>;
  }

  const W = 600, H = 160;
  const PAD = { top: 16, right: 16, bottom: 40, left: 36 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const maxScore = 27;
  const xStep = history.length > 1 ? chartW / (history.length - 1) : chartW;

  function yPos(score: number | null) {
    if (score === null) return null;
    return PAD.top + chartH - (score / maxScore) * chartH;
  }

  function xPos(i: number) {
    return PAD.left + (history.length > 1 ? i * xStep : chartW / 2);
  }

  const phq9Points = history.map((p, i) => { const y = yPos(p.phq9_score); return y !== null ? `${xPos(i)},${y}` : null; }).filter(Boolean);
  const gad7Points = history.map((p, i) => { const y = yPos(p.gad7_score); return y !== null ? `${xPos(i)},${y}` : null; }).filter(Boolean);
  const yTicks = [0, 5, 10, 15, 20, 27];

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 300, maxHeight: 200 }}>
        {yTicks.map((tick) => {
          const y = PAD.top + chartH - (tick / maxScore) * chartH;
          return (
            <g key={tick}>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#f0f0f0" strokeWidth="1" />
              <text x={PAD.left - 6} y={y + 4} fontSize="10" fill="#9ca3af" textAnchor="end">{tick}</text>
            </g>
          );
        })}
        <rect x={PAD.left} y={PAD.top + chartH - (14 / maxScore) * chartH} width={chartW} height={((14 - 10) / maxScore) * chartH} fill="#fff7ed" opacity="0.5" />
        <rect x={PAD.left} y={PAD.top + chartH - (19 / maxScore) * chartH} width={chartW} height={((19 - 15) / maxScore) * chartH} fill="#fff1f2" opacity="0.5" />
        <rect x={PAD.left} y={PAD.top} width={chartW} height={((27 - 20) / maxScore) * chartH} fill="#ffe4e6" opacity="0.5" />
        {phq9Points.length >= 2 && <polyline points={phq9Points.join(" ")} fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        {gad7Points.length >= 2 && <polyline points={gad7Points.join(" ")} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        {history.map((p, i) => (
          <g key={p.intake_form_id}>
            {p.phq9_score !== null && yPos(p.phq9_score) !== null && <circle cx={xPos(i)} cy={yPos(p.phq9_score)!} r="3.5" fill="#f97316" />}
            {p.gad7_score !== null && yPos(p.gad7_score) !== null && <circle cx={xPos(i)} cy={yPos(p.gad7_score)!} r="3.5" fill="#8b5cf6" />}
            <text x={xPos(i)} y={H - 6} fontSize="9" fill="#9ca3af" textAnchor="middle">
              {new Date(p.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </text>
          </g>
        ))}
        <circle cx={PAD.left + 4} cy={H - PAD.bottom + 6} r="4" fill="#f97316" />
        <text x={PAD.left + 12} y={H - PAD.bottom + 10} fontSize="10" fill="#6b7280">PHQ-9</text>
        <circle cx={PAD.left + 56} cy={H - PAD.bottom + 6} r="4" fill="#8b5cf6" />
        <text x={PAD.left + 64} y={H - PAD.bottom + 10} fontSize="10" fill="#6b7280">GAD-7</text>
      </svg>
    </div>
  );
}

export default function PatientHubPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [data, setData] = useState<PatientData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedForm, setExpandedForm] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/patients/${id}`);
        if (res.status === 401) { router.push("/login"); return; }
        if (res.status === 404) { setError("Patient not found"); return; }
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load");
        setData(json);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load patient");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, router]);

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="w-8 h-8 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" /></div>;
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">{error ?? "Patient not found"}</p>
          <button onClick={() => router.push("/dashboard/patients")} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700">Back to Patients</button>
        </div>
      </div>
    );
  }

  const { patient, intake_forms, appointments, outcome_history } = data;
  const age = ageFromDob(patient.patient_dob);
  const latestForm = intake_forms[0];
  const latestPhq9 = latestForm?.phq9_severity;
  const latestGad7 = latestForm?.gad7_severity;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/dashboard/patients")} className="text-sm text-gray-500 hover:text-teal-600 transition-colors">← Patients</button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{patient.patient_name ?? "Unknown Patient"}</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {age !== null ? `Age ${age}` : ""}
                {age !== null && patient.patient_email ? " · " : ""}
                {patient.patient_email ?? patient.patient_phone ?? ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {latestPhq9 && (
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${SEVERITY_COLORS[latestPhq9] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
                PHQ-9: {latestPhq9}
              </span>
            )}
            {latestGad7 && (
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${SEVERITY_COLORS[latestGad7] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
                GAD-7: {latestGad7}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Demographics</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { label: "Full Name", value: patient.patient_name },
              { label: "Date of Birth", value: patient.patient_dob ? `${formatDate(patient.patient_dob)}${age !== null ? ` (age ${age})` : ""}` : null },
              { label: "Email", value: patient.patient_email },
              { label: "Phone", value: patient.patient_phone },
              { label: "Address", value: patient.patient_address },
              { label: "Last Seen", value: formatDateShort(patient.last_seen) },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</p>
                <p className="text-sm text-gray-900 mt-0.5">{value ?? "—"}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Total Intakes</p>
            <p className="text-2xl font-bold text-teal-600 mt-0.5">{patient.intake_count}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Outcome Trends</h2>
              <p className="text-xs text-gray-400 mt-0.5">PHQ-9 (depression) and GAD-7 (anxiety) over time</p>
            </div>
            {outcome_history.length > 0 && (
              <div className="text-right text-xs text-gray-400">{outcome_history.length} data point{outcome_history.length !== 1 ? "s" : ""}</div>
            )}
          </div>
          <OutcomeChart history={outcome_history} />
        </div>

        {appointments.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Appointments <span className="text-sm font-normal text-gray-400">({appointments.length})</span></h2>
            <div className="space-y-2">
              {appointments.map((appt) => (
                <div key={appt.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{appt.appointment_type}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{formatDateTime(appt.scheduled_at)}{appt.providers?.full_name ? ` · ${appt.providers.full_name}` : ""}</p>
                  </div>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${APPT_STATUS_COLORS[appt.status] ?? "bg-gray-100 text-gray-700"}`}>
                    {appt.status.charAt(0).toUpperCase() + appt.status.slice(1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">
            Intake History <span className="text-sm font-normal text-gray-400">({intake_forms.length} submission{intake_forms.length !== 1 ? "s" : ""})</span>
          </h2>
          <div className="space-y-2">
            {intake_forms.map((form, idx) => {
              const isExpanded = expandedForm === form.id;
              return (
                <div key={form.id} className="border border-gray-100 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedForm(isExpanded ? null : form.id)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-7 h-7 rounded-full bg-teal-100 text-teal-700 text-xs font-semibold flex items-center justify-center shrink-0">
                        {intake_forms.length - idx}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{formatDateShort(form.completed_at)}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {form.status === "completed" ? "Completed" : "Pending"}
                          {form.additional_notes ? " · Has notes" : ""}
                          {form.intake_document_signatures?.length ? ` · ${form.intake_document_signatures.length} doc${form.intake_document_signatures.length !== 1 ? "s" : ""} signed` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {form.phq9_severity && (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${SEVERITY_COLORS[form.phq9_severity] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
                          PHQ {form.phq9_score}
                        </span>
                      )}
                      {form.gad7_severity && (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${SEVERITY_COLORS[form.gad7_severity] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
                          GAD {form.gad7_score}
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/intake/${form.id}`); }}
                        className="text-xs text-teal-600 hover:text-teal-700 font-medium px-2 py-1 rounded hover:bg-teal-50 transition-colors"
                      >
                        Full view →
                      </button>
                      <span className="text-gray-400">{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-gray-100 p-4 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-orange-50 rounded-lg">
                          <p className="text-xs font-medium text-orange-700 uppercase tracking-wide">PHQ-9</p>
                          <p className="text-xl font-bold text-orange-800 mt-1">{form.phq9_score !== null ? `${form.phq9_score}/27` : "—"}</p>
                          <p className="text-xs text-orange-600 mt-0.5">{form.phq9_severity ?? "Not completed"}</p>
                        </div>
                        <div className="p-3 bg-violet-50 rounded-lg">
                          <p className="text-xs font-medium text-violet-700 uppercase tracking-wide">GAD-7</p>
                          <p className="text-xl font-bold text-violet-800 mt-1">{form.gad7_score !== null ? `${form.gad7_score}/21` : "—"}</p>
                          <p className="text-xs text-violet-600 mt-0.5">{form.gad7_severity ?? "Not completed"}</p>
                        </div>
                      </div>
                      {form.additional_notes && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <p className="text-xs font-medium text-gray-500 mb-1">Additional Notes</p>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{form.additional_notes}</p>
                        </div>
                      )}
                      {form.intake_document_signatures?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 mb-2">Signed Documents</p>
                          <div className="space-y-1.5">
                            {form.intake_document_signatures.map((sig) => (
                              <div key={sig.id} className="flex items-center gap-2 text-sm">
                                <span className="text-green-500">✓</span>
                                <span className="text-gray-700">{sig.intake_documents?.name ?? "Document"}</span>
                                {sig.signed_name && <span className="text-gray-400 text-xs">signed as {sig.signed_name}</span>}
                                <span className="text-gray-300 text-xs ml-auto">{formatDateTime(sig.signed_at)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="text-xs text-gray-400 text-center pb-4">Patient key: {patient.key}</div>
      </div>
    </div>
  );
                                                                   }
