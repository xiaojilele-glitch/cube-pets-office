import { memo } from "react";

import { useI18n } from "@/i18n";
import type { MissionTaskDetail, MissionTaskSummary } from "@/lib/tasks-store";
import {
  compactText,
  missionOperatorStateLabel,
  missionStatusLabel,
} from "@/components/tasks/task-helpers";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function formatClock(locale: string, timestamp: number | null | undefined) {
  if (!timestamp) {
    return locale === "zh-CN" ? "待命" : "Standby";
  }

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function activeAgentCount(
  detail: MissionTaskDetail | null,
  summary: MissionTaskSummary | null
) {
  if (detail) {
    return detail.agents.filter(
      agent => agent.status === "working" || agent.status === "thinking"
    ).length;
  }
  return summary?.activeAgentCount ?? 0;
}

function buildSignalLine(
  locale: string,
  mission: MissionTaskSummary | null,
  detail: MissionTaskDetail | null
) {
  const rawSignal =
    detail?.failureReasons[0] ||
    detail?.lastSignal ||
    detail?.waitingFor ||
    mission?.lastSignal ||
    mission?.waitingFor ||
    detail?.summary ||
    mission?.summary ||
    "";

  const fallback = t(
    locale,
    "当前没有新的异常或等待信号，监控屏保持待命。",
    "No urgent blocker or failure signal is active right now."
  );

  return compactText(rawSignal || fallback, 96);
}

function missionTone(status: MissionTaskSummary["status"] | null) {
  switch (status) {
    case "failed":
      return {
        accent: "#f97373",
        accentSoft: "rgba(249,115,115,0.16)",
        progress: "linear-gradient(90deg, #f87171, #fb923c)",
      };
    case "done":
      return {
        accent: "#4ade80",
        accentSoft: "rgba(74,222,128,0.16)",
        progress: "linear-gradient(90deg, #4ade80, #22c55e)",
      };
    case "waiting":
      return {
        accent: "#60a5fa",
        accentSoft: "rgba(96,165,250,0.16)",
        progress: "linear-gradient(90deg, #60a5fa, #38bdf8)",
      };
    case "running":
      return {
        accent: "#fb923c",
        accentSoft: "rgba(251,146,60,0.16)",
        progress: "linear-gradient(90deg, #f97373, #fb923c, #fbbf24)",
      };
    default:
      return {
        accent: "#94a3b8",
        accentSoft: "rgba(148,163,184,0.16)",
        progress: "linear-gradient(90deg, #64748b, #94a3b8)",
      };
  }
}

function MetricTile({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        textAlign: "center",
        padding: "0 8px",
      }}
    >
      <div
        style={{
          fontSize: 10,
          lineHeight: 1.2,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "rgba(148,163,184,0.8)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 26,
          lineHeight: 1,
          fontWeight: 700,
          color,
        }}
      >
        {value}
      </div>
    </div>
  );
}

export interface MissionWallTaskPanelProps {
  mission: MissionTaskSummary | null;
  detail: MissionTaskDetail | null;
  fullscreen?: boolean;
  onActivate?: () => void;
  onClose?: () => void;
  auxiliaryPanes?: Array<{
    label: string;
    value: string;
    tone?: "default" | "active" | "info";
  }>;
}

function MissionWallTaskPanelInner({
  mission,
  detail,
  fullscreen = false,
  onActivate,
  onClose,
  auxiliaryPanes = [],
}: MissionWallTaskPanelProps) {
  const { locale } = useI18n();
  const tone = missionTone(mission?.status ?? null);
  const statusLabel = mission
    ? missionStatusLabel(mission.status, locale)
    : t(locale, "待命", "Standby");
  const operatorLabel = mission
    ? missionOperatorStateLabel(mission.operatorState, locale)
    : t(locale, "空闲", "Idle");
  const stageLabel =
    detail?.currentStageLabel ||
    mission?.currentStageLabel ||
    t(locale, "等待任务", "Awaiting mission");
  const title =
    mission?.title ||
    t(locale, "办公室后墙监控屏待命中", "Office wall monitor is standing by");
  const signalLine = buildSignalLine(locale, mission, detail);
  const progress = mission?.progress ?? 0;
  const totalAgents = detail?.agents.length ?? mission?.activeAgentCount ?? 0;
  const runningAgents = activeAgentCount(detail, mission);
  const warningCount =
    mission?.issueCount ?? detail?.failureReasons.length ?? 0;
  const completedCount = mission?.completedTaskCount ?? 0;
  const packageCount = mission?.taskCount ?? detail?.tasks.length ?? 0;
  const needsAttention =
    mission?.status === "failed" ||
    mission?.status === "waiting" ||
    (detail?.failureReasons.length ?? 0) > 0;
  const compactWallView = !fullscreen;
  const summaryLabels = fullscreen
    ? [statusLabel, operatorLabel, stageLabel]
    : [statusLabel, stageLabel];

  const rootStyle: React.CSSProperties = fullscreen
    ? {
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        padding: 24,
        background:
          "linear-gradient(180deg, rgba(8,12,20,0.96), rgba(13,20,30,0.98))",
      }
    : {
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        borderRadius: 16,
        cursor: onActivate ? "pointer" : "default",
        background: "transparent",
        border: "none",
        boxShadow: "none",
      };

  const mainShellStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    minHeight: fullscreen ? 0 : "100%",
    borderRadius: fullscreen ? 24 : 14,
    overflow: "hidden",
    background:
      "radial-gradient(circle at top right, rgba(96,165,250,0.08), transparent 24%), linear-gradient(180deg, rgba(20,28,42,0.98), rgba(14,21,33,0.98))",
    border: "1px solid rgba(86, 104, 128, 0.18)",
    boxShadow: fullscreen
      ? "0 18px 48px rgba(3, 8, 16, 0.48)"
      : "inset 0 1px 0 rgba(255,255,255,0.03)",
  };

  const shellPadding = fullscreen ? 28 : 10;

  return (
    <div
      style={rootStyle}
      onClick={!fullscreen ? onActivate : undefined}
      role={!fullscreen && onActivate ? "button" : undefined}
      tabIndex={!fullscreen && onActivate ? 0 : undefined}
      onKeyDown={
        !fullscreen && onActivate
          ? event => {
              if (event.key === "Enter" || event.key === " ") {
                onActivate();
              }
            }
          : undefined
      }
    >
      <div style={mainShellStyle}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "repeating-linear-gradient(180deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 4px)",
            opacity: 0.16,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            boxShadow: `inset 0 0 0 1px ${tone.accentSoft}`,
            pointerEvents: "none",
          }}
        />
        {fullscreen && onClose ? (
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              onClose();
            }}
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              zIndex: 3,
              border: "none",
              borderRadius: 999,
              background: "rgba(15,23,42,0.76)",
              color: "#e2e8f0",
              padding: "6px 10px",
              cursor: "pointer",
            }}
          >
            {t(locale, "关闭", "Close")}
          </button>
        ) : null}

        <div
          style={{
            position: "relative",
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            height: "100%",
            padding: shellPadding,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: fullscreen ? 50 : 30,
                  height: fullscreen ? 50 : 30,
                  borderRadius: fullscreen ? 12 : 9,
                  background: "rgba(251,146,60,0.9)",
                  color: "#1f2937",
                  fontSize: fullscreen ? 17 : 13,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                MC
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: fullscreen ? 18 : 10,
                    lineHeight: 1.1,
                    letterSpacing: fullscreen ? "0.18em" : "0.14em",
                    textTransform: "uppercase",
                    color: "rgba(148,163,184,0.88)",
                  }}
                >
                  Mission Control
                </div>
                <div
                  style={{
                    marginTop: fullscreen ? 6 : 3,
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    flexWrap: "wrap",
                  }}
                >
                  {summaryLabels.map((label, index) => (
                    <span
                      key={`${label}-${index}`}
                      style={{
                        borderRadius: 999,
                        padding: fullscreen ? "4px 10px" : "2px 7px",
                        fontSize: fullscreen ? 13 : 8,
                        lineHeight: 1.1,
                        color: index === 0 ? tone.accent : "#93c5fd",
                        background:
                          index === 0
                            ? tone.accentSoft
                            : "rgba(96,165,250,0.12)",
                        border:
                          index === 0
                            ? `1px solid ${tone.accentSoft}`
                            : "1px solid rgba(96,165,250,0.16)",
                      }}
                    >
                      {label}
                    </span>
                  ))}
                </div>
                {!fullscreen && auxiliaryPanes.length > 0 ? (
                  <div
                    style={{
                      marginTop: 6,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    {auxiliaryPanes.map(item => {
                      const accentColor =
                        item.tone === "active"
                          ? "#34d399"
                          : item.tone === "info"
                            ? "#60a5fa"
                            : "rgba(148,163,184,0.88)";

                      return (
                        <span
                          key={`${item.label}-${item.value}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            borderRadius: 999,
                            padding: "2px 7px",
                            fontSize: 8,
                            lineHeight: 1.1,
                            color: "rgba(226,232,240,0.9)",
                            background: "rgba(15,23,42,0.42)",
                            border: "1px solid rgba(71,85,105,0.18)",
                          }}
                        >
                          <span style={{ color: "rgba(148,163,184,0.72)" }}>
                            {item.label}
                          </span>
                          <span style={{ color: accentColor }}>{item.value}</span>
                        </span>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                color: "rgba(148,163,184,0.88)",
                fontSize: fullscreen ? 16 : 10,
                letterSpacing: "0.1em",
                flexShrink: 0,
              }}
            >
              <span>{formatClock(locale, mission?.updatedAt ?? null)}</span>
              <span
                style={{
                  display: "inline-flex",
                  gap: fullscreen ? 6 : 4,
                  alignItems: "center",
                }}
              >
                {["#4ade80", "#fbbf24", "#64748b"].map(color => (
                  <span
                    key={color}
                    style={{
                      width: fullscreen ? 10 : 6,
                      height: fullscreen ? 10 : 6,
                      borderRadius: 999,
                      background: color,
                      boxShadow: `0 0 12px ${color}`,
                    }}
                  />
                ))}
              </span>
            </div>
          </div>

          <div
            style={{
              marginTop: fullscreen ? 28 : 8,
              fontSize: fullscreen ? 42 : 13,
              lineHeight: fullscreen ? 1.2 : 1.22,
              fontWeight: 700,
              color: "#f8fafc",
              textWrap: "balance",
            }}
          >
            {compactText(title, fullscreen ? 96 : 36)}
          </div>

          <div style={{ marginTop: fullscreen ? 24 : 8 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                color: "rgba(226,232,240,0.92)",
                fontSize: fullscreen ? 18 : 10,
              }}
            >
              <span>{t(locale, "总体进度", "Overall progress")}</span>
              <span
                style={{
                  fontSize: fullscreen ? 26 : 12,
                  fontWeight: 700,
                  color: tone.accent,
                }}
              >
                {`${Math.round(progress)}%`}
              </span>
            </div>
            <div
              style={{
                marginTop: 6,
                height: fullscreen ? 16 : 7,
                borderRadius: 999,
                background: "rgba(51,65,85,0.72)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.max(6, progress)}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: tone.progress,
                  boxShadow: `0 0 18px ${tone.accent}`,
                }}
              />
            </div>
          </div>

          <div
            style={{
              marginTop: fullscreen ? 24 : 8,
              borderRadius: 12,
              border: `1px solid ${tone.accentSoft}`,
              background: "rgba(22,30,44,0.72)",
              padding: fullscreen ? "18px 20px" : "7px 10px",
              color: "rgba(203,213,225,0.92)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  width: fullscreen ? 12 : 7,
                  height: fullscreen ? 12 : 7,
                  borderRadius: 999,
                  background: needsAttention ? tone.accent : "#60a5fa",
                  boxShadow: `0 0 14px ${needsAttention ? tone.accent : "#60a5fa"}`,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: fullscreen ? 20 : 10,
                  lineHeight: compactWallView ? 1.35 : 1.45,
                }}
              >
                {signalLine}
              </span>
            </div>
          </div>

          {fullscreen ? (
            <div
              style={{
                marginTop: "auto",
                paddingTop: 30,
                borderTop: "1px solid rgba(71,85,105,0.34)",
                display: "flex",
                alignItems: "stretch",
              }}
            >
              <MetricTile
                label={t(locale, "完成", "Done")}
                value={String(completedCount)}
                color="#4ade80"
              />
              <div
                style={{
                  width: 1,
                  background: "rgba(71,85,105,0.36)",
                }}
              />
              <MetricTile
                label={t(locale, "关注", "Alerts")}
                value={String(warningCount)}
                color="#f87171"
              />
              <div
                style={{
                  width: 1,
                  background: "rgba(71,85,105,0.36)",
                }}
              />
              <MetricTile
                label={t(locale, "运行", "Active")}
                value={String(runningAgents)}
                color="#60a5fa"
              />
              <div
                style={{
                  width: 1,
                  background: "rgba(71,85,105,0.36)",
                }}
              />
              <MetricTile
                label={t(locale, "Agent", "Agent")}
                value={String(totalAgents || packageCount)}
                color="#fbbf24"
              />
            </div>
          ) : (
            <div
              style={{
                marginTop: 8,
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
                color: "rgba(191,219,254,0.88)",
                fontSize: 8,
              }}
            >
              {[
                `${t(locale, "运行", "Active")} ${runningAgents}`,
                `${t(locale, "关注", "Alerts")} ${warningCount}`,
                `${t(locale, "Agent", "Agent")} ${totalAgents || packageCount}`,
              ].map(item => (
                <span
                  key={item}
                  style={{
                    borderRadius: 999,
                    padding: "2px 7px",
                    background: "rgba(15,23,42,0.38)",
                    border: "1px solid rgba(71,85,105,0.16)",
                  }}
                >
                  {item}
                </span>
              ))}
            </div>
          )}

          {fullscreen ? (
            <div
              style={{
                marginTop: 18,
                fontSize: 13,
                color: "rgba(148,163,184,0.88)",
              }}
            >
              {t(
                locale,
                "这是墙面广播版任务视图，完整操作与详细事件流仍在右侧任务详情和 /tasks 页面中继续承载。",
                "This is the wall-broadcast task view. Full controls and detailed event flow remain in the right task detail and /tasks workbench."
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const MissionWallTaskPanel = memo(MissionWallTaskPanelInner);
