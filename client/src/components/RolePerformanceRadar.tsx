/**
 * Multi-role performance radar chart using recharts.
 * Displays avgQualityScore per roleId for a given agent.
 */
import { useEffect, useState } from 'react';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { BarChart3 } from 'lucide-react';

import { useAppStore } from '@/lib/store';
import { getRoleColor } from '@/components/AgentRolePanel';

function t(locale: string, zh: string, en: string) {
  return locale === 'zh-CN' ? zh : en;
}

interface RolePerformanceData {
  roleId: string;
  roleName: string;
  avgQualityScore: number;
}

export function RolePerformanceRadar({ agentId }: { agentId: string }) {
  const locale = useAppStore(state => state.locale);
  const [data, setData] = useState<RolePerformanceData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    setLoading(true);

    fetch(`/api/agents/${agentId}`)
      .then(res => (res.ok ? res.json() : null))
      .then(json => {
        if (cancelled || !json) return;
        // Extract role performance from the agent response
        const perfHistory: Record<string, { avgQualityScore: number }> =
          json.rolePerformanceHistory || {};
        const entries: RolePerformanceData[] = Object.entries(perfHistory).map(
          ([roleId, record]: [string, any]) => ({
            roleId,
            roleName: record.roleName || roleId,
            avgQualityScore: Math.round(record.avgQualityScore ?? 0),
          })
        );
        setData(entries);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [agentId]);

  if (loading) {
    return (
      <div className="flex h-[200px] items-center justify-center text-[11px] text-[#8B7355]">
        {t(locale, '加载中…', 'Loading…')}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-[#E8DDD0] bg-white/90 p-3">
        <div className="flex items-center gap-2 text-[#8B7355]">
          <BarChart3 className="h-3.5 w-3.5" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em]">
            {t(locale, '多角色绩效', 'Role Performance')}
          </p>
        </div>
        <p className="mt-2 text-[11px] text-[#B08F72]">
          {t(locale, '暂无绩效数据', 'No performance data yet')}
        </p>
      </div>
    );
  }

  const chartData = data.map(d => ({
    role: d.roleName,
    score: d.avgQualityScore,
    fill: getRoleColor(d.roleName),
  }));

  return (
    <div className="rounded-xl border border-[#E8DDD0] bg-white/90 p-3">
      <div className="flex items-center gap-2 text-[#8B7355]">
        <BarChart3 className="h-3.5 w-3.5" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em]">
          {t(locale, '多角色绩效', 'Role Performance')}
        </p>
      </div>
      <div className="mt-2 h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="70%">
            <PolarGrid stroke="#E8DDD0" />
            <PolarAngleAxis
              dataKey="role"
              tick={{ fontSize: 10, fill: '#5A4A3A' }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{ fontSize: 9, fill: '#8B7355' }}
            />
            <Radar
              name={t(locale, '质量分', 'Quality Score')}
              dataKey="score"
              stroke="#D4845A"
              fill="#D4845A"
              fillOpacity={0.3}
            />
            <Tooltip
              contentStyle={{
                fontSize: 11,
                borderRadius: 8,
                border: '1px solid #E8DDD0',
              }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      {/* Legend */}
      <div className="mt-1 flex flex-wrap gap-2">
        {data.map(d => (
          <div key={d.roleId} className="flex items-center gap-1 text-[9px] text-[#6B5A4A]">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: getRoleColor(d.roleName) }}
            />
            <span>{d.roleName}: <span className="font-data">{d.avgQualityScore}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}
