/**
 * Permission management main panel.
 *
 * Left side: Agent list with assigned roles.
 * Right side: Selected agent's permission details + quick edit.
 *
 * @see Requirements 13.1, 13.3, 13.5
 */

import { useEffect, useState } from "react";
import { Shield, User, Tag, Clock, RefreshCw } from "lucide-react";

import { useAppStore } from "@/lib/store";
import { usePermissionStore } from "@/lib/permission-store";
import { PermissionMatrix } from "./PermissionMatrix";
import { AuditTimeline } from "./AuditTimeline";
import type { AgentPermissionPolicy } from "@shared/permission/contracts";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

// ---------------------------------------------------------------------------
// Agent list item
// ---------------------------------------------------------------------------

function AgentListItem({
  agentId,
  policy,
  selected,
  onClick,
  locale,
}: {
  agentId: string;
  policy: AgentPermissionPolicy;
  selected: boolean;
  onClick: () => void;
  locale: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
        selected
          ? "bg-[#2F6A54]/10 border border-[#2F6A54]/30"
          : "hover:bg-[#F4EDE4] border border-transparent"
      }`}
    >
      <div className="flex items-center gap-2">
        <User className="h-3.5 w-3.5 text-[#8B7355]" />
        <span className="text-[12px] font-semibold text-[#3A2A1A] truncate">
          {agentId}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {policy.assignedRoles.map((role) => (
          <span
            key={role}
            className="inline-flex items-center gap-1 rounded-full bg-[#F0E8E0] px-2 py-0.5 text-[9px] font-medium text-[#6B5A4A]"
          >
            <Tag className="h-2.5 w-2.5" />
            {role}
          </span>
        ))}
      </div>
      {policy.expiresAt && (
        <div className="mt-1 flex items-center gap-1 text-[9px] text-[#B08F72]">
          <Clock className="h-2.5 w-2.5" />
          {t(locale, "过期", "Expires")}: {new Date(policy.expiresAt).toLocaleDateString()}
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Agent detail (right side)
// ---------------------------------------------------------------------------

function AgentDetail({
  agentId,
  locale,
}: {
  agentId: string;
  locale: string;
}) {
  const policy = usePermissionStore((s) => s.policies[agentId]);
  const roles = usePermissionStore((s) => s.roles);
  const updatePolicy = usePermissionStore((s) => s.updatePolicy);
  const fetchPolicy = usePermissionStore((s) => s.fetchPolicy);
  const [activeTab, setActiveTab] = useState<"permissions" | "matrix" | "audit">("permissions");

  useEffect(() => {
    void fetchPolicy(agentId);
  }, [agentId, fetchPolicy]);

  if (!policy) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-[#B08F72]">
        {t(locale, "加载中…", "Loading…")}
      </div>
    );
  }

  const handleRoleToggle = (roleId: string) => {
    const current = policy.assignedRoles;
    const next = current.includes(roleId)
      ? current.filter((r) => r !== roleId)
      : [...current, roleId];
    void updatePolicy(agentId, { assignedRoles: next });
  };

  const tabs = [
    { key: "permissions" as const, label: t(locale, "权限配置", "Permissions") },
    { key: "matrix" as const, label: t(locale, "权限矩阵", "Matrix") },
    { key: "audit" as const, label: t(locale, "审计日志", "Audit") },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-[#E8DDD0] px-4 py-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-[#2F6A54]" />
          <h3 className="text-[13px] font-bold text-[#3A2A1A]">{agentId}</h3>
        </div>
        {/* Tabs */}
        <div className="mt-2 flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg px-3 py-1 text-[11px] font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-[#2F6A54] text-white"
                  : "text-[#6B5A4A] hover:bg-[#F4EDE4]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "permissions" && (
          <div className="space-y-3">
            {/* Role assignment */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8B7355]">
                {t(locale, "角色分配", "Role Assignment")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {roles.map((role) => {
                  const assigned = policy.assignedRoles.includes(role.roleId);
                  return (
                    <button
                      key={role.roleId}
                      onClick={() => handleRoleToggle(role.roleId)}
                      className={`rounded-xl border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                        assigned
                          ? "border-[#2F6A54] bg-[#2F6A54]/10 text-[#2F6A54]"
                          : "border-[#E8DDD0] text-[#6B5A4A] hover:border-[#B08F72]"
                      }`}
                    >
                      {role.roleName}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom permissions summary */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8B7355]">
                {t(locale, "自定义权限", "Custom Permissions")}
              </p>
              {policy.customPermissions.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {policy.customPermissions.map((perm, i) => (
                    <div
                      key={`custom-${i}`}
                      className="flex items-center gap-2 rounded-lg bg-[#F8F4F0] px-3 py-1.5 text-[11px]"
                    >
                      <span className={`h-2 w-2 rounded-full ${perm.effect === "allow" ? "bg-green-500" : "bg-red-500"}`} />
                      <span className="font-medium text-[#3A2A1A]">{perm.resourceType}</span>
                      <span className="text-[#8B7355]">{perm.action}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-[#B08F72]">
                  {t(locale, "无自定义权限", "No custom permissions")}
                </p>
              )}
            </div>

            {/* Denied permissions */}
            {policy.deniedPermissions.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8B7355]">
                  {t(locale, "拒绝权限", "Denied Permissions")}
                </p>
                <div className="mt-2 space-y-1">
                  {policy.deniedPermissions.map((perm, i) => (
                    <div
                      key={`denied-${i}`}
                      className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-1.5 text-[11px]"
                    >
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      <span className="font-medium text-red-700">{perm.resourceType}</span>
                      <span className="text-red-500">{perm.action}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "matrix" && <PermissionMatrix agentId={agentId} />}
        {activeTab === "audit" && <AuditTimeline agentId={agentId} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function PermissionPanel() {
  const locale = useAppStore((s) => s.locale);
  const policies = usePermissionStore((s) => s.policies);
  const roles = usePermissionStore((s) => s.roles);
  const fetchRoles = usePermissionStore((s) => s.fetchRoles);
  const fetchTemplates = usePermissionStore((s) => s.fetchTemplates);
  const loadingRoles = usePermissionStore((s) => s.loadingRoles);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  useEffect(() => {
    void fetchRoles();
    void fetchTemplates();
  }, [fetchRoles, fetchTemplates]);

  const agentIds = Object.keys(policies);

  // Auto-select first agent
  useEffect(() => {
    if (!selectedAgent && agentIds.length > 0) {
      setSelectedAgent(agentIds[0]);
    }
  }, [agentIds, selectedAgent]);

  return (
    <div className="flex h-full">
      {/* Left: Agent list */}
      <div className="w-[220px] shrink-0 border-r border-[#E8DDD0] overflow-y-auto">
        <div className="px-3 py-3 border-b border-[#E8DDD0]">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8B7355]">
              {t(locale, "Agent 列表", "Agents")}
            </p>
            <button
              onClick={() => void fetchRoles()}
              className="rounded-lg p-1 text-[#8B7355] hover:bg-[#F4EDE4] transition-colors"
              title={t(locale, "刷新", "Refresh")}
            >
              <RefreshCw className={`h-3 w-3 ${loadingRoles ? "animate-spin" : ""}`} />
            </button>
          </div>
          <p className="mt-0.5 text-[10px] text-[#B08F72]">
            {agentIds.length} {t(locale, "个 Agent", "agents")}
          </p>
        </div>
        <div className="p-2 space-y-1">
          {agentIds.map((agentId) => (
            <AgentListItem
              key={agentId}
              agentId={agentId}
              policy={policies[agentId]}
              selected={selectedAgent === agentId}
              onClick={() => setSelectedAgent(agentId)}
              locale={locale}
            />
          ))}
          {agentIds.length === 0 && (
            <p className="px-3 py-6 text-center text-[11px] text-[#B08F72]">
              {t(locale, "暂无 Agent 权限数据", "No agent permission data")}
            </p>
          )}
        </div>
      </div>

      {/* Right: Detail */}
      <div className="flex-1 min-w-0">
        {selectedAgent ? (
          <AgentDetail agentId={selectedAgent} locale={locale} />
        ) : (
          <div className="flex h-full items-center justify-center text-[12px] text-[#B08F72]">
            {t(locale, "选择一个 Agent 查看权限", "Select an agent to view permissions")}
          </div>
        )}
      </div>
    </div>
  );
}
