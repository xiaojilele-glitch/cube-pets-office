/**
 * AuditChainVerifier — audit chain integrity verification visualization.
 *
 * Shows verification status, hash chain diagram, and error list.
 *
 * @see Requirements AC-12.4
 */

import { useState } from "react";
import {
  ShieldCheck,
  ShieldX,
  RefreshCw,
  Link2,
  ArrowRight,
} from "lucide-react";
import { useAuditStore } from "@/lib/audit-store";

function shortHash(hash: string): string {
  if (!hash || hash.length < 12) return hash || "—";
  return `${hash.slice(0, 6)}…${hash.slice(-6)}`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function AuditChainVerifier() {
  const verificationResult = useAuditStore((s) => s.verificationResult);
  const triggerVerification = useAuditStore((s) => s.triggerVerification);
  const fetchVerification = useAuditStore((s) => s.fetchVerification);
  const entries = useAuditStore((s) => s.entries);
  const [verifying, setVerifying] = useState(false);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      await triggerVerification();
    } finally {
      setVerifying(false);
    }
  };

  const handleRefresh = async () => {
    await fetchVerification();
  };

  // Show last 5 entries for the hash chain visualization
  const chainEntries = entries.slice(0, 5);

  return (
    <div className="space-y-4 p-2">
      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => void handleVerify()}
          disabled={verifying}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#5E8B72] px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#4d7a61] disabled:opacity-50"
        >
          <ShieldCheck className="size-3.5" />
          {verifying ? "Verifying…" : "Verify Chain"}
        </button>
        <button
          onClick={() => void handleRefresh()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-600 transition-colors hover:bg-stone-200"
        >
          <RefreshCw className="size-3.5" />
          Refresh Status
        </button>
      </div>

      {/* Verification result */}
      {verificationResult ? (
        <div
          className={`rounded-xl border p-3 ${
            verificationResult.valid
              ? "border-emerald-300 bg-emerald-50"
              : "border-red-300 bg-red-50"
          }`}
        >
          <div className="flex items-center gap-2">
            {verificationResult.valid ? (
              <ShieldCheck className="size-5 text-emerald-600" />
            ) : (
              <ShieldX className="size-5 text-red-600" />
            )}
            <span
              className={`text-sm font-semibold ${
                verificationResult.valid ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {verificationResult.valid ? "Chain Valid" : "Chain Invalid"}
            </span>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-stone-600">
            <div>
              <span className="font-medium">Checked range:</span>{" "}
              {verificationResult.checkedRange.start} –{" "}
              {verificationResult.checkedRange.end}
            </div>
            <div>
              <span className="font-medium">Total entries:</span>{" "}
              {verificationResult.totalEntries}
            </div>
            <div>
              <span className="font-medium">Errors:</span>{" "}
              {verificationResult.errors.length}
            </div>
            <div>
              <span className="font-medium">Verified at:</span>{" "}
              {formatTime(verificationResult.verifiedAt)}
            </div>
          </div>

          {/* Error list */}
          {verificationResult.errors.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs font-semibold text-red-700">Errors:</p>
              {verificationResult.errors.map((err, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-red-200 bg-white/60 p-2 text-xs text-red-700"
                >
                  <span className="font-semibold">
                    [{err.errorType}] seq#{err.sequenceNumber}
                  </span>{" "}
                  — {err.message}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-center text-xs text-stone-400">
          No verification result yet. Click "Verify Chain" to start.
        </div>
      )}

      {/* Hash chain visualization */}
      {chainEntries.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-stone-600">
            <Link2 className="size-3.5" />
            Recent Hash Chain (last {chainEntries.length} entries)
          </p>
          <div className="flex flex-wrap items-center gap-1">
            {[...chainEntries].reverse().map((entry, i) => (
              <div key={entry.entryId} className="flex items-center gap-1">
                <div className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-[10px]">
                  <div className="font-semibold text-stone-700">
                    #{entry.sequenceNumber}
                  </div>
                  <div className="font-mono text-stone-400">
                    {shortHash(entry.currentHash)}
                  </div>
                </div>
                {i < chainEntries.length - 1 && (
                  <ArrowRight className="size-3 text-stone-300" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
