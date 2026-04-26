'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
// Wave 21: supabase-browser stub — Cognito-era no-op.
async function authFetch(url: string, options?: RequestInit) {
  // Wave 21: Cognito session cookie auto-attached on same-origin fetch.
  return fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

type OnboardingStep = {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  action: string | null;
};

type OnboardingData = {
  dismissed: boolean;
  steps: OnboardingStep[];
  completedCount: number;
  totalCount: number;
  practicePhone: string | null;
};

export default function OnboardingChecklist() {
  const [data, setData] = useState<OnboardingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const autoDismissedRef = useRef(false);

  useEffect(() => {
    authFetch('/api/onboarding/status')
      .then((res) => res.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Auto-dismiss when all steps complete
  useEffect(() => {
    if (!data || data.dismissed) return;
    if (data.totalCount === 0) return;
    if (data.completedCount < data.totalCount) return;
    if (autoDismissedRef.current) return;
    autoDismissedRef.current = true;

    // Give the user a moment to see the celebration before hiding
    const t = setTimeout(() => {
      authFetch('/api/onboarding/dismiss', { method: 'POST' })
        .catch(() => {/* non-fatal */})
        .finally(() => {
          setData(prev => prev ? { ...prev, dismissed: true } : null);
        });
    }, 4000);

    return () => clearTimeout(t);
  }, [data]);

  if (loading || !data || data.dismissed) return null;

  const allDone = data.totalCount > 0 && data.completedCount === data.totalCount;
  const progress = data.totalCount > 0
    ? Math.round((data.completedCount / data.totalCount) * 100)
    : 0;

  // Contextual CTA text per step type
  const ctaText = (stepId: string) => {
    switch (stepId) {
      case 'test_call': return 'View calls →';
      case 'connect_calendar': return 'Connect →';
      case 'upload_intake_docs': return 'Upload →';
      default: return 'Set up →';
    }
  };

  return (
    <div className="bg-white rounded-xl border border-teal-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-teal-600 px-5 py-4 text-white">
        <p className="font-semibold text-sm">Welcome to Harbor!</p>
        <p className="text-xs text-teal-100 mt-0.5">
          Complete these steps to get your AI receptionist up and running
        </p>
        <div className="mt-2 h-1.5 bg-teal-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-white rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-teal-200 mt-1">
          {data.completedCount} of {data.totalCount} complete
        </p>
      </div>

      {/* Steps */}
      <div className="divide-y divide-gray-100">
        {data.steps.map((step) => (
          <div key={step.id} className="px-5 py-3.5">
            <div className="flex items-start gap-3">
              {/* Checkbox */}
              <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                step.completed
                  ? 'bg-teal-500 border-teal-500'
                  : 'border-gray-300'
              }`}>
                {step.completed && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${step.completed ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                  {step.title}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {step.description}
                </p>

                {/* Call forwarding instructions */}
                {step.id === 'setup_forwarding' && !step.completed && (
                  <>
                    <button
                      onClick={() =>
                        setExpandedStep(
                          expandedStep === 'setup_forwarding'
                            ? null
                            : 'setup_forwarding'
                        )
                      }
                      className="text-xs text-teal-600 mt-1.5 hover:text-teal-700 font-medium"
                    >
                      {expandedStep === 'setup_forwarding'
                        ? 'Hide instructions'
                        : 'Show me how'}
                    </button>
                    {expandedStep === 'setup_forwarding' && (
                      <div className="mt-2 bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-1.5">
                        <p className="font-medium text-gray-700">
                          From your office phone:
                        </p>
                        <p>1. Dial *72 (or your carrier's forwarding code)</p>
                        <p>2. Enter your Harbor number: {data.practicePhone || '(541) 539-4890'}</p>
                        <p>3. Wait for confirmation tone</p>
                        <p className="text-gray-400 mt-1">To disable forwarding: dial *73</p>
                      </div>
                    )}
                  </>
                )}

                {/* Test call phone number */}
                {step.id === 'test_call' && !step.completed && (
                  <p className="text-xs text-teal-600 mt-1.5 font-medium">
                    Call {data.practicePhone || '(541) 539-4890'} to try it out
                  </p>
                )}
              </div>

              {/* Action link */}
              {step.action && !step.completed && (
                <Link href={step.action} className="text-xs text-teal-600 hover:text-teal-700 font-medium shrink-0 mt-0.5">
                  {ctaText(step.id)}
                </Link>
              )}

              {step.completed && (
                <span className="text-xs text-teal-500 font-medium shrink-0 mt-0.5">Done</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {allDone && (
        <div className="px-5 py-4 bg-teal-50 text-center border-t border-teal-100">
          <p className="text-sm font-medium text-teal-700">
            You're all set! Your AI receptionist is ready.
          </p>
          <p className="text-xs text-teal-600 mt-1">
            This guide will hide automatically in a moment.
          </p>
        </div>
      )}
    </div>
  );
}
