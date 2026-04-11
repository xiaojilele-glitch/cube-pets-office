import { useState } from "react";
import {
  ArrowRight,
  Link2,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
} from "lucide-react";

import { EmptyHintBlock } from "@/components/tasks/EmptyHintBlock";
import { useAuditStore } from "@/lib/audit-store";

function shortHash(hash: string): string {
  if (!hash || hash.length < 12) return hash || "-";
  return `${hash.slice(0, 6)}...${hash.slice(-6)}`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function AuditChainVerifier() {
  const verificationResult = useAuditStore(state => state.verificationResult);
  const loadingVerification = useAuditStore(state => state.loadingVerification);
  const verificationError = useAuditStore(state => state.verificationError);
  const hasLoadedVerification = useAuditStore(
    state => state.hasLoadedVerification
  );
  const triggerVerification = useAuditStore(state => state.triggerVerification);
  const fetchVerification = useAuditStore(state => state.fetchVerification);
  const entries = useAuditStore(state => state.entries);
  const [verifying, setVerifying] = useState(false);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      await triggerVerification();
    } finally {
      setVerifying(false);
    }
  };

  const chainEntries = entries.slice(0, 5);

  return (
    <div className="space-y-4 p-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleVerify()}
          disabled={verifying || loadingVerification}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#5E8B72] px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#4d7a61] disabled:opacity-50"
        >
          <ShieldCheck className="size-3.5" />
          {verifying ? "Verifying..." : "Verify chain"}
        </button>
        <button
          type="button"
          onClick={() => void fetchVerification()}
          disabled={loadingVerification}
          className="inline-flex items-center gap-1.5 rounded-xl bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-600 transition-colors hover:bg-stone-200 disabled:opacity-50"
        >
          <RefreshCw className="size-3.5" />
          Refresh status
        </button>
      </div>

      {verificationError && !verificationResult ? (
        <EmptyHintBlock
          tone={verificationError.kind === "error" ? "danger" : "warning"}
          icon={<TriangleAlert className="size-5" />}
          title={
            verificationError.kind === "demo"
              ? "Chain verification is unavailable in preview mode"
              : verificationError.kind === "offline"
                ? "Chain verification service is unavailable"
                : "Chain verification failed"
          }
          description={
            verificationError.kind === "demo"
              ? "The frontend is not connected to the audit backend yet, so integrity verification cannot run."
              : verificationError.kind === "offline"
                ? "The audit backend is currently unreachable, so the verification request could not complete."
                : "The audit verification API returned an unexpected result, and the raw parser error was hidden from the UI."
          }
          hint={verificationError.message}
          actionLabel="Retry"
          onAction={() => void fetchVerification()}
        />
      ) : verificationResult ? (
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
              {verificationResult.valid ? "Chain valid" : "Chain invalid"}
            </span>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-stone-600">
            <div>
              <span className="font-medium">Checked range:</span>{" "}
              {verificationResult.checkedRange.start} -{" "}
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

          {verificationResult.errors.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs font-semibold text-red-700">Errors:</p>
              {verificationResult.errors.map((error, index) => (
                <div
                  key={`${error.entryId}-${index}`}
                  className="rounded-lg border border-red-200 bg-white/60 p-2 text-xs text-red-700"
                >
                  <span className="font-semibold">
                    [{error.errorType}] seq#{error.sequenceNumber}
                  </span>{" "}
                  - {error.message}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyHintBlock
          tone="info"
          icon={<ShieldCheck className="size-5" />}
          title={
            loadingVerification && !hasLoadedVerification
              ? "Loading verification status"
              : "No verification result yet"
          }
          description={
            loadingVerification && !hasLoadedVerification
              ? "Fetching the latest audit-chain integrity status from the backend."
              : "Run a chain verification to confirm whether the recent audit log remains intact."
          }
          hint="Verification stays local to this panel, so you can retry without refreshing the whole page."
          actionLabel="Verify now"
          onAction={() => void handleVerify()}
        />
      )}

      {chainEntries.length > 0 ? (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-stone-600">
            <Link2 className="size-3.5" />
            Recent hash chain (last {chainEntries.length} entries)
          </p>
          <div className="flex flex-wrap items-center gap-1">
            {[...chainEntries].reverse().map((entry, index) => (
              <div key={entry.entryId} className="flex items-center gap-1">
                <div className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-[10px]">
                  <div className="font-semibold text-stone-700">
                    #{entry.sequenceNumber}
                  </div>
                  <div className="font-mono text-stone-400">
                    {shortHash(entry.currentHash)}
                  </div>
                </div>
                {index < chainEntries.length - 1 ? (
                  <ArrowRight className="size-3 text-stone-300" />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
