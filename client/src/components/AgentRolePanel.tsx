/**
 * Agent role detail panel showing currentRole and roleHistory.
 * Used within agent detail views to display dynamic role state.
 */
import { Clock, Shield, ArrowRight } from 'lucide-react';
import { useEffect } from 'react';

import { useAppStore } from '@/lib/store';
import { useRoleStore, type AgentRoleInfo } from '@/lib/role-store';

function t(locale: string, zh: string, en: string) {
  return locale === 'zh-CN' ? zh : en;
}

function formatTime(locale: string, iso: string | null | undefined) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

/** Color mapping shared with Scene3D and WorkflowPanel role indicators */
export const ROLE_COLOR_MAP: Record<string, string> = {
  coder: '#3B82F6',
  developer: '#3B82F6',
  reviewer: '#10B981',
  architect: '#8B5CF6',
  qa: '#F97316',
  tester: '#F97316',
  pm: '#EF4444',
  manager: '#EF4444',
  techwriter: '#EC4899',
  writer: '#EC4899',
  lead: '#7C3AED',
  designer: '#06B6D4',
};

export function getRoleColor(roleName: string | null | undefined): string {
  if (!roleName) return '#8B7355';
  const key = roleName.toLowerCase().replace(/[\s_-]/g, '');
  for (const [pattern, color] of Object.entries(ROLE_COLOR_MAP)) {
    if (key.includes(pattern)) return color;
  }
  return '#8B7355';
}

export function AgentRolePanel({ agentId }: { agentId: string }) {
  const locale = useAppStore(state => state.locale);
  const agentRoles = useRoleStore(state => state.agentRoles);
  const fetchAgentRole = useRoleStore(state => state.fetchAgentRole);

  useEffect(() => {
    if (agentId) {
      void fetchAgentRole(agentId);
    }
  }, [agentId, fetchAgentRole]);

  const roleInfo: AgentRoleInfo = agentRoles.get(agentId) || { currentRole: null, roleHistory: [] };

  return (
    <div className="space-y-3">
      {/* Current Role */}
      <div className="rounded-xl border border-[#E8DDD0] bg-white/90 p-3">
        <div className="flex items-center gap-2 text-[#8B7355]">
          <Shield className="h-3.5 w-3.5" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em]">
            {t(locale, '当前角色', 'Current Role')}
          </p>
        </div>
        {roleInfo.currentRole ? (
          <div className="mt-2">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: getRoleColor(roleInfo.currentRole.roleName) }}
              />
              <span className="text-[13px] font-semibold text-[#3A2A1A]">
                {roleInfo.currentRole.roleName}
              </span>
            </div>
            <p className="mt-1 text-[10px] text-[#8B7355]">
              {t(locale, '加载时间', 'Loaded at')}: {formatTime(locale, roleInfo.currentRole.loadedAt)}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-[#B08F72]">
            {t(locale, '未加载角色', 'No role loaded')}
          </p>
        )}
      </div>

      {/* Role History */}
      <div className="rounded-xl border border-[#E8DDD0] bg-white/90 p-3">
        <div className="flex items-center gap-2 text-[#8B7355]">
          <Clock className="h-3.5 w-3.5" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em]">
            {t(locale, '角色切换记录', 'Role Switch History')}
          </p>
          <span className="ml-auto rounded-full bg-[#F0E8E0] px-2 py-0.5 text-[9px] font-medium text-[#6B5A4A]">
            {roleInfo.roleHistory.length}
          </span>
        </div>
        {roleInfo.roleHistory.length > 0 ? (
          <div className="mt-2 max-h-[280px] space-y-1.5 overflow-y-auto">
            {roleInfo.roleHistory.map((entry, i) => (
              <div key={`${entry.timestamp}-${i}`} className="rounded-lg bg-[#F8F4F0] px-3 py-2">
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: getRoleColor(entry.fromRole) }}
                  />
                  <span className="font-medium text-[#5A4A3A]">{entry.fromRole || t(locale, '无', 'None')}</span>
                  <ArrowRight className="h-3 w-3 text-[#B08F72]" />
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: getRoleColor(entry.toRole) }}
                  />
                  <span className="font-medium text-[#5A4A3A]">{entry.toRole || t(locale, '无', 'None')}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-[9px] text-[#8B7355]">
                  {entry.missionName ? <span>{entry.missionName}</span> : null}
                  <span>{formatTime(locale, entry.timestamp)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-[#B08F72]">
            {t(locale, '暂无切换记录', 'No switch history yet')}
          </p>
        )}
      </div>
    </div>
  );
}
