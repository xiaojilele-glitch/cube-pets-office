import { useEffect } from "react";
import { Grid3X3, TriangleAlert } from "lucide-react";

import { EmptyHintBlock } from "@/components/tasks/EmptyHintBlock";
import { useAppStore } from "@/lib/store";
import { usePermissionStore } from "@/lib/permission-store";
import { ACTIONS, RESOURCE_TYPES } from "@shared/permission/contracts";
import type { Permission } from "@shared/permission/contracts";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function getCellEffect(
  permissions: Permission[],
  resourceType: string,
  action: string
): "allow" | "deny" | "none" {
  const deny = permissions.find(
    permission =>
      permission.resourceType === resourceType &&
      permission.action === action &&
      permission.effect === "deny"
  );
  if (deny) return "deny";

  const allow = permissions.find(
    permission =>
      permission.resourceType === resourceType &&
      permission.action === action &&
      permission.effect === "allow"
  );
  if (allow) return "allow";

  return "none";
}

const CELL_COLORS: Record<string, string> = {
  allow: "bg-green-500/80",
  deny: "bg-red-500/80",
  none: "bg-gray-200 text-gray-500",
};

const CELL_LABELS: Record<string, string> = {
  allow: "A",
  deny: "D",
  none: "-",
};

export function PermissionMatrix({ agentId }: { agentId: string }) {
  const locale = useAppStore(state => state.locale);
  const policy = usePermissionStore(state => state.policies[agentId]);
  const roles = usePermissionStore(state => state.roles);
  const loadingPolicies = usePermissionStore(state => state.loadingPolicies);
  const policyError = usePermissionStore(
    state => state.policyErrors[agentId] ?? null
  );
  const fetchPolicy = usePermissionStore(state => state.fetchPolicy);

  useEffect(() => {
    if (agentId && !policy) {
      void fetchPolicy(agentId);
    }
  }, [agentId, policy, fetchPolicy]);

  if (loadingPolicies && !policy) {
    return (
      <div className="flex items-center justify-center py-8 text-[11px] text-[#B08F72]">
        {t(locale, "正在加载权限矩阵…", "Loading permission matrix...")}
      </div>
    );
  }

  if (policyError && !policy) {
    return (
      <EmptyHintBlock
        tone={policyError.kind === "error" ? "danger" : "warning"}
        icon={<TriangleAlert className="size-5" />}
        title={t(
          locale,
          "权限矩阵暂时不可用",
          "Permission matrix is unavailable"
        )}
        description={
          policyError.kind === "demo"
            ? t(
                locale,
                "当前仍在演示模式，这个 Agent 还没有可读取的服务端权限策略。",
                "The app is still in preview mode, so this agent does not have a live server-side policy yet."
              )
            : policyError.kind === "offline"
              ? t(
                  locale,
                  "权限服务暂时不可达，无法读取最新策略。",
                  "The permission service is currently unreachable, so the latest policy could not be loaded."
                )
              : t(
                  locale,
                  "权限接口返回了异常结果，界面已经拦截了原始技术报错。",
                  "The permission API returned an unexpected result, and the raw parser error was suppressed."
                )
        }
        hint={policyError.message}
        actionLabel={t(locale, "重试加载", "Retry")}
        onAction={() => void fetchPolicy(agentId)}
      />
    );
  }

  if (!policy) {
    return (
      <EmptyHintBlock
        tone="info"
        icon={<Grid3X3 className="size-5" />}
        title={t(locale, "还没有权限矩阵", "No permission matrix yet")}
        description={t(
          locale,
          "选中一个已经下发策略的 Agent 后，这里会展示它的资源和动作矩阵。",
          "Select an agent with an assigned policy to view its resource and action matrix here."
        )}
      />
    );
  }

  const allPermissions: Permission[] = [];

  for (const roleId of policy.assignedRoles) {
    const role = roles.find(entry => entry.roleId === roleId);
    if (role) {
      allPermissions.push(...role.permissions);
    }
  }

  allPermissions.push(...policy.customPermissions);
  allPermissions.push(...policy.deniedPermissions);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Grid3X3 className="h-3.5 w-3.5 text-[#8B7355]" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8B7355]">
          {t(locale, "权限矩阵", "Permission matrix")}
        </p>
      </div>

      <div className="mb-3 flex gap-3">
        {[
          {
            key: "allow",
            label: t(locale, "允许", "Allowed"),
            color: "bg-green-500/80",
          },
          {
            key: "deny",
            label: t(locale, "拒绝", "Denied"),
            color: "bg-red-500/80",
          },
          {
            key: "none",
            label: t(locale, "未配置", "No rule"),
            color: "bg-gray-200",
          },
        ].map(item => (
          <div key={item.key} className="flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded ${item.color}`} />
            <span className="text-[10px] text-[#6B5A4A]">{item.label}</span>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr>
              <th className="border-b border-[#E8DDD0] px-2 py-1.5 text-left font-semibold text-[#8B7355]">
                {t(locale, "资源", "Resource")}
              </th>
              {ACTIONS.map(action => (
                <th
                  key={action}
                  className="border-b border-[#E8DDD0] px-2 py-1.5 text-center font-semibold text-[#8B7355]"
                >
                  {action}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RESOURCE_TYPES.map(resourceType => (
              <tr key={resourceType} className="border-b border-[#F0E8E0]">
                <td className="px-2 py-1.5 font-medium text-[#3A2A1A]">
                  {resourceType}
                </td>
                {ACTIONS.map(action => {
                  const effect = getCellEffect(
                    allPermissions,
                    resourceType,
                    action
                  );
                  return (
                    <td key={action} className="px-1 py-1 text-center">
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold ${CELL_COLORS[effect]} ${
                          effect === "none" ? "" : "text-white"
                        }`}
                        title={`${resourceType} / ${action}: ${effect}`}
                      >
                        {CELL_LABELS[effect]}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
