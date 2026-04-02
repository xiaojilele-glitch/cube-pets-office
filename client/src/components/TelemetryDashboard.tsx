/**
 * 实时遥测仪表盘 — 侧滑面板
 *
 * 展示 Token 消耗/费用、Top 3 瓶颈 Agent、Mission 阶段耗时柱状图、
 * 活跃 Agent 计数、历史趋势折线图、预警信息。
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 8.3
 */

import { useTelemetryStore } from "@/lib/telemetry-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  Clock,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  TelemetrySnapshot,
  MissionTelemetrySummary,
} from "@shared/telemetry";

const TOKEN_BUDGET = 100_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function hasAlert(
  alerts: TelemetrySnapshot["alerts"],
  type: string,
  agentId?: string,
): boolean {
  return alerts.some(
    (a) => a.type === type && !a.resolved && (!agentId || a.agentId === agentId),
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Section 1: Token & Cost */
function TokenCostCard({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const totalTokens = snapshot.totalTokensIn + snapshot.totalTokensOut;
  const pct = Math.min((totalTokens / TOKEN_BUDGET) * 100, 100);
  const overBudget = hasAlert(snapshot.alerts, "token_over_budget");

  return (
    <Card className={overBudget ? "border-red-400 bg-red-50/60" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Zap className="h-4 w-4 text-[#D07A4F]" />
          Token &amp; Cost
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex justify-between text-xs text-[#6B5A4A]">
          <span>
            {totalTokens.toLocaleString()} / {TOKEN_BUDGET.toLocaleString()}
          </span>
          <span>{fmtCost(snapshot.totalCost)}</span>
        </div>
        <Progress value={pct} className={overBudget ? "[&>*]:bg-red-500" : ""} />
        <div className="flex justify-between text-[10px] text-[#6B5A4A]/70">
          <span>In: {snapshot.totalTokensIn.toLocaleString()}</span>
          <span>Out: {snapshot.totalTokensOut.toLocaleString()}</span>
          <span>Calls: {snapshot.totalCalls}</span>
        </div>
        {overBudget && (
          <p className="text-xs font-medium text-red-600">
            ⚠ Token budget exceeded 80% threshold
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Section 2: Top 3 Bottleneck Agents */
function BottleneckAgentsCard({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const top3 = snapshot.agentTimings.slice(0, 3);

  if (top3.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-[#D07A4F]" />
            Top Bottleneck Agents
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-[#6B5A4A]/70">No agent data yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-[#D07A4F]" />
          Top Bottleneck Agents
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {top3.map((agent, i) => {
          const isSlow = hasAlert(snapshot.alerts, "agent_slow", agent.agentId);
          return (
            <div
              key={agent.agentId}
              className={`flex items-center justify-between rounded px-2 py-1 text-xs ${
                isSlow ? "bg-red-50 text-red-700" : "text-[#5C4A39]"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span className="font-medium">#{i + 1}</span>
                {agent.agentName}
                {isSlow && <AlertTriangle className="h-3 w-3 text-red-500" />}
              </span>
              <Badge variant={isSlow ? "destructive" : "secondary"} className="text-[10px]">
                {fmtMs(agent.avgDurationMs)}
              </Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Section 3: Mission Stage Timing BarChart */
function StageTimingChart({ snapshot }: { snapshot: TelemetrySnapshot }) {
  if (snapshot.missionStageTimings.length === 0) return null;

  const data = snapshot.missionStageTimings.map((s) => ({
    name: s.stageLabel,
    duration: +(s.durationMs / 1000).toFixed(1),
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4 text-[#D07A4F]" />
          Stage Timing
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5d5c5" />
            <XAxis type="number" tick={{ fontSize: 10, fill: "#6B5A4A" }} unit="s" />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 10, fill: "#6B5A4A" }}
              width={80}
            />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 8 }}
              formatter={(v: number) => [`${v}s`, "Duration"]}
            />
            <Bar dataKey="duration" fill="#D07A4F" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

/** Section 4: Active Agent Count */
function ActiveAgentCard({ count }: { count: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Users className="h-4 w-4 text-[#D07A4F]" />
          Active Agents
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold text-[#3A2A1A]">{count}</p>
      </CardContent>
    </Card>
  );
}

/** Section 5: History Trend LineChart (last 5 missions) */
function HistoryTrendChart({ history }: { history: MissionTelemetrySummary[] }) {
  const recent = history.slice(-5);
  if (recent.length === 0) return null;

  const data = recent.map((m) => ({
    name: m.title.length > 12 ? m.title.slice(0, 12) + "…" : m.title,
    cost: +m.totalCost.toFixed(4),
    calls: m.totalCalls,
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4 text-[#D07A4F]" />
          History Trend
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={data} margin={{ left: 0, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5d5c5" />
            <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#6B5A4A" }} />
            <YAxis
              yAxisId="cost"
              tick={{ fontSize: 10, fill: "#6B5A4A" }}
              width={45}
            />
            <YAxis
              yAxisId="calls"
              orientation="right"
              tick={{ fontSize: 10, fill: "#6B5A4A" }}
              width={35}
            />
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
            <Line
              yAxisId="cost"
              type="monotone"
              dataKey="cost"
              stroke="#D07A4F"
              strokeWidth={2}
              dot={{ r: 3 }}
              name="Cost ($)"
            />
            <Line
              yAxisId="calls"
              type="monotone"
              dataKey="calls"
              stroke="#6B5A4A"
              strokeWidth={1.5}
              strokeDasharray="4 2"
              dot={{ r: 2 }}
              name="Calls"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

/** Section 6: Alerts */
function AlertsSection({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const active = snapshot.alerts.filter((a) => !a.resolved);
  if (active.length === 0) return null;

  return (
    <Card className="border-amber-300 bg-amber-50/60">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4" />
          Alerts ({active.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {active.map((alert) => (
          <p key={alert.id} className="text-xs text-amber-900">
            • {alert.message}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// RAG Telemetry Card
// ---------------------------------------------------------------------------

function RAGTelemetryCard() {
  return (
    <Card className="rounded-2xl border-[#e5d5c5] bg-white/90">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xs font-semibold text-[#3A2A1A]">
          <Zap className="h-3.5 w-3.5 text-purple-500" />
          RAG Pipeline
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-[#6B5A4A]">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-[#faf5ef] p-2 text-center">
            <div className="text-[10px] text-[#6B5A4A]/70">Retrieval</div>
            <div className="font-mono text-sm font-semibold">—</div>
          </div>
          <div className="rounded-lg bg-[#faf5ef] p-2 text-center">
            <div className="text-[10px] text-[#6B5A4A]/70">Hit Rate</div>
            <div className="font-mono text-sm font-semibold">—</div>
          </div>
          <div className="rounded-lg bg-[#faf5ef] p-2 text-center">
            <div className="text-[10px] text-[#6B5A4A]/70">Tokens</div>
            <div className="font-mono text-sm font-semibold">—</div>
          </div>
        </div>
        <p className="text-[10px] text-[#6B5A4A]/50">
          RAG metrics available when pipeline is enabled
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function TelemetryDashboard() {
  const { snapshot, history, dashboardOpen, toggleDashboard } =
    useTelemetryStore();

  return (
    <AnimatePresence>
      {dashboardOpen && (
        <motion.div
          key="telemetry-panel"
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 26, stiffness: 260 }}
          className="fixed right-0 top-0 z-50 flex h-full w-[360px] max-w-[90vw] flex-col border-l border-[#e5d5c5] bg-white/95 shadow-xl backdrop-blur-sm"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#e5d5c5] px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[#3A2A1A]">
              <Activity className="h-4 w-4 text-[#D07A4F]" />
              Telemetry Dashboard
            </h2>
            <button
              onClick={toggleDashboard}
              className="rounded p-1 text-[#6B5A4A] transition-colors hover:bg-[#f5ebe0] hover:text-[#3A2A1A]"
              aria-label="Close telemetry dashboard"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <ScrollArea className="flex-1">
            <div className="space-y-3 p-4">
              {!snapshot ? (
                <p className="py-8 text-center text-xs text-[#6B5A4A]/70">
                  No telemetry data yet
                </p>
              ) : (
                <>
                  <TokenCostCard snapshot={snapshot} />
                  <BottleneckAgentsCard snapshot={snapshot} />
                  <StageTimingChart snapshot={snapshot} />
                  <ActiveAgentCard count={snapshot.activeAgentCount} />
                  <AlertsSection snapshot={snapshot} />
                </>
              )}
              <HistoryTrendChart history={history} />

              {/* RAG Telemetry */}
              <RAGTelemetryCard />
            </div>
          </ScrollArea>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
