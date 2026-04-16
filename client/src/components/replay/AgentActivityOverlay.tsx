/**
 * AgentActivityOverlay — 3D overlay showing agent activity state.
 *
 * Renders a translucent sphere above an agent's position with color and
 * animation driven by the current activity state:
 *   idle     → dim gray, no pulse
 *   working  → blue, gentle pulse
 *   thinking → purple, slow breathe
 *   done     → green, single flash then fade
 *   error    → red, fast pulse
 *
 * Requirements: 8.1, 8.4
 */

import { useRef } from "react";

import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export type AgentActivity = "idle" | "working" | "thinking" | "done" | "error";

export interface AgentActivityOverlayProps {
  position: [number, number, number];
  activity: AgentActivity;
}

/* ─── Color map ─── */

const ACTIVITY_COLORS: Record<AgentActivity, string> = {
  idle: "#9CA3AF",
  working: "#3B82F6",
  thinking: "#A855F7",
  done: "#22C55E",
  error: "#EF4444",
};

/* ─── Component ─── */

export function AgentActivityOverlay({
  position,
  activity,
}: AgentActivityOverlayProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current || !matRef.current) return;

    const t = clock.elapsedTime;
    let opacity = 0.35;
    let scale = 1;

    switch (activity) {
      case "working":
        opacity = 0.3 + Math.sin(t * 3) * 0.15;
        scale = 1 + Math.sin(t * 3) * 0.08;
        break;
      case "thinking":
        opacity = 0.25 + Math.sin(t * 1.5) * 0.2;
        scale = 1 + Math.sin(t * 1.5) * 0.05;
        break;
      case "done":
        opacity = Math.max(0, 0.5 - (t % 3) * 0.2);
        break;
      case "error":
        opacity = 0.4 + Math.sin(t * 6) * 0.25;
        scale = 1 + Math.sin(t * 6) * 0.12;
        break;
      default: // idle
        opacity = 0.15;
        break;
    }

    matRef.current.opacity = opacity;
    meshRef.current.scale.setScalar(scale);
  });

  if (activity === "idle") return null;

  return (
    <mesh
      ref={meshRef}
      position={[position[0], position[1] + 1.6, position[2]]}
    >
      <sphereGeometry args={[0.35, 16, 16]} />
      <meshStandardMaterial
        ref={matRef}
        color={ACTIVITY_COLORS[activity]}
        transparent
        opacity={0.35}
        emissive={ACTIVITY_COLORS[activity]}
        emissiveIntensity={0.6}
        depthWrite={false}
      />
    </mesh>
  );
}
