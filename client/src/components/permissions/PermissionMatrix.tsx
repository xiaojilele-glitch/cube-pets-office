/**
 * Permission matrix heatmap view.
 *
 * Displays a grid: rows = resourceTypes, columns = actions.
 * Cells are colored: green = allowed, red = denied, gray = no rule.
 *
 * @see Requirements 13.2
 */

import { useEffect } from "react";
import { Grid3X3 } from "lucide-react";

import { useAppStore } from "@/lib/store";
import { usePermissionStore } from "@/lib/permission-store";
import { RESOURCE_TYPES, ACTIONS } from "@shared/permission/contracts";
import type { Permission } from "@shared/permission/contracts";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

/** Resolve the effective cell state from a flat permission list. */
function getCellEffect(
  permissions: Permission[],
  resourceType: string,
  action: string,
): "allow" | "deny" | "none" {
  // Deny takes priority
  const deny = permissions.find(
    (p) =>
      p.resourceType === resourceType &&
      p.action === action &&
      p.effect === "deny",
  );
  if (deny) return "deny";

  const allow = permissions.find(
    (p) =>
      p.resourceType === resourceType &&
      p.action === action &&
      p.effect === "allow",
  );
  if (allow) return "allow";

  return "none";
}

const CELL_COLORS: Record<string, string> = {
  allow: "bg-green-500/80",
  deny: "bg-red-500/80",
  none: "bg-gray-200",
};

const CELL_LABELS: Record<string, string> = {
  allow: "✓",
  deny: "✗",
  none: "—",
};

export function PermissionMatrix({ agentId }: { agentId: string }) {
  const locale = useAppStore((s) => s.locale);
  const policy = usePermissionStore((s) => s.policies[agentId]);
  const roles = usePermissionStore((s) => s.roles);
  const fetchPolicy = usePermissionStore((s) => s.fetchPolicy);

  useEffect(() => {
    if (agentId && !policy) {
      void fetchPolicy(agentId);
    }
  }, [agentId, policy, fetchPolicy]);

  if (!policy) {
    return (
      <div className="flex items-center justify-center py-8 text-[11px] text-[#B08F72]">
        {t(locale, "加载中…", "Loading…")}
      </div>
    );
  }

  // Merge all permissions: role permissions + custom - denied
  const allPermissions: Permission[] = [];

  // Collect role permissions
  for (const roleId of policy.assignedRoles) {
    const role = roles.find((r) => r.roleId === roleId);
    if (role) {
      allPermissions.push(...role.permissions);
    }
  }
  // Add custom permissions
  allPermissions.push(...policy.customPermissions);
  // Add denied permissions
  allPermissions.push(...policy.deniedPermissions);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Grid3X3 className="h-3.5 w-3.5 text-[#8B7355]" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8B7355]">
          {t(locale, "权限矩阵", "Permission Matrix")}
        </p>
      </div>

      {/* Legend */}
      <div className="flex gap-3 mb-3">
        {[
          { key: "allow", label: t(locale, "允许", "Allowed"), color: "bg-green-500/80" },
          { key: "deny", label: t(locale, "拒绝", "Denied"), color: "bg-red-500/80" },
          { key: "none", label: t(locale, "无规则", "No Rule"), color: "bg-gray-200" },
        ].map((item) => (
          <div key={item.key} className="flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded ${item.color}`} />
            <span className="text-[10px] text-[#6B5A4A]">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Matrix grid */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-left font-semibold text-[#8B7355] border-b border-[#E8DDD0]">
                {t(locale, "资源类型", "Resource")}
              </th>
              {ACTIONS.map((action) => (
                <th
                  key={action}
                  className="px-2 py-1.5 text-center font-semibold text-[#8B7355] border-b border-[#E8DDD0]"
                >
                  {action}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RESOURCE_TYPES.map((rt) => (
              <tr key={rt} className="border-b border-[#F0E8E0]">
                <td className="px-2 py-1.5 font-medium text-[#3A2A1A]">{rt}</td>
                {ACTIONS.map((action) => {
                  const effect = getCellEffect(allPermissions, rt, action);
                  return (
                    <td key={action} className="px-1 py-1 text-center">
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold text-white ${CELL_COLORS[effect]}`}
                        title={`${rt} / ${action}: ${effect}`}
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
