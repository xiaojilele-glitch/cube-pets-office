/**
 * SandboxMonitor — 3D monitor group for sandbox live preview.
 *
 * Renders 2 BoxGeometry screens (terminal + screenshot) with Html bridging,
 * positioned at the right side of the office scene.
 *
 * @see Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { useSandboxStore } from "@/lib/sandbox-store";
import { TerminalPreview } from "../sandbox/TerminalPreview";
import { ScreenshotPreview } from "../sandbox/ScreenshotPreview";

/* ── Constants ── */
const MONITOR_POSITION: [number, number, number] = [5.5, 0, 1.0];
const MONITOR_ROTATION: [number, number, number] = [0, -Math.PI / 6, 0];

const SCREEN_COLOR = "#1a1a2e";
const STAND_COLOR = "#555";
const GLOW_ACTIVE = new THREE.Color("#4FC3F7");
const GLOW_IDLE = new THREE.Color("#333");

const TERMINAL_HTML_OFFSET: [number, number, number] = [0, 2.2, 0];
const SCREENSHOT_HTML_OFFSET: [number, number, number] = [1.8, 2.2, 0];

export function SandboxMonitor() {
  const logLines = useSandboxStore((s) => s.logLines);
  const isStreaming = useSandboxStore((s) => s.isStreaming);
  const fullscreen = useSandboxStore((s) => s.fullscreen);
  const latestScreenshot = useSandboxStore((s) => s.latestScreenshot);
  const previousScreenshot = useSandboxStore((s) => s.previousScreenshot);
  const setFullscreen = useSandboxStore((s) => s.setFullscreen);

  const glowRef1 = useRef<THREE.Mesh>(null);
  const glowRef2 = useRef<THREE.Mesh>(null);

  // Glow animation based on streaming state
  useFrame(({ clock }) => {
    const refs = [glowRef1.current, glowRef2.current];
    for (const mesh of refs) {
      if (!mesh) continue;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (isStreaming) {
        const pulse = 0.3 + Math.sin(clock.elapsedTime * 2) * 0.2;
        mat.emissive.copy(GLOW_ACTIVE);
        mat.emissiveIntensity = pulse;
      } else {
        mat.emissive.copy(GLOW_IDLE);
        mat.emissiveIntensity = 0.05;
      }
    }
  });

  const handleToggleFullscreen = () => setFullscreen(!fullscreen);
  const handleZoomScreenshot = () => {
    /* Could open a modal — for now toggle fullscreen */
    setFullscreen(!fullscreen);
  };

  return (
    <group position={MONITOR_POSITION} rotation={MONITOR_ROTATION}>
      {/* ── Main monitor (Terminal) ── */}
      <group position={[0, 1.6, 0]}>
        {/* Screen */}
        <mesh ref={glowRef1} castShadow>
          <boxGeometry args={[1.6, 1.0, 0.05]} />
          <meshStandardMaterial
            color={SCREEN_COLOR}
            emissive={GLOW_IDLE}
            emissiveIntensity={0.05}
          />
        </mesh>
        {/* Stand */}
        <mesh position={[0, -0.6, 0]} castShadow>
          <boxGeometry args={[0.1, 0.3, 0.1]} />
          <meshStandardMaterial color={STAND_COLOR} roughness={0.8} />
        </mesh>
        <mesh position={[0, -0.75, 0]} castShadow>
          <boxGeometry args={[0.5, 0.05, 0.3]} />
          <meshStandardMaterial color={STAND_COLOR} roughness={0.8} />
        </mesh>
      </group>

      {/* ── Secondary monitor (Screenshot) ── */}
      <group position={[1.8, 1.6, 0]}>
        <mesh ref={glowRef2} castShadow>
          <boxGeometry args={[1.2, 0.8, 0.05]} />
          <meshStandardMaterial
            color={SCREEN_COLOR}
            emissive={GLOW_IDLE}
            emissiveIntensity={0.05}
          />
        </mesh>
        <mesh position={[0, -0.5, 0]} castShadow>
          <boxGeometry args={[0.08, 0.25, 0.08]} />
          <meshStandardMaterial color={STAND_COLOR} roughness={0.8} />
        </mesh>
        <mesh position={[0, -0.63, 0]} castShadow>
          <boxGeometry args={[0.4, 0.04, 0.25]} />
          <meshStandardMaterial color={STAND_COLOR} roughness={0.8} />
        </mesh>
      </group>

      {/* ── Html bridges ── */}
      <Html
        position={TERMINAL_HTML_OFFSET}
        center
        distanceFactor={7}
        style={{ pointerEvents: "auto", width: 320, height: 200 }}
      >
        <TerminalPreview
          logLines={logLines}
          isStreaming={isStreaming}
          fullscreen={fullscreen}
          onToggleFullscreen={handleToggleFullscreen}
        />
      </Html>

      <Html
        position={SCREENSHOT_HTML_OFFSET}
        center
        distanceFactor={7}
        style={{ pointerEvents: "auto", width: 240, height: 160 }}
      >
        <ScreenshotPreview
          current={latestScreenshot}
          previous={previousScreenshot}
          onClickZoom={handleZoomScreenshot}
        />
      </Html>
    </group>
  );
}
