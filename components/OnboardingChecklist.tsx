'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-browser';

const supabase = createClient();

async function authFetch(url: string, options?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
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
  const [dismissing, setDismissing] = useState(false);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  useEffect(() => {
    authFetch('/api/onboarding/status')
      .then(res => res.ok ? res.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function handleDismiss() {
    setDismissing(true);
    try {
      await authFetch('/api/onboarding/dismiss', { method: 'POST' });
      setData(prev => prev ? { ...prev, dismissed: true } : null);
    } catch {
      setDismissing(false);
    }
  }

  if (loading || !data || data.dismissed) return null;

  const progress = data.totalCount > 0
    ? Math.round((data.completedCount / data.totalCount) * 100)
    : 0;

  return (
    <div className="bg-white rounded-xl border border-teal-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-teal-500 to-teal-600 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-white font-semibold text-base">
              Welcome to Harbor!
            </h2>
            <p className="text-teal-100 text-sm mt-0.5">
              Complete these steps to get your AI receptionist up and running
            </p>
          </div>
          <button
            onClick={handleDismiss}
            disabled={dismissing}
            className="text-teal-200 hover:text-white text-xs font-medium transition-colors"
          >
            {dismissing ? '...' : 'Dismiss'}
          </button>
        </div>
        <div className="mt-3 bg-teal-400/30 rounded-full h-2">
          <div
            className="bg-white rounded-full h-2 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-teal-100 text-xs mt-1.5">
          {data.completedCount} of {data.totalCount} complete
        </p>
      </div>

      {/* Steps */}
      <div className="divide-y divide-gray-50">
        {data.steps.map((step) => (
          <div key={step.id} className="px-5 py-3.5">
            <div className="flex items-start gap-3">
              {/* Completion circle */}
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                  step.completed
                    ? 'bg-teal-500 border-teal-500'
                    : 'border-gray-300'
                }`}
              >
                {step.completed && (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2.5 6l2.5 2.5 4.5-5"
                      stroke="white"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-medium ${
                    step.completed
                      ? 'text-gray-400 line-through'
                      : 'text-gray-900'
                  }`}
                >
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
                        <p>1. Dial *72 (or your carrier&apos;s forwarding code)</p>
                        <p>2. Enter your Harbor number: {data.practicePhone || '(541) 539-4890'}</p>
                        <p>3. Wait for confirmation tone</p>
                        <p className="text-gray-400 pt-1 border-t border-gray-100">
                          To disable forwarding: dial *73
                        </p>
                      </div>
                    )}
                  </>
                )}

                {/* Test call info */}
                {step.id === 'test_call' && !step.completed && (
                  <p className="text-xs text-teal-600 mt-1.5 font-medium">
                    Call {data.practicePhone || '(541) 539-4890'} to try it out
                  </p>
                )}
              </div>

              {step.action && !step.completed && (
                <Link href={step.action} className="text-xs text-teal-600 hover:text-teal-700 font-medium shrink-0 mt-0.5">
                  Set up &rarr;
                </Link>
              )}

              {step.completed && (
                <span className="text-xs text-teal-500 font-medium shrink-0 mt-0.5">Done</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {data.completedCount === data.totalCount && (
        <div className="px-5 py-4 bg-teal-50 text-center border-t border-teal-100">
          <p className="text-sm font-medium text-teal-700">
            You&apos;re all set! Your AI receptionist is ready.
          </p>
          <button onClick={handleDismiss} className="text-xs text-teal-600 mt-1 hover:text-teal-700 font-medium">
            Hide this guide
          </button>
        </div>
      )}
    </div>
  );
}
