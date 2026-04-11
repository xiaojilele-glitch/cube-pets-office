import { useEffect, useMemo, useState } from "react";
import {
  Clock,
  RefreshCw,
  Shield,
  Tag,
  TriangleAlert,
  User,
} from "lucide-react";

import { EmptyHintBlock } from "@/components/tasks/EmptyHintBlock";
import { useAppStore } from "@/lib/store";
import { usePermissionStore } from "@/lib/permission-store";
import { useWorkflowStore } from "@/lib/workflow-store";
import { AuditTimeline } from "./AuditTimeline";
import { PermissionMatrix } from "./PermissionMatrix";
import type { AgentPermissionPolicy } from "@shared/permission/contracts";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function AgentListItem({
  agentId,
  agentName,
  policy,
  selected,
  onClick,
  locale,
}: {
  agentId: string;
  agentName?: string;
  policy?: AgentPermissionPolicy;
  selected: boolean;
  onClick: () => void;
  locale: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
        selected
          ? "border-[#2F6A54]/30 bg-[#2F6A54]/10"
          : "border-transparent hover:bg-[#F4EDE4]"
      }`}
    >
      <div className="flex items-center gap-2">
        <User className="h-3.5 w-3.5 text-[#8B7355]" />
        <span className="truncate text-[12px] font-semibold text-[#3A2A1A]">
          {agentName || agentId}
        </span>
      </div>
      <div className="mt-1 text-[10px] text-[#8B7355]">{agentId}</div>

      {policy ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {policy.assignedRoles.length > 0 ? (
            policy.assignedRoles.map(role => (
              <span
                key={role}
                className="inline-flex items-center gap-1 rounded-full bg-[#F0E8E0] px-2 py-0.5 text-[9px] font-medium text-[#6B5A4A]"
              >
                <Tag className="h-2.5 w-2.5" />
                {role}
              </span>
            ))
          ) : (
            <span className="text-[10px] text-[#B08F72]">
              {t(locale, "还没有角色分配", "No assigned roles yet")}
            </span>
          )}
        </div>
      ) : (
        <div className="mt-2 text-[10px] text-[#B08F72]">
          {t(locale, "点击后加载策略", "Load policy on selection")}
        </div>
      )}

      {policy?.expiresAt ? (
        <div className="mt-1 flex items-center gap-1 text-[9px] text-[#B08F72]">
          <Clock className="h-2.5 w-2.5" />
          {t(locale, "到期", "Expires")}:{" "}
          {new Date(policy.expiresAt).toLocaleDateString()}
        </div>
      ) : null}
    </button>
  );
}

function AgentDetail({ agentId, locale }: { agentId: string; locale: string }) {
  const policy = usePermissionStore(state => state.policies[agentId]);
  const roles = usePermissionStore(state => state.roles);
  const loadingPolicies = usePermissionStore(state => state.loadingPolicies);
  const policyError = usePermissionStore(
    state => state.policyErrors[agentId] ?? null
  );
  const updatePolicy = usePermissionStore(state => state.updatePolicy);
  const fetchPolicy = usePermissionStore(state => state.fetchPolicy);
  const [activeTab, setActiveTab] = useState<
    "permissions" | "matrix" | "audit"
  >("permissions");

  useEffect(() => {
    void fetchPolicy(agentId);
  }, [agentId, fetchPolicy]);

  if (loadingPolicies && !policy) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-[#B08F72]">
        {t(locale, "正在加载 Agent 权限策略…", "Loading agent policy...")}
      </div>
    );
  }

  if (policyError && !policy) {
    return (
      <div className="p-4">
        <EmptyHintBlock
          tone={policyError.kind === "error" ? "danger" : "warning"}
          icon={<TriangleAlert className="size-5" />}
          title={t(
            locale,
            "Agent 权限策略暂时不可用",
            "Agent policy is unavailable"
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
                    "权限服务暂时不可达，无法读取这名 Agent 的最新策略。",
                    "The permission service is currently unreachable, so this agent's latest policy could not be loaded."
                  )
                : t(
                    locale,
                    "权限接口返回了异常结果，界面已经拦截原始技术报错。",
                    "The permission API returned an unexpected result, and the raw parser error was suppressed."
                  )
          }
          hint={policyError.message}
          actionLabel={t(locale, "重试加载", "Retry")}
          onAction={() => void fetchPolicy(agentId)}
        />
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="p-4">
        <EmptyHintBlock
          tone="info"
          icon={<Shield className="size-5" />}
          title={t(locale, "还没有权限策略", "No policy has been loaded yet")}
          description={t(
            locale,
            "选中的 Agent 还没有返回权限策略数据。",
            "The selected agent has not returned a permission policy yet."
          )}
          actionLabel={t(locale, "立即加载", "Load now")}
          onAction={() => void fetchPolicy(agentId)}
        />
      </div>
    );
  }

  const handleRoleToggle = (roleId: string) => {
    const nextRoles = policy.assignedRoles.includes(roleId)
      ? policy.assignedRoles.filter(role => role !== roleId)
      : [...policy.assignedRoles, roleId];

    void updatePolicy(agentId, { assignedRoles: nextRoles });
  };

  const tabs = [
    { key: "permissions" as const, label: t(locale, "角色与权限", "Roles") },
    { key: "matrix" as const, label: t(locale, "矩阵", "Matrix") },
    { key: "audit" as const, label: t(locale, "审计", "Audit") },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#E8DDD0] px-4 py-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-[#2F6A54]" />
          <h3 className="text-[13px] font-bold text-[#3A2A1A]">{agentId}</h3>
        </div>

        <div className="mt-2 flex gap-1">
          {tabs.map(tab => (
            <button
              key={tab.key}
              type="button"
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

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "permissions" ? (
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8B7355]">
                {t(locale, "角色分配", "Role assignment")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {roles.map(role => {
                  const assigned = policy.assignedRoles.includes(role.roleId);
                  return (
                    <button
                      key={role.roleId}
                      type="button"
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

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8B7355]">
                {t(locale, "自定义权限", "Custom permissions")}
              </p>
              {policy.customPermissions.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {policy.customPermissions.map((permission, index) => (
                    <div
                      key={`custom-${index}`}
                      className="flex items-center gap-2 rounded-lg bg-[#F8F4F0] px-3 py-1.5 text-[11px]"
                    >
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      <span className="font-medium text-[#3A2A1A]">
                        {permission.resourceType}
                      </span>
                      <span className="text-[#8B7355]">
                        {permission.action}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-[#B08F72]">
                  {t(
                    locale,
                    "还没有额外授权项。",
                    "No extra permissions have been added."
                  )}
                </p>
              )}
            </div>

            {policy.deniedPermissions.length > 0 ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8B7355]">
                  {t(locale, "显式拒绝", "Explicit denies")}
                </p>
                <div className="mt-2 space-y-1">
                  {policy.deniedPermissions.map((permission, index) => (
                    <div
                      key={`denied-${index}`}
                      className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-1.5 text-[11px]"
                    >
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      <span className="font-medium text-red-700">
                        {permission.resourceType}
                      </span>
                      <span className="text-red-500">{permission.action}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === "matrix" ? <PermissionMatrix agentId={agentId} /> : null}
        {activeTab === "audit" ? <AuditTimeline agentId={agentId} /> : null}
      </div>
    </div>
  );
}

export function PermissionPanel() {
  const locale = useAppStore(state => state.locale);
  const workflowAgents = useWorkflowStore(state => state.agents);
  const policies = usePermissionStore(state => state.policies);
  const fetchRoles = usePermissionStore(state => state.fetchRoles);
  const fetchTemplates = usePermissionStore(state => state.fetchTemplates);
  const loadingRoles = usePermissionStore(state => state.loadingRoles);
  const rolesError = usePermissionStore(state => state.rolesError);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  useEffect(() => {
    void fetchRoles();
    void fetchTemplates();
  }, [fetchRoles, fetchTemplates]);

  const agentOptions = useMemo(() => {
    const map = new Map<string, { id: string; name?: string }>();

    workflowAgents.forEach(agent => {
      map.set(agent.id, { id: agent.id, name: agent.name });
    });

    Object.values(policies).forEach(policy => {
      const existing = map.get(policy.agentId);
      map.set(policy.agentId, existing ?? { id: policy.agentId });
    });

    return Array.from(map.values()).sort((left, right) =>
      left.id.localeCompare(right.id)
    );
  }, [policies, workflowAgents]);

  useEffect(() => {
    if (!selectedAgent && agentOptions.length > 0) {
      setSelectedAgent(agentOptions[0].id);
    }
  }, [agentOptions, selectedAgent]);

  const handleRefresh = () => {
    void fetchRoles();
    void fetchTemplates();
  };

  return (
    <div className="flex h-full">
      <div className="w-[240px] shrink-0 overflow-y-auto border-r border-[#E8DDD0]">
        <div className="border-b border-[#E8DDD0] px-3 py-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8B7355]">
              {t(locale, "Agent 列表", "Agents")}
            </p>
            <button
              type="button"
              onClick={handleRefresh}
              className="rounded-lg p-1 text-[#8B7355] transition-colors hover:bg-[#F4EDE4]"
              title={t(locale, "刷新", "Refresh")}
            >
              <RefreshCw
                className={`h-3 w-3 ${loadingRoles ? "animate-spin" : ""}`}
              />
            </button>
          </div>
          <p className="mt-0.5 text-[10px] text-[#B08F72]">
            {agentOptions.length} {t(locale, "个 Agent", "agents")}
          </p>
        </div>

        <div className="space-y-1 p-2">
          {agentOptions.map(agent => (
            <AgentListItem
              key={agent.id}
              agentId={agent.id}
              agentName={agent.name}
              policy={policies[agent.id]}
              selected={selectedAgent === agent.id}
              onClick={() => setSelectedAgent(agent.id)}
              locale={locale}
            />
          ))}

          {agentOptions.length === 0 ? (
            <EmptyHintBlock
              tone={rolesError ? "warning" : "info"}
              icon={
                rolesError ? (
                  <TriangleAlert className="size-5" />
                ) : (
                  <User className="size-5" />
                )
              }
              title={
                rolesError
                  ? t(
                      locale,
                      "权限面板暂时不可用",
                      "Permission panel is unavailable"
                    )
                  : t(locale, "还没有可展示的 Agent", "No agents to show yet")
              }
              description={
                rolesError
                  ? t(
                      locale,
                      "权限角色请求失败了，所以当前无法安全地展示策略列表。",
                      "The role request failed, so the policy list cannot be rendered safely right now."
                    )
                  : t(
                      locale,
                      "先让工作流面板加载团队成员，或等待服务端返回权限策略后，这里才会出现可选 Agent。",
                      "Load the team from the workflow panel or wait for the backend to return policies before agents appear here."
                    )
              }
              hint={rolesError?.message}
              actionLabel={t(locale, "重新加载", "Retry")}
              onAction={handleRefresh}
            />
          ) : null}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {selectedAgent ? (
          <AgentDetail agentId={selectedAgent} locale={locale} />
        ) : (
          <div className="p-4">
            <EmptyHintBlock
              tone="info"
              icon={<Shield className="size-5" />}
              title={t(
                locale,
                "选择一个 Agent 查看权限",
                "Select an agent to inspect permissions"
              )}
              description={t(
                locale,
                "左侧会列出已经在当前会话中出现过的 Agent。选中后即可查看角色、矩阵和审计记录。",
                "Pick an agent from the list to inspect roles, the permission matrix, and the audit history."
              )}
            />
          </div>
        )}
      </div>
    </div>
  );
}
