"use client";
// app/dashboard/intake/[id]/page.tsx
// Harbor — Intake Submission Detail View

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type DocumentSignature = {
  id: string;
  signed_name: string | null;
  signed_at: string;
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

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <span className="text-sm font-medium text-gray-500 sm:w-36 shrink-0">{label}</span>
      <span className="text-sm text-gray-900">{value ?? "—"}</span>
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
            <p className="text-xs text-gray-400 mt-0.5">{questions.length} questions · max {maxScore}</p>
          </div>
          {score !== null && severity ? (
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold border ${SEVERITY_COLORS[severity] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
              {severity} · {score}
            </span>
          ) : (
            <span className="text-gray-400 text-sm">Not completed</span>
          )}
        </div>
        <span className="text-gray-400 text-lg">{expanded ? "▲" : "▼"}</span>
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
      </div>
    );
  }

  const sigs = submission.intake_document_signatures ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/dashboard/intake")} className="text-sm text-gray-500 hover:text-teal-600 transition-colors">
              ← Intake
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
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Patient Information</h2>
          <InfoRow label="Full Name" value={submission.patient_name} />
          <InfoRow label="Phone" value={submission.patient_phone} />
          <InfoRow label="Email" value={submission.patient_email} />
          <InfoRow label="Date of Birth" value={submission.patient_dob ? formatDate(submission.patient_dob) : null} />
          <InfoRow label="Address" value={submission.patient_address} />
        </div>

        <ScoreCard title="PHQ-9 — Depression Screen" score={submission.phq9_score} severity={submission.phq9_severity}
          answers={submission.phq9_answers} questions={PHQ9_QUESTIONS} maxScore={27} />

        <ScoreCard title="GAD-7 — Anxiety Screen" score={submission.gad7_score} severity={submission.gad7_severity}
          answers={submission.gad7_answers} questions={GAD7_QUESTIONS} maxScore={21} />

        {submission.additional_notes && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Additional Notes</h2>
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{submission.additional_notes}</p>
          </div>
        )}

        {sigs.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Signed Documents</h2>
            <div className="space-y-3">
              {sigs.map((sig) => (
                <div key={sig.id} className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="text-green-500 mt-0.5 text-lg">✓</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{sig.intake_documents?.name ?? "Document"}</p>
                    {sig.signed_name && (
                      <p className="text-xs text-gray-500 mt-0.5">Signed as: <span className="font-medium">{sig.signed_name}</span></p>
                    )}
                    {!sig.intake_documents?.requires_signature && (
                      <p className="text-xs text-gray-400 mt-0.5">Read & acknowledged</p>
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

        <div className="text-xs text-gray-400 text-center pb-4">
          Form ID: {submission.id} · Created {formatDateTime(submission.created_at)}
        </div>
      </div>
    </div>
  );
}
