"use client";
// MFAEnroll.tsx
// HIPAA §164.312(d) — Person or Entity Authentication
// Allows users to enroll in TOTP-based multi-factor authentication.
// Supabase handles the TOTP secret + QR code generation.

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";

const supabase = createClient();

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

export default function MFAEnroll({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState<"qr" | "verify">("qr");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [enrolling, setEnrolling] = useState(false);

  async function startEnroll() {
    setEnrolling(true);
    setError(null);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Harbor Authenticator",
      });
      if (error) throw error;
      setFactorId(data.id);
      setQrUri(data.totp.uri);
      setSecret(data.totp.secret);
      setStep("qr");
    } catch (err: any) {
      setError(err.message || "Failed to start MFA enrollment.");
    } finally {
      setEnrolling(false);
    }
  }

  async function verifyCode() {
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

      // Audit log
      fetch("/api/audit-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mfa_enrolled",
          details: { factor_id: factorId },
        }),
      }).catch(() => {});

      onComplete();
    } catch (err: any) {
      setError(err.message || "Invalid code. Please try again.");
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  // Auto-start enrollment when component mounts
  if (!factorId && !enrolling && !error) {
    startEnroll();
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 max-w-md">
      <h3 className="text-base font-semibold text-gray-900 mb-1">
        Set Up Two-Factor Authentication
      </h3>
      <p className="text-sm text-gray-500 mb-4">
        Scan the QR code with an authenticator app (Google Authenticator, Authy,
        1Password, etc.)
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {enrolling ? (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
        </div>
      ) : qrUri ? (
        <>
          <div className="flex justify-center mb-4">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUri)}`}
              alt="MFA QR Code"
              className="rounded-lg border border-gray-200"
              width={200}
              height={200}
            />
          </div>

          {secret && (
            <div className="mb-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500 mb-1">
                Can't scan? Enter this key manually:
              </p>
              <p className="font-mono text-sm text-gray-900 break-all select-all">
                {secret}
              </p>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Enter the 6-digit code from your app
            </label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.length === 6) verifyCode();
              }}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none text-center text-lg font-mono tracking-[0.5em]"
              placeholder="000000"
              autoFocus
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={verifyCode}
              disabled={loading || code.length !== 6}
              className="flex-1 py-2.5 rounded-lg text-white text-sm font-medium transition-opacity disabled:opacity-60"
              style={{ backgroundColor: "#1f375d" }}
            >
              {loading ? "Verifying..." : "Verify & Enable"}
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-2.5 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
