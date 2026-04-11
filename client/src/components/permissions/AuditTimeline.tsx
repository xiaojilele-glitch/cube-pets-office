import { useEffect } from "react";
import { AlertTriangle, CheckCircle, Clock, XCircle } from "lucide-react";

import { EmptyHintBlock } from "@/components/tasks/EmptyHintBlock";
import { useAppStore } from "@/lib/store";
import { usePermissionStore } from "@/lib/permission-store";
import type { PermissionAuditEntry } from "@shared/permission/contracts";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

const RESULT_CONFIG: Record<
  string,
  { icon: typeof CheckCircle; color: string; background: string }
> = {
  allowed: {
    icon: CheckCircle,
    color: "text-green-600",
    background: "bg-green-50",
  },
  denied: { icon: XCircle, color: "text-red-600", background: "bg-red-50" },
  error: {
    icon: AlertTriangle,
    color: "text-amber-600",
    background: "bg-amber-50",
  },
};

const OPERATION_LABELS: Record<string, { zh: string; en: string }> = {
  check: { zh: "权限检查", en: "Permission check" },
  grant: { zh: "授予权限", en: "Grant permission" },
  revoke: { zh: "撤销权限", en: "Revoke permission" },
  escalate: { zh: "权限提升", en: "Escalate permission" },
  policy_change: { zh: "策略变更", en: "Policy change" },
};

function AuditEntry({
  entry,
  locale,
}: {
  entry: PermissionAuditEntry;
  locale: string;
}) {
  const config = RESULT_CONFIG[entry.result] ?? RESULT_CONFIG.error;
  const Icon = config.icon;
  const operation = OPERATION_LABELS[entry.operation];

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={`flex h-6 w-6 items-center justify-center rounded-full ${config.background}`}
        >
          <Icon className={`h-3 w-3 ${config.color}`} />
        </div>
        <div className="w-px flex-1 bg-[#E8DDD0]" />
      </div>

      <div className="min-w-0 flex-1 pb-4">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-[#3A2A1A]">
            {operation
              ? t(locale, operation.zh, operation.en)
              : entry.operation}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${config.background} ${config.color}`}
          >
            {entry.result}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[#6B5A4A]">
          <span>
            {entry.resourceType} / {entry.action}
          </span>
          {entry.resource ? (
            <span className="max-w-[200px] truncate" title={entry.resource}>
              {entry.resource}
            </span>
          ) : null}
        </div>

        {entry.reason ? (
          <p className="mt-1 text-[10px] italic text-[#8B7355]">
            {entry.reason}
          </p>
        ) : null}

        <div className="mt-1 flex items-center gap-1 text-[9px] text-[#B08F72]">
          <Clock className="h-2.5 w-2.5" />
          <span>{formatTime(entry.timestamp)}</span>
          {entry.operator ? (
            <span className="ml-2">by {entry.operator}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function AuditTimeline({ agentId }: { agentId: string }) {
  const locale = useAppStore(state => state.locale);
  const auditEntries = usePermissionStore(
    state => state.auditTrail[agentId] ?? []
  );
  const loadingAudit = usePermissionStore(state => state.loadingAudit);
  const auditError = usePermissionStore(
    state => state.auditErrors[agentId] ?? null
  );
  const fetchAuditTrail = usePermissionStore(state => state.fetchAuditTrail);

  useEffect(() => {
    if (agentId) {
      void fetchAuditTrail(agentId);
    }
  }, [agentId, fetchAuditTrail]);

  if (loadingAudit && auditEntries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-[11px] text-[#B08F72]">
        {t(
          locale,
          "正在加载权限审计记录…",
          "Loading permission audit records..."
        )}
      </div>
    );
  }

  if (auditError && auditEntries.length === 0) {
    return (
      <EmptyHintBlock
        tone={auditError.kind === "error" ? "danger" : "warning"}
        icon={<AlertTriangle className="size-5" />}
        title={t(
          locale,
          "权限审计时间线暂时不可用",
          "Permission audit history is unavailable"
        )}
        description={
          auditError.kind === "demo"
            ? t(
                locale,
                "当前仍在演示模式，没有可读取的实时权限审计记录。",
                "The app is still in preview mode, so there is no live permission audit history yet."
              )
            : auditError.kind === "offline"
              ? t(
                  locale,
                  "权限审计服务暂时不可达，无法读取最新记录。",
                  "The permission audit service is currently unreachable, so the latest records could not be loaded."
                )
              : t(
                  locale,
                  "权限审计接口返回了异常结果，界面已经屏蔽原始技术报错。",
                  "The permission audit API returned an unexpected result, and the raw parser error was suppressed."
                )
        }
        hint={auditError.message}
        actionLabel={t(locale, "重试加载", "Retry")}
        onAction={() => void fetchAuditTrail(agentId)}
      />
    );
  }

  if (auditEntries.length === 0) {
    return (
      <EmptyHintBlock
        tone="info"
        icon={<Clock className="size-5" />}
        title={t(
          locale,
          "还没有权限审计记录",
          "No permission audit entries yet"
        )}
        description={t(
          locale,
          "这个 Agent 还没有触发权限检查、授权或撤销动作，所以时间线暂时为空。",
          "This agent has not triggered permission checks, grants, or revocations yet, so the timeline is still empty."
        )}
        hint={t(
          locale,
          "一旦发生权限判断或策略调整，这里会自动追加新的记录。",
          "The timeline will populate automatically after the next permission check or policy change."
        )}
      />
    );
  }

  const sortedEntries = [...auditEntries].sort(
    (left, right) =>
      new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
  );

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 text-[#8B7355]" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8B7355]">
          {t(locale, "权限审计时间线", "Permission audit timeline")}
        </p>
        <span className="ml-auto rounded-full bg-[#F0E8E0] px-2 py-0.5 text-[9px] font-medium text-[#6B5A4A]">
          {sortedEntries.length}
        </span>
      </div>

      <div className="max-h-[400px] overflow-y-auto">
        {sortedEntries.map(entry => (
          <AuditEntry key={entry.id} entry={entry} locale={locale} />
        ))}
      </div>
    </div>
  );
}
