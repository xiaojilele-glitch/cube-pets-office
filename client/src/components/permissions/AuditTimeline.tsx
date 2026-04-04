/**
 * Audit timeline — chronological list of permission changes.
 *
 * Shows timestamp, agent, operation, resource, and result for each entry.
 *
 * @see Requirements 13.4
 */

import { useEffect } from "react";
import { Clock, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

import { useAppStore } from "@/lib/store";
import { usePermissionStore } from "@/lib/permission-store";
import type { PermissionAuditEntry } from "@shared/permission/contracts";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

const RESULT_CONFIG: Record<
  string,
  { icon: typeof CheckCircle; color: string; bg: string }
> = {
  allowed: { icon: CheckCircle, color: "text-green-600", bg: "bg-green-50" },
  denied: { icon: XCircle, color: "text-red-600", bg: "bg-red-50" },
  error: { icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50" },
};

const OP_LABELS: Record<string, { zh: string; en: string }> = {
  check: { zh: "权限检查", en: "Check" },
  grant: { zh: "授予权限", en: "Grant" },
  revoke: { zh: "撤销权限", en: "Revoke" },
  escalate: { zh: "权限提升", en: "Escalate" },
  policy_change: { zh: "策略变更", en: "Policy Change" },
};

function AuditEntry({
  entry,
  locale,
}: {
  entry: PermissionAuditEntry;
  locale: string;
}) {
  const cfg = RESULT_CONFIG[entry.result] ?? RESULT_CONFIG.error;
  const Icon = cfg.icon;
  const opLabel = OP_LABELS[entry.operation];

  return (
    <div className="flex gap-3">
      {/* Timeline dot + line */}
      <div className="flex flex-col items-center">
        <div className={`flex h-6 w-6 items-center justify-center rounded-full ${cfg.bg}`}>
          <Icon className={`h-3 w-3 ${cfg.color}`} />
        </div>
        <div className="w-px flex-1 bg-[#E8DDD0]" />
      </div>

      {/* Content */}
      <div className="pb-4 min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-[#3A2A1A]">
            {opLabel ? t(locale, opLabel.zh, opLabel.en) : entry.operation}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${cfg.bg} ${cfg.color}`}>
            {entry.result}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[#6B5A4A]">
          <span>{entry.resourceType} / {entry.action}</span>
          {entry.resource && (
            <span className="truncate max-w-[200px]" title={entry.resource}>
              {entry.resource}
            </span>
          )}
        </div>

        {entry.reason && (
          <p className="mt-1 text-[10px] text-[#8B7355] italic">{entry.reason}</p>
        )}

        <div className="mt-1 flex items-center gap-1 text-[9px] text-[#B08F72]">
          <Clock className="h-2.5 w-2.5" />
          <span>{formatDate(entry.timestamp)} {formatTime(entry.timestamp)}</span>
          {entry.operator && (
            <span className="ml-2">by {entry.operator}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function AuditTimeline({ agentId }: { agentId: string }) {
  const locale = useAppStore((s) => s.locale);
  const auditEntries = usePermissionStore((s) => s.auditTrail[agentId] ?? []);
  const fetchAuditTrail = usePermissionStore((s) => s.fetchAuditTrail);
  const loadingAudit = usePermissionStore((s) => s.loadingAudit);

  useEffect(() => {
    if (agentId) {
      void fetchAuditTrail(agentId);
    }
  }, [agentId, fetchAuditTrail]);

  if (loadingAudit && auditEntries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-[11px] text-[#B08F72]">
        {t(locale, "加载中…", "Loading…")}
      </div>
    );
  }

  if (auditEntries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-[11px] text-[#B08F72]">
        {t(locale, "暂无审计记录", "No audit entries")}
      </div>
    );
  }

  // Sort by timestamp descending (newest first)
  const sorted = [...auditEntries].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Clock className="h-3.5 w-3.5 text-[#8B7355]" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8B7355]">
          {t(locale, "审计时间轴", "Audit Timeline")}
        </p>
        <span className="ml-auto rounded-full bg-[#F0E8E0] px-2 py-0.5 text-[9px] font-medium text-[#6B5A4A]">
          {sorted.length}
        </span>
      </div>

      <div className="max-h-[400px] overflow-y-auto">
        {sorted.map((entry) => (
          <AuditEntry key={entry.id} entry={entry} locale={locale} />
        ))}
      </div>
    </div>
  );
}
