"use client";
// app/dashboard/intake/[id]/page.tsx
// Harbor  - Intake Submission Detail View (expanded with demographics, insurance, signatures)

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";


type Demographics = {
  first_name?: string;
  last_name?: string;
  date_of_birth?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  emergency_contact_relationship?: string;
  preferred_pronouns?: string;
  referral_source?: string;
};

type InsuranceInfo = {
  has_insurance?: boolean | null;
  insurance_provider?: string;
  policy_number?: string;
  group_number?: string;
  subscriber_name?: string;
  subscriber_dob?: string;
  relationship_to_subscriber?: string;
};

type DocumentSignature = {
  id: string;
  signed_name: string | null;
  signed_at: string;
  signature_image: string | null;
  additional_fields: Record<string, unknown> | null;
  intake_documents: { id: string; name: string; requires_signature: boolean } | null;
};

type SubmissionDetail = {
  id: string;
  status: string;
  patient_name: string | null;
  patient_phone: string | null;
  patient_email: string | null;
  patient_dob: string | null;
  patient_address: string | null;
  demographics: Demographics | null;
  insurance: InsuranceInfo | null;
  signature_data: string | null;
  signed_name: string | null;
  phq9_answers: number[] | null;
  phq9_score: number | null;
  phq9_severity: string | null;
  gad7_answers: number[] | null;
  gad7_score: number | null;
  gad7_severity: string | null;
  additional_notes: string | null;
  completed_at: string | null;
  created_at: string;
  intake_document_signatures: DocumentSignature[];
};

const PHQ9_QUESTIONS = [
  "Little interest or pleasure in doing things",
  "Feeling down, depressed, or hopeless",
  "Trouble falling/staying asleep, or sleeping too much",
  "Feeling tired or having little energy",
  "Poor appetite or overeating",
  "Feeling bad about yourself, or that you are a failure",
  "Trouble concentrating on things",
  "Moving/speaking slowly or being fidgety/restless",
  "Thoughts that you would be better off dead, or of hurting yourself",
];

const GAD7_QUESTIONS = [
  "Feeling nervous, anxious, or on edge",
  "Not being able to stop or control worrying",
  "Worrying too much about different things",
  "Trouble relaxing",
  "Being so restless that it's hard to sit still",
  "Becoming easily annoyed or irritable",
  "Feeling afraid, as if something awful might happen",
];

const ANSWER_LABELS = ["Not at all", "Several days", "More than half the days", "Nearly every day"];

const SEVERITY_COLORS: Record<string, string> = {
  Minimal: "bg-green-100 text-green-800 border-green-200",
  Mild: "bg-yellow-100 text-yellow-800 border-yellow-200",
  Moderate: "bg-orange-100 text-orange-800 border-orange-200",
  "Moderately Severe": "bg-red-100 text-red-800 border-red-200",
  Severe: "bg-red-200 text-red-900 border-red-300",
};

const REFERRAL_LABELS: Record<string, string> = {
  doctor_referral: "Doctor / Medical Referral",
  insurance: "Insurance Provider",
  friend_family: "Friend or Family",
  online_search: "Online Search",
  social_media: "Social Media",
  psychology_today: "Psychology Today",
  other: "Other",
};

async function apiFetch(url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

function formatDate(iso: string | null) {
  if (!iso) return " - ";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatDateTime(iso: string | null) {
  if (!iso) return " - ";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <span className="text-sm font-medium text-gray-500 sm:w-40 shrink-0">{label}</span>
      <span className="text-sm text-gray-900">{value ?? " - "}</span>
    </div>
  );
}

function ScoreCard({ title, score, severity, answers, questions, maxScore }: {
  title: string;
  score: number | null;
  severity: string | null;
  answers: number[] | null;
  questions: string[];
  maxScore: number;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <button onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-4">
          <div>
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <p className="text-xs text-gray-400 mt-0.5">{questions.length} questions | max {maxScore}</p>
          </div>
          {score !== null && severity ? (
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold border ${SEVERITY_COLORS[severity] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
              {severity} | {score}
            </span>
          ) : (
            <span className="text-gray-400 text-sm">Not completed</span>
          )}
        </div>
        <span className="text-gray-400 text-lg">{expanded ? "^" : "v"}</span>
      </button>

      {expanded && answers && answers.length > 0 && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {questions.map((q, i) => {
            const ans = answers[i] ?? 0;
            return (
              <div key={i} className="flex items-start gap-4 px-5 py-3">
                <span className="text-xs text-gray-400 w-5 shrink-0 mt-0.5">{i + 1}.</span>
                <div className="flex-1">
                  <p className="text-sm text-gray-700">{q}</p>
                  <p className="text-xs mt-1">
                    <span className={`font-medium ${ans === 0 ? "text-green-600" : ans === 1 ? "text-yellow-600" : ans === 2 ? "text-orange-600" : "text-red-600"}`}>
                      {ANSWER_LABELS[ans] ?? ans}
                    </span>
                    <span className="text-gray-400 ml-1">({ans})</span>
                  </p>
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between px-5 py-3 bg-gray-50">
            <span className="text-sm font-medium text-gray-700">Total Score</span>
            <span className="text-sm font-bold text-gray-900">{score} / {maxScore}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function IntakeDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;
  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [showSignature, setShowSignature] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/intake/submissions/${id}`);
        if (res.status === 401) { router.push("/login"); return; }
        if (res.status === 404) { setError("Submission not found"); return; }
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load");
        setSubmission(json.submission);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load submission");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, router]);

  const handleResend = async (method: 'sms' | 'email' | 'both') => {
    if (!submission) return;
    setResending(true);
    setResendSuccess(null);
    setResendError(null);
    try {
      const res = await fetch('/api/intake/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intake_form_id: submission.id,
          delivery_method: method,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resend');
      const methods: string[] = [];
      if (data.sms_sent) methods.push('SMS');
      if (data.email_sent) methods.push('email');
      setResendSuccess('Intake forms resent via ' + methods.join(' and ') + '!');
    } catch (err: any) {
      setResendError(err.message || 'Failed to resend intake forms');
    } finally {
      setResending(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !submission) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">{error ?? "Submission not found"}</p>
          <button onClick={() => router.push("/dashboard/intake")} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700">
            Back to Intake
          </button>
        </div>

        {resendSuccess && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
            {resendSuccess}
          </div>
        )}
        {resendError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
            {resendError}
          </div>
        )}

        {submission?.status !== 'completed' && (submission?.patient_phone || submission?.patient_email) && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Resend Intake Forms</h3>
            <div className="flex gap-2 flex-wrap">
              {submission?.patient_phone && (
                <button
                  onClick={() => handleResend('sms')}
                  disabled={resending}
                  className="px-3 py-1.5 bg-teal-600 text-white text-sm rounded hover:bg-teal-700 disabled:opacity-50"
                >
                  {resending ? 'Sending...' : 'Resend via SMS'}
                </button>
              )}
              {submission?.patient_email && (
                <button
                  onClick={() => handleResend('email')}
                  disabled={resending}
                  className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {resending ? 'Sending...' : 'Resend via Email'}
                </button>
              )}
              {submission?.patient_phone && submission?.patient_email && (
                <button
                  onClick={() => handleResend('both')}
                  disabled={resending}
                  className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-50"
                >
                  {resending ? 'Sending...' : 'Resend Both'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  const sigs = submission.intake_document_signatures ?? [];
  const demo = submission.demographics;
  const ins = submission.insurance;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/dashboard/intake")} className="text-sm text-gray-500 hover:text-teal-600 transition-colors">
               Intake
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{submission.patient_name ?? "Unnamed Patient"}</h1>
              <p className="text-sm text-gray-500 mt-0.5">Submitted {formatDateTime(submission.completed_at)}</p>
            </div>
          </div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
            submission.status === "completed" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
          }`}>
            {submission.status.charAt(0).toUpperCase() + submission.status.slice(1)}
          </span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-5">
        {/* Patient Information */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Patient Information</h2>
          <InfoRow label="Full Name" value={submission.patient_name} />
          <InfoRow label="Phone" value={demo?.phone || submission.patient_phone} />
          <InfoRow label="Email" value={demo?.email || submission.patient_email} />
          <InfoRow label="Date of Birth" value={demo?.date_of_birth ? formatDate(demo.date_of_birth) : submission.patient_dob ? formatDate(submission.patient_dob) : null} />
          <InfoRow label="Pronouns" value={demo?.preferred_pronouns || null} />
          <InfoRow label="Address" value={
            demo ? [demo.address, demo.city, demo.state, demo.zip].filter(Boolean).join(", ") || null : submission.patient_address
          } />
          <InfoRow label="Referral Source" value={demo?.referral_source ? (REFERRAL_LABELS[demo.referral_source] ?? demo.referral_source) : null} />
        </div>

        {/* Emergency Contact */}
        {demo && (demo.emergency_contact_name || demo.emergency_contact_phone) && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Emergency Contact</h2>
            <InfoRow label="Name" value={demo.emergency_contact_name || null} />
            <InfoRow label="Phone" value={demo.emergency_contact_phone || null} />
            <InfoRow label="Relationship" value={demo.emergency_contact_relationship || null} />
          </div>
        )}

        {/* Insurance */}
        {ins && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Insurance Information</h2>
            {ins.has_insurance === false ? (
              <p className="text-sm text-gray-600">Self-pay / No insurance</p>
            ) : (
              <>
                <InfoRow label="Provider" value={ins.insurance_provider || null} />
                <InfoRow label="Policy/Member ID" value={ins.policy_number || null} />
                <InfoRow label="Group Number" value={ins.group_number || null} />
                <InfoRow label="Subscriber" value={ins.subscriber_name || null} />
                <InfoRow label="Subscriber DOB" value={ins.subscriber_dob ? formatDate(ins.subscriber_dob) : null} />
                <InfoRow label="Relationship" value={ins.relationship_to_subscriber || null} />
              </>
            )}
          </div>
        )}

        {/* PHQ-9 & GAD-7 */}
        <ScoreCard title="PHQ-9  - Depression Screen" score={submission.phq9_score} severity={submission.phq9_severity}
          answers={submission.phq9_answers} questions={PHQ9_QUESTIONS} maxScore={27} />

        <ScoreCard title="GAD-7  - Anxiety Screen" score={submission.gad7_score} severity={submission.gad7_severity}
          answers={submission.gad7_answers} questions={GAD7_QUESTIONS} maxScore={21} />

        {/* Additional Notes */}
        {submission.additional_notes && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Additional Notes</h2>
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{submission.additional_notes}</p>
          </div>
        )}

        {/* Signed Documents */}
        {sigs.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Signed Documents</h2>
            <div className="space-y-3">
              {sigs.map((sig) => (
                <div key={sig.id} className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="text-green-500 mt-0.5 text-lg"></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{sig.intake_documents?.name ?? "Document"}</p>
                    {sig.signed_name && (
                      <p className="text-xs text-gray-500 mt-0.5">Signed as: <span className="font-medium">{sig.signed_name}</span></p>
                    )}
                    {!sig.intake_documents?.requires_signature && (
                      <p className="text-xs text-gray-400 mt-0.5">Read & acknowledged</p>
                    )}
                    {sig.signature_image && (
                      <div className="mt-2">
                        <img src={sig.signature_image} alt="Document signature" className="h-12 border border-gray-200 rounded bg-white p-1" />
                      </div>
                    )}
                    {sig.additional_fields && Object.keys(sig.additional_fields).length > 0 && (
                      <div className="mt-2 space-y-1">
                        {Object.entries(sig.additional_fields).map(([k, v]) => (
                          <p key={k} className="text-xs text-gray-600">
                            <span className="font-medium">{k}:</span> {String(v)}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-400">{formatDateTime(sig.signed_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Patient Consent Signature */}
        {(submission.signed_name || submission.signature_data) && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Patient Consent Signature</h2>
            {submission.signed_name && (
              <InfoRow label="Signed Name" value={submission.signed_name} />
            )}
            {submission.signature_data && (
              <div className="mt-3">
                <button onClick={() => setShowSignature(!showSignature)}
                  className="text-sm text-teal-600 hover:text-teal-700 font-medium">
                  {showSignature ? "Hide signature" : "View signature"}
                </button>
                {showSignature && (
                  <div className="mt-2 p-3 border border-gray-200 rounded-xl bg-gray-50 inline-block">
                    <img src={submission.signature_data} alt="Patient consent signature" className="h-20" />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="text-xs text-gray-400 text-center pb-4">
          Form ID: {submission.id} | Created {formatDateTime(submission.created_at)}
        </div>
      </div>
    </div>
  );
}
