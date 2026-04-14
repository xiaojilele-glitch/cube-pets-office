/**
 * SandboxMonitor - wall-mounted three-pane mission display.
 *
 * Left: execution feed
 * Center: mission control
 * Right: browser live
 */

import { Html } from "@react-three/drei";
import { type ReactNode, useEffect, useMemo } from "react";

import { useI18n } from "@/i18n";
import { type SandboxFocusedPane, useSandboxStore } from "@/lib/sandbox-store";
import { useTasksStore } from "@/lib/tasks-store";

import { ScreenshotPreview } from "../sandbox/ScreenshotPreview";
import { TerminalPreview } from "../sandbox/TerminalPreview";
import { MissionWallTaskPanel } from "./MissionWallTaskPanel";
import {
  resolveBrowserContextLabel,
  resolveBrowserPreviewFrames,
  resolvePaneStatusLabel,
  resolveSandboxMonitorMission,
} from "./sandbox-monitor-helpers";

const WALL_MONITOR_POSITION: [number, number, number] = [0, 1.42, -4.75];

const SLOT_HEIGHT = 0.82;
const SLOT_Z = 0.047;
const SLOT_LAYOUT = {
  terminal: {
    width: 1.26,
    height: SLOT_HEIGHT,
    x: -1.66,
    accent: "#7dd3fc",
    htmlWidth: 190,
  },
  task: {
    width: 1.94,
    height: SLOT_HEIGHT,
    x: 0,
    accent: "#fb923c",
    htmlWidth: 296,
  },
  browser: {
    width: 1.26,
    height: SLOT_HEIGHT,
    x: 1.66,
    accent: "#60a5fa",
    htmlWidth: 190,
  },
} as const;

const HTML_HEIGHT = 150;
const HTML_DISTANCE_FACTOR = 10.2;

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function MonitorPaneSlot({
  position,
  width,
  height,
  accentColor,
  active = false,
  primary = false,
}: {
  position: [number, number, number];
  width: number;
  height: number;
  accentColor: string;
  active?: boolean;
  primary?: boolean;
}) {
  return (
    <group position={position}>
      <mesh position={[0, 0, -0.018]} castShadow receiveShadow>
        <boxGeometry args={[width + 0.14, height + 0.14, 0.02]} />
        <meshStandardMaterial color="#5F4D40" roughness={0.92} />
      </mesh>

      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, height, 0.04]} />
        <meshStandardMaterial
          color={primary ? "#131c28" : "#121a24"}
          roughness={0.48}
          metalness={0.14}
        />
      </mesh>

      <mesh position={[0, 0, 0.017]}>
        <boxGeometry args={[width - 0.08, height - 0.08, 0.006]} />
        <meshStandardMaterial
          color="#050b12"
          emissive={accentColor}
          emissiveIntensity={active ? 0.08 : primary ? 0.035 : 0.02}
          transparent
          opacity={0.92}
        />
      </mesh>

      <mesh position={[0, height / 2 - 0.048, 0.022]}>
        <boxGeometry args={[width - 0.12, 0.032, 0.008]} />
        <meshStandardMaterial
          color={accentColor}
          emissive={accentColor}
          emissiveIntensity={active ? 0.46 : primary ? 0.24 : 0.14}
          roughness={0.52}
        />
      </mesh>

      <mesh position={[-width / 2 + 0.1, -height / 2 + 0.08, 0.026]}>
        <cylinderGeometry args={[0.016, 0.016, 0.014, 18]} />
        <meshStandardMaterial
          color="#dbeafe"
          emissive={accentColor}
          emissiveIntensity={active ? 0.6 : 0.22}
          roughness={0.34}
          metalness={0.12}
        />
      </mesh>

      {active ? (
        <mesh position={[0, 0, 0.031]}>
          <boxGeometry args={[width + 0.02, height + 0.02, 0.004]} />
          <meshStandardMaterial
            color={accentColor}
            emissive={accentColor}
            emissiveIntensity={0.38}
            transparent
            opacity={0.26}
          />
        </mesh>
      ) : null}
    </group>
  );
}

function WallMonitorShell({
  focusedPane,
}: {
  focusedPane: SandboxFocusedPane | null;
}) {
  return (
    <group position={WALL_MONITOR_POSITION}>
      <mesh position={[0, -0.03, -0.055]} receiveShadow>
        <boxGeometry args={[5.1, 1.48, 0.03]} />
        <meshStandardMaterial color="#7b6552" transparent opacity={0.24} />
      </mesh>

      <mesh position={[0, 0, -0.045]} castShadow receiveShadow>
        <boxGeometry args={[1.08, 0.38, 0.05]} />
        <meshStandardMaterial color="#40352c" roughness={0.88} />
      </mesh>
      {[-0.46, 0.46].map(x => (
        <mesh key={x} position={[x, -0.16, -0.015]} castShadow receiveShadow>
          <boxGeometry args={[0.12, 0.54, 0.05]} />
          <meshStandardMaterial color="#3a312a" roughness={0.88} />
        </mesh>
      ))}

      <mesh position={[0, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[5.02, 1.34, 0.08]} />
        <meshStandardMaterial
          color="#26313d"
          metalness={0.22}
          roughness={0.46}
        />
      </mesh>

      <mesh position={[0, 0, 0.028]} castShadow receiveShadow>
        <boxGeometry args={[4.8, 1.08, 0.018]} />
        <meshStandardMaterial
          color="#0a121b"
          metalness={0.08}
          roughness={0.24}
          emissive="#0b1320"
          emissiveIntensity={0.14}
        />
      </mesh>

      <mesh position={[0, 0.6, 0.034]}>
        <boxGeometry args={[4.8, 0.08, 0.012]} />
        <meshStandardMaterial
          color="#5c6b7a"
          roughness={0.52}
          metalness={0.24}
        />
      </mesh>

      <mesh position={[0, -0.6, 0.028]}>
        <boxGeometry args={[4.42, 0.03, 0.01]} />
        <meshStandardMaterial
          color="#435261"
          roughness={0.64}
          metalness={0.16}
        />
      </mesh>

      {[-2.08, -1.94, -1.8].map((x, index) => {
        const color = ["#f97373", "#fbbf24", "#4ade80"][index] || "#94a3b8";
        return (
          <mesh key={x} position={[x, 0.6, 0.044]}>
            <cylinderGeometry args={[0.035, 0.035, 0.014, 18]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.32}
              roughness={0.34}
            />
          </mesh>
        );
      })}

      {[-0.83, 0.83].map(x => (
        <mesh key={x} position={[x, 0, 0.03]}>
          <boxGeometry args={[0.018, 0.94, 0.012]} />
          <meshStandardMaterial
            color="#31404d"
            roughness={0.62}
            metalness={0.14}
          />
        </mesh>
      ))}

      <mesh position={[0, 0, 0.038]}>
        <planeGeometry args={[4.7, 0.96]} />
        <meshStandardMaterial
          color="#0f1723"
          transparent
          opacity={0.08}
          emissive="#60a5fa"
          emissiveIntensity={0.12}
        />
      </mesh>

      <MonitorPaneSlot
        position={[SLOT_LAYOUT.terminal.x, 0, SLOT_Z]}
        width={SLOT_LAYOUT.terminal.width}
        height={SLOT_LAYOUT.terminal.height}
        accentColor={SLOT_LAYOUT.terminal.accent}
        active={focusedPane === "terminal"}
      />
      <MonitorPaneSlot
        position={[SLOT_LAYOUT.task.x, 0, SLOT_Z]}
        width={SLOT_LAYOUT.task.width}
        height={SLOT_LAYOUT.task.height}
        accentColor={SLOT_LAYOUT.task.accent}
        active={focusedPane === "task"}
        primary
      />
      <MonitorPaneSlot
        position={[SLOT_LAYOUT.browser.x, 0, SLOT_Z]}
        width={SLOT_LAYOUT.browser.width}
        height={SLOT_LAYOUT.browser.height}
        accentColor={SLOT_LAYOUT.browser.accent}
        active={focusedPane === "browser"}
      />

      <mesh position={[0, -0.78, -0.018]} castShadow receiveShadow>
        <cylinderGeometry args={[0.024, 0.03, 0.78, 14]} />
        <meshStandardMaterial
          color="#262f39"
          roughness={0.56}
          metalness={0.22}
        />
      </mesh>
      <mesh position={[0.06, -1.18, -0.01]} rotation={[0.12, 0.08, 0.26]}>
        <torusGeometry args={[0.26, 0.016, 12, 32, Math.PI * 1.08]} />
        <meshStandardMaterial
          color="#1d2430"
          roughness={0.62}
          metalness={0.14}
        />
      </mesh>
    </group>
  );
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
  const selectTask = useTasksStore(s => s.selectTask);

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

  const handleTaskActivate = () => {
    if (displayMission?.id) {
      selectTask(displayMission.id);
    }
    togglePane("task");
  };

  return (
    <group>
      <WallMonitorShell focusedPane={focusedPane} />

      <group position={WALL_MONITOR_POSITION}>
        <PaneHtml
          position={[SLOT_LAYOUT.terminal.x, 0, SLOT_Z + 0.018]}
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
          position={[SLOT_LAYOUT.task.x, 0, SLOT_Z + 0.018]}
          width={SLOT_LAYOUT.task.htmlWidth}
        >
          <MissionWallTaskPanel
            mission={displayMission}
            detail={missionDetail}
            fullscreen={focusedPane === "task"}
            onActivate={handleTaskActivate}
            onClose={closePaneFocus}
          />
        </PaneHtml>

        <PaneHtml
          position={[SLOT_LAYOUT.browser.x, 0, SLOT_Z + 0.018]}
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
    </group>
  );
}
