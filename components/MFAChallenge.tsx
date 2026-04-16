"use client";
// MFAChallenge.tsx
// HIPAA §164.312(d) — Person or Entity Authentication
// Prompts for TOTP code after email/password login when MFA is enrolled.

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase-browser";

const supabase = createClient();

interface Props {
  onVerified: () => void;
  onCancel: () => void;
}

export default function MFAChallenge({ onVerified, onCancel }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);

  useEffect(() => {
    // Get the user's enrolled TOTP factor
    supabase.auth.mfa.listFactors().then(({ data }) => {
      const totp = data?.totp?.[0];
      if (totp) setFactorId(totp.id);
    });
  }, []);

  async function handleVerify() {
    if (!factorId || code.length !== 6) return;
    setLoading(true);
    setError(null);

    try {
      const { data: challenge, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      });
      if (verifyError) throw verifyError;

      // Audit: MFA verified
      fetch("/api/audit-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mfa_verified",
          details: { factor_id: factorId },
        }),
      }).catch(() => {});

      onVerified();
    } catch (err: any) {
      setError("Invalid code. Please try again.");
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-teal-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/harbor-logo.svg" alt="Harbor" className="h-16 mx-auto mb-4" />
          <p className="text-sm text-gray-500">AI Receptionist for Therapy Practices</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-teal-50 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="3" y="8" width="14" height="10" rx="2" stroke="#0d9488" strokeWidth="1.5" />
                <path d="M6 8V5a4 4 0 018 0v3" stroke="#0d9488" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="10" cy="13" r="1.5" fill="#0d9488" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Two-Factor Authentication
              </h2>
              <p className="text-sm text-gray-500">
                Enter the code from your authenticator app
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mb-6">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.length === 6) handleVerify();
              }}
              className="w-full px-3 py-3 rounded-lg border border-gray-200 focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none text-center text-xl font-mono tracking-[0.5em]"
              placeholder="000000"
              autoFocus
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleVerify}
              disabled={loading || code.length !== 6}
              className="flex-1 py-2.5 rounded-lg text-white text-sm font-medium transition-opacity disabled:opacity-60"
              style={{ backgroundColor: "#1f375d" }}
            >
              {loading ? "Verifying..." : "Verify"}
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-2.5 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50"
            >
              Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
