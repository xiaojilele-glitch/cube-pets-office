/**
 * CrossFrameworkParticles — 3D diamond-shaped particle flow for A2A sessions.
 *
 * Renders diamond (octahedron) particles with gradient trails per active A2A session,
 * color-coded by framework type. Shows framework labels on active sessions,
 * green pulse on completion, red pulse on failure.
 *
 * @see Requirements 8.1, 8.2, 8.3, 8.5
 */

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useA2AStore } from "../../lib/a2a-store";
import type { A2AFrameworkType } from "../../../../shared/a2a-protocol";

/* ── Constants ── */
const FRAMEWORK_COLORS: Record<A2AFrameworkType, string> = {
  crewai: "#3B82F6",
  langgraph: "#8B5CF6",
  claude: "#F59E0B",
  custom: "#6B7280",
};

const PULSE_GREEN = new THREE.Color("#22C55E");
const PULSE_RED = new THREE.Color("#EF4444");

const BASE_POSITION: [number, number, number] = [-4, 2, 0];

export function CrossFrameworkParticles({
  active = true,
  showLabels = true,
}: {
  active?: boolean;
  showLabels?: boolean;
}) {
  const activeSessions = useA2AStore(s => s.activeSessions);
  const groupRef = useRef<THREE.Group>(null);

  if (!active) return null;

  // Diamond geometry (rotated octahedron)
  const diamondGeo = useMemo(() => new THREE.OctahedronGeometry(0.08, 0), []);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;

    groupRef.current.children.forEach((child, i) => {
      if (child instanceof THREE.Group) {
        // Animate particles along a path
        const offset = i * 0.8;
        child.position.x = i * 0.5 + Math.sin(t * 0.5 + offset) * 0.3;
        child.position.y = Math.cos(t * 0.3 + offset) * 0.15;

        // Rotate diamond particles
        const diamond = child.children[0];
        if (diamond instanceof THREE.Mesh) {
          diamond.rotation.y = t * 2;
          diamond.rotation.z = t * 1.5;
        }
      }
    });
  });

  if (activeSessions.length === 0) return null;

  return (
    <group ref={groupRef} position={BASE_POSITION}>
      {activeSessions.map((session, index) => {
        const color =
          FRAMEWORK_COLORS[session.frameworkType] ?? FRAMEWORK_COLORS.custom;
        const isCompleted = session.status === "completed";
        const isFailed = session.status === "failed";
        const pulseColor = isCompleted
          ? PULSE_GREEN
          : isFailed
            ? PULSE_RED
            : null;

        return (
          <group key={session.sessionId} position={[index * 0.5, 0, 0]}>
            {/* Diamond particle */}
            <mesh geometry={diamondGeo} castShadow>
              <meshStandardMaterial
                color={color}
                emissive={pulseColor ?? new THREE.Color(color)}
                emissiveIntensity={pulseColor ? 0.8 : 0.3}
                transparent
                opacity={0.9}
              />
            </mesh>

            {/* Trail line */}
            <mesh position={[0, -0.15, 0]}>
              <boxGeometry args={[0.02, 0.3, 0.02]} />
              <meshStandardMaterial color={color} transparent opacity={0.4} />
            </mesh>

            {/* Framework type label for active sessions */}
            {showLabels &&
            (session.status === "running" || session.status === "pending") ? (
              <Html
                position={[0, 0.2, 0]}
                center
                distanceFactor={10}
                style={{ pointerEvents: "none" }}
              >
                <div
                  style={{
                    background: "rgba(0,0,0,0.7)",
                    color,
                    padding: "2px 6px",
                    borderRadius: 4,
                    fontSize: 10,
                    fontFamily: "monospace",
                    whiteSpace: "nowrap",
                  }}
                >
                  {session.frameworkType.toUpperCase()}
                </div>
              </Html>
            ) : null}
          </group>
        );
      })}
    </group>
  );
}
