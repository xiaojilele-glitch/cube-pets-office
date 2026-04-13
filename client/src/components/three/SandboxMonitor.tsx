/**
 * SandboxMonitor - unified wall-mounted sandbox console.
 *
 * The live terminal and browser preview are embedded into a single wall
 * console so the office scene reads like one mounted information zone rather
 * than two unrelated floating cards.
 */

import { Html } from "@react-three/drei";

import { useSandboxStore } from "@/lib/sandbox-store";

import { TerminalPreview } from "../sandbox/TerminalPreview";
import { ScreenshotPreview } from "../sandbox/ScreenshotPreview";

const WALL_CONSOLE_POSITION: [number, number, number] = [0, 1.4, -4.76];
const TERMINAL_PANEL_OFFSET: [number, number, number] = [-0.94, 0, 0.028];
const SCREENSHOT_PANEL_OFFSET: [number, number, number] = [1.23, 0, 0.028];

const TERMINAL_HTML_OFFSET: [number, number, number] = [-0.94, 0, 0.05];
const SCREENSHOT_HTML_OFFSET: [number, number, number] = [1.23, 0, 0.05];

function ConsolePanelSlot({
  position,
  width,
  height,
  accentColor,
}: {
  position: [number, number, number];
  width: number;
  height: number;
  accentColor: string;
}) {
  return (
    <group position={position}>
      <mesh position={[0, 0, -0.008]} castShadow receiveShadow>
        <boxGeometry args={[width + 0.1, height + 0.1, 0.012]} />
        <meshStandardMaterial color="#725C4A" roughness={0.92} />
      </mesh>

      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, height, 0.028]} />
        <meshStandardMaterial
          color="#151D2A"
          roughness={0.5}
          metalness={0.08}
        />
      </mesh>

      <mesh position={[0, height / 2 - 0.05, 0.02]}>
        <boxGeometry args={[width, 0.04, 0.008]} />
        <meshStandardMaterial color={accentColor} roughness={0.76} />
      </mesh>

      {[-width / 2 + 0.14, width / 2 - 0.14].map(x => (
        <mesh key={x} position={[x, height / 2 - 0.05, 0.024]}>
          <cylinderGeometry args={[0.012, 0.012, 0.012, 16]} />
          <meshStandardMaterial
            color="#F3E7D6"
            emissive={accentColor}
            emissiveIntensity={0.18}
            roughness={0.42}
            metalness={0.08}
          />
        </mesh>
      ))}
    </group>
  );
}

function WallConsoleBoard() {
  return (
    <group position={WALL_CONSOLE_POSITION}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[4.82, 1.24, 0.05]} />
        <meshStandardMaterial color="#8E765E" roughness={0.96} />
      </mesh>

      <mesh position={[0, 0, 0.018]} castShadow receiveShadow>
        <boxGeometry args={[4.54, 1.02, 0.022]} />
        <meshStandardMaterial color="#2F3846" roughness={0.7} />
      </mesh>

      <mesh position={[0, 0.54, 0.022]}>
        <boxGeometry args={[4.54, 0.08, 0.01]} />
        <meshStandardMaterial color="#A58A71" roughness={0.84} />
      </mesh>

      {[-1.92, -1.78, -1.64].map((x, index) => (
        <mesh key={x} position={[x, 0.54, 0.03]}>
          <cylinderGeometry args={[0.035, 0.035, 0.018, 18]} />
          <meshStandardMaterial
            color={["#F48C7F", "#F2B565", "#7BC7A1"][index]}
            emissive={["#F48C7F", "#F2B565", "#7BC7A1"][index]}
            emissiveIntensity={0.18}
            roughness={0.32}
          />
        </mesh>
      ))}

      <mesh position={[0, -0.56, 0.018]}>
        <boxGeometry args={[3.96, 0.03, 0.012]} />
        <meshStandardMaterial color="#6D5848" roughness={0.9} />
      </mesh>

      <ConsolePanelSlot
        position={TERMINAL_PANEL_OFFSET}
        width={2.34}
        height={0.88}
        accentColor="#D29974"
      />
      <ConsolePanelSlot
        position={SCREENSHOT_PANEL_OFFSET}
        width={1.7}
        height={0.88}
        accentColor="#8FA9C3"
      />
    </group>
  );
}

export function SandboxMonitor() {
  const logLines = useSandboxStore(s => s.logLines);
  const isStreaming = useSandboxStore(s => s.isStreaming);
  const fullscreen = useSandboxStore(s => s.fullscreen);
  const latestScreenshot = useSandboxStore(s => s.latestScreenshot);
  const previousScreenshot = useSandboxStore(s => s.previousScreenshot);
  const setFullscreen = useSandboxStore(s => s.setFullscreen);

  const handleToggleFullscreen = () => setFullscreen(!fullscreen);
  const handleZoomScreenshot = () => {
    setFullscreen(!fullscreen);
  };

  return (
    <group>
      <WallConsoleBoard />

      <Html
        transform
        position={[
          WALL_CONSOLE_POSITION[0] + TERMINAL_HTML_OFFSET[0],
          WALL_CONSOLE_POSITION[1] + TERMINAL_HTML_OFFSET[1],
          WALL_CONSOLE_POSITION[2] + TERMINAL_HTML_OFFSET[2],
        ]}
        center
        distanceFactor={9.4}
        style={{ pointerEvents: "auto", width: 288, height: 136 }}
      >
        <TerminalPreview
          logLines={logLines}
          isStreaming={isStreaming}
          fullscreen={fullscreen}
          onToggleFullscreen={handleToggleFullscreen}
          embedded
        />
      </Html>

      <Html
        transform
        position={[
          WALL_CONSOLE_POSITION[0] + SCREENSHOT_HTML_OFFSET[0],
          WALL_CONSOLE_POSITION[1] + SCREENSHOT_HTML_OFFSET[1],
          WALL_CONSOLE_POSITION[2] + SCREENSHOT_HTML_OFFSET[2],
        ]}
        center
        distanceFactor={9.4}
        style={{ pointerEvents: "auto", width: 202, height: 136 }}
      >
        <ScreenshotPreview
          current={latestScreenshot}
          previous={previousScreenshot}
          onClickZoom={handleZoomScreenshot}
          embedded
        />
      </Html>
    </group>
  );
}
