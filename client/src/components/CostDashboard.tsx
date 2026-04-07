/**
 * Cost Dashboard — 成本可观测性看板组件
 *
 * 展示 Token 消耗、实时费用、预算状态、Agent 费用占比、历史趋势，
 * 以及预警横幅、预算设置和降级操作。支持展开/收起两种模式。
 *
 * @see Requirements 8.1, 8.2, 8.4, 8.5, 8.6
 */

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  DollarSign,
  Zap,
  Percent,
  ArrowDownToLine,
  Play,
  ShieldOff,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

import { useCostStore } from "../lib/cost-store";
import type { Budget } from "@shared/cost";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PIE_COLORS = [
  "#d07a4f",
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCost(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatTokens(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function pct(value: number): number {
  return Math.min(Math.round(value * 100), 100);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CostDashboard() {
  const { snapshot, history, dashboardOpen, toggleDashboard, updateBudget, releaseDegradation } =
    useCostStore();

  const [budgetForm, setBudgetForm] = useState<Partial<Budget>>({});
  const [saving, setSaving] = useState(false);

  // Nothing to show yet
  if (!snapshot) {
    return (
      <Card className="mx-2 my-2">
        <CardContent className="py-4 text-center text-sm text-muted-foreground">
          No cost data available
        </CardContent>
      </Card>
    );
  }

  const activeAlerts = snapshot.alerts.filter((a) => !a.resolved);
  const budgetPct = pct(snapshot.budgetUsedPercent);
  const tokenPct = pct(snapshot.tokenUsedPercent);

  // ---- Budget form handlers ----

  const handleBudgetSave = async () => {
    setSaving(true);
    try {
      await updateBudget({
        maxCost: budgetForm.maxCost ?? snapshot.budget.maxCost,
        maxTokens: budgetForm.maxTokens ?? snapshot.budget.maxTokens,
        warningThreshold: budgetForm.warningThreshold ?? snapshot.budget.warningThreshold,
      });
      setBudgetForm({});
    } catch {
      // store already handles errors
    } finally {
      setSaving(false);
    }
  };

  // ---- Collapsed mode ----

  if (!dashboardOpen) {
    return (
      <Card className="mx-2 my-2 cursor-pointer" onClick={toggleDashboard}>
        <CardContent className="flex items-center justify-between py-3">
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1 font-data">
              <DollarSign className="size-3.5 text-amber-600" />
              {formatCost(snapshot.totalCost)}
            </span>
            <span className="flex items-center gap-1 font-data">
              <Zap className="size-3.5 text-indigo-500" />
              {formatTokens(snapshot.totalTokensIn + snapshot.totalTokensOut)} tokens
            </span>
            <span className="flex items-center gap-1 font-data">
              <Percent className="size-3.5 text-emerald-500" />
              {100 - budgetPct}% remaining
            </span>
            {snapshot.downgradeLevel !== "none" && (
              <Badge variant="destructive" className="text-xs">
                {snapshot.downgradeLevel === "soft" ? "Soft downgrade" : "Hard downgrade"}
              </Badge>
            )}
            {activeAlerts.length > 0 && (
              <Badge variant="destructive" className="text-xs">
                <AlertTriangle className="size-3" />
                {activeAlerts.length}
              </Badge>
            )}
          </div>
          <ChevronDown className="size-4 text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // ---- Expanded mode ----

  // Prepare history chart data
  const historyData = history.map((m) => ({
    name: m.title.length > 12 ? m.title.slice(0, 12) + "…" : m.title,
    cost: Number(m.totalCost.toFixed(4)),
    tokens: m.totalTokensIn + m.totalTokensOut,
  }));

  return (
    <div className="mx-2 my-2 space-y-3">
      {/* Collapse toggle */}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={toggleDashboard}>
          <ChevronUp className="size-4" />
          Collapse
        </Button>
      </div>

      {/* Alert banners */}
      {activeAlerts.length > 0 && (
        <div className="space-y-2">
          {activeAlerts.map((alert) => (
            <Alert key={alert.id} variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle className="text-xs font-semibold uppercase">
                {alert.type.replace(/_/g, " ")}
              </AlertTitle>
              <AlertDescription>{alert.message}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* Summary cards row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Token consumption */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <Zap className="size-4 text-indigo-500" />
              Token Consumption
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground font-data">
              <span>Input: {formatTokens(snapshot.totalTokensIn)}</span>
              <span>Output: {formatTokens(snapshot.totalTokensOut)}</span>
            </div>
            <Progress value={tokenPct} className="h-2" />
            <p className="text-right text-xs text-muted-foreground font-data">
              {formatTokens(snapshot.totalTokensIn + snapshot.totalTokensOut)} /{" "}
              {formatTokens(snapshot.budget.maxTokens)} ({tokenPct}%)
            </p>
          </CardContent>
        </Card>

        {/* Real-time cost */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <DollarSign className="size-4 text-amber-600" />
              Cost
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-2xl font-bold font-data">{formatCost(snapshot.totalCost)}</p>
            <Progress
              value={budgetPct}
              className={`h-2 ${budgetPct >= 80 ? "[&>[data-slot=progress-indicator]]:bg-red-500" : ""}`}
            />
            <p className="text-right text-xs text-muted-foreground font-data">
              {formatCost(snapshot.totalCost)} / {formatCost(snapshot.budget.maxCost)} ({budgetPct}%)
            </p>
          </CardContent>
        </Card>

        {/* Budget remaining */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <Percent className="size-4 text-emerald-500" />
              Budget Remaining
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center">
            <p
              className={`text-4xl font-bold font-data ${
                100 - budgetPct <= 20 ? "text-red-500" : "text-emerald-600"
              }`}
            >
              {100 - budgetPct}%
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-data">{snapshot.totalCalls}</span> calls this mission
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* Agent cost pie chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Agent Cost Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {snapshot.agentCosts.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No agent data</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={snapshot.agentCosts}
                    dataKey="totalCost"
                    nameKey="agentName"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    label={({ agentName, percent }) =>
                      `${agentName} ${(percent * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {snapshot.agentCosts.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCost(v)} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* History trend line chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Cost History (Last 10 Missions)</CardTitle>
          </CardHeader>
          <CardContent>
            {historyData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No history yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={historyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => formatCost(v)} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="cost"
                    stroke="#d07a4f"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="Cost ($)"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Budget settings form */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Budget Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Max Cost ($)</span>
              <Input
                type="number"
                step="0.1"
                min="0"
                placeholder={String(snapshot.budget.maxCost)}
                value={budgetForm.maxCost ?? ""}
                onChange={(e) =>
                  setBudgetForm((f) => ({
                    ...f,
                    maxCost: e.target.value ? Number(e.target.value) : undefined,
                  }))
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Max Tokens</span>
              <Input
                type="number"
                step="1000"
                min="0"
                placeholder={String(snapshot.budget.maxTokens)}
                value={budgetForm.maxTokens ?? ""}
                onChange={(e) =>
                  setBudgetForm((f) => ({
                    ...f,
                    maxTokens: e.target.value ? Number(e.target.value) : undefined,
                  }))
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Warning Threshold (%)</span>
              <Input
                type="number"
                step="5"
                min="0"
                max="100"
                placeholder={String(snapshot.budget.warningThreshold * 100)}
                value={
                  budgetForm.warningThreshold != null
                    ? budgetForm.warningThreshold * 100
                    : ""
                }
                onChange={(e) =>
                  setBudgetForm((f) => ({
                    ...f,
                    warningThreshold: e.target.value
                      ? Number(e.target.value) / 100
                      : undefined,
                  }))
                }
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={() => void handleBudgetSave()} disabled={saving}>
              {saving ? "Saving…" : "Save Budget"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Downgrade action buttons */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            Downgrade Controls
            {snapshot.downgradeLevel !== "none" && (
              <Badge variant="destructive" className="ml-2 text-xs">
                {snapshot.downgradeLevel}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={snapshot.downgradeLevel === "soft"}
              onClick={() =>
                void updateBudget({
                  maxCost: snapshot.budget.maxCost,
                  maxTokens: snapshot.budget.maxTokens,
                  warningThreshold: 0.01,
                })
              }
            >
              <ArrowDownToLine className="size-3.5" />
              Switch Low-Cost Model
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={snapshot.downgradeLevel === "hard"}
              onClick={() =>
                void updateBudget({
                  maxCost: 0.001,
                  maxTokens: 1,
                  warningThreshold: 0.01,
                })
              }
            >
              <Play className="size-3.5" />
              Pause Non-Critical Agents
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={snapshot.downgradeLevel === "none"}
              onClick={() => void releaseDegradation()}
            >
              <ShieldOff className="size-3.5" />
              Release Downgrade
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
