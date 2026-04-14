/**
 * SandboxMonitor - wall-mounted side cards for terminal and browser preview.
 *
 * The center mission card is rendered by MissionIsland. This component only
 * places the left and right cards directly on the wall without a device shell.
 */

import { Html } from "@react-three/drei";
import { type ReactNode, useEffect, useMemo } from "react";

import { useI18n } from "@/i18n";
import { type SandboxFocusedPane, useSandboxStore } from "@/lib/sandbox-store";
import { useTasksStore } from "@/lib/tasks-store";

import { ScreenshotPreview } from "../sandbox/ScreenshotPreview";
import { TerminalPreview } from "../sandbox/TerminalPreview";
import {
  resolveBrowserContextLabel,
  resolveBrowserPreviewFrames,
  resolvePaneStatusLabel,
  resolveSandboxMonitorMission,
} from "./sandbox-monitor-helpers";

const WALL_MONITOR_POSITION: [number, number, number] = [0, 1.42, -4.79];
const SLOT_SPACING = 4.35;
const PANEL_Z = 0.008;

const SLOT_LAYOUT = {
  terminal: {
    x: -SLOT_SPACING,
    htmlWidth: 294,
  },
  browser: {
    x: SLOT_SPACING,
    htmlWidth: 294,
  },
} as const;

const HTML_HEIGHT = 164;
const HTML_DISTANCE_FACTOR = 5.3;

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function PaneHtml({
  position,
  width,
  children,
}: {
  position: [number, number, number];
  width: number;
  children: ReactNode;
}) {
  return (
    <Html
      transform
      position={position}
      center
      distanceFactor={HTML_DISTANCE_FACTOR}
      style={{
        pointerEvents: "auto",
        width,
        height: HTML_HEIGHT,
      }}
    >
      {children}
    </Html>
  );
}

export function SandboxMonitor() {
  const { locale } = useI18n();

  const tasks = useTasksStore(s => s.tasks);
  const detailsById = useTasksStore(s => s.detailsById);
  const selectedTaskId = useTasksStore(s => s.selectedTaskId);

  const logLines = useSandboxStore(s => s.logLines);
  const isStreaming = useSandboxStore(s => s.isStreaming);
  const focusedPane = useSandboxStore(s => s.focusedPane);
  const activeMissionId = useSandboxStore(s => s.activeMissionId);
  const latestScreenshot = useSandboxStore(s => s.latestScreenshot);
  const previousScreenshot = useSandboxStore(s => s.previousScreenshot);
  const setActiveMission = useSandboxStore(s => s.setActiveMission);
  const setFocusedPane = useSandboxStore(s => s.setFocusedPane);

  const { displayMission, missionDetail } = useMemo(
    () => resolveSandboxMonitorMission(tasks, detailsById, selectedTaskId),
    [detailsById, selectedTaskId, tasks]
  );

  const { current: browserCurrentFrame, previous: browserPreviousFrame } =
    useMemo(
      () => resolveBrowserPreviewFrames(latestScreenshot, previousScreenshot),
      [latestScreenshot, previousScreenshot]
    );

  useEffect(() => {
    const nextMissionId = displayMission?.id ?? null;
    if (activeMissionId !== nextMissionId) {
      setActiveMission(nextMissionId);
    }
  }, [activeMissionId, displayMission?.id, setActiveMission]);

  const taskStageLabel =
    missionDetail?.currentStageLabel ||
    displayMission?.currentStageLabel ||
    t(locale, "等待任务", "Awaiting mission");

  const terminalStatus = resolvePaneStatusLabel(
    locale,
    displayMission?.status,
    "terminal",
    isStreaming || logLines.length > 0
  );
  const browserStatus = resolvePaneStatusLabel(
    locale,
    displayMission?.status,
    "browser",
    Boolean(browserCurrentFrame)
  );
  const browserContext = resolveBrowserContextLabel(
    locale,
    taskStageLabel,
    displayMission?.title
  );

  const closePaneFocus = () => setFocusedPane(null);
  const togglePane = (pane: SandboxFocusedPane) => {
    setFocusedPane(focusedPane === pane ? null : pane);
  };

  return (
    <group position={WALL_MONITOR_POSITION}>
      <PaneHtml
        position={[SLOT_LAYOUT.terminal.x, 0, PANEL_Z]}
        width={SLOT_LAYOUT.terminal.htmlWidth}
      >
        <TerminalPreview
          logLines={logLines}
          isStreaming={isStreaming}
          fullscreen={focusedPane === "terminal"}
          onToggleFullscreen={closePaneFocus}
          embedded
          onActivate={() => togglePane("terminal")}
          showFullscreenButton={false}
          title={t(locale, "执行流", "Execution Feed")}
          statusLabel={terminalStatus}
          variant="wall"
        />
      </PaneHtml>

      <PaneHtml
        position={[SLOT_LAYOUT.browser.x, 0, PANEL_Z]}
        width={SLOT_LAYOUT.browser.htmlWidth}
      >
        <ScreenshotPreview
          current={browserCurrentFrame}
          previous={browserPreviousFrame}
          onClickZoom={() => {
            if (focusedPane !== "browser") {
              setFocusedPane("browser");
            }
          }}
          embedded
          fullscreen={focusedPane === "browser"}
          onToggleFullscreen={closePaneFocus}
          showFullscreenButton={false}
          title={t(locale, "浏览器实时画面", "Browser Live")}
          statusLabel={browserStatus}
          contextLabel={browserContext}
          variant="wall"
        />
      </PaneHtml>
    </group>
  );
}
