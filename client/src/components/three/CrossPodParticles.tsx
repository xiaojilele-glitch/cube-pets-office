import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { useSwarmStore } from "@/lib/swarm-store";
import type { CollaborationSession } from "@shared/swarm";

/* ── Constants ── */
const PARTICLE_COUNT_PER_SESSION = 12;
const CIRCLE_RADIUS = 4.5;
const FADE_OUT_DURATION = 1.0; // seconds
const SESSION_COLORS = [
  "#F59E0B", // amber
  "#3B82F6", // blue
  "#10B981", // emerald
  "#EF4444", // red
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#06B6D4", // cyan
  "#F97316", // orange
];

/* ── Helpers ── */

/** Deterministic hash from string → number in [0, 1) */
function hashPodId(podId: string): number {
  let h = 0;
  for (let i = 0; i < podId.length; i++) {
    h = (h * 31 + podId.charCodeAt(i)) | 0;
  }
  return Math.abs(h % 1000) / 1000;
}

/** Map a Pod ID to a position on a circle in the XZ plane */
function podPosition(podId: string): THREE.Vector3 {
  const angle = hashPodId(podId) * Math.PI * 2;
  return new THREE.Vector3(
    Math.cos(angle) * CIRCLE_RADIUS,
    0.5,
    Math.sin(angle) * CIRCLE_RADIUS
  );
}

/* ── Types ── */
interface SessionRenderData {
  session: CollaborationSession;
  source: THREE.Vector3;
  target: THREE.Vector3;
  color: THREE.Color;
}

/* ── Single session particle stream ── */

function SessionParticleStream({
  source,
  target,
  color,
  opacity,
  fadeOut,
}: {
  source: THREE.Vector3;
  target: THREE.Vector3;
  color: THREE.Color;
  opacity: number;
  fadeOut: number; // 0 = fully visible, 1 = fully faded
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  // Initialize particle positions along the path
  const { positions, offsets } = useMemo(() => {
    const pos = new Float32Array(PARTICLE_COUNT_PER_SESSION * 3);
    const off = new Float32Array(PARTICLE_COUNT_PER_SESSION);
    for (let i = 0; i < PARTICLE_COUNT_PER_SESSION; i++) {
      off[i] = i / PARTICLE_COUNT_PER_SESSION;
      // Initial positions will be set in useFrame
      pos[i * 3] = 0;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = 0;
    }
    return { positions: pos, offsets: off };
  }, []);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);

  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        color,
        size: 0.12,
        transparent: true,
        opacity: opacity * (1 - fadeOut),
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [color, opacity, fadeOut]
  );

  // Animate particles along the source→target path
  useFrame(({ clock }) => {
    if (!pointsRef.current) return;
    const t = clock.elapsedTime;
    const posAttr = pointsRef.current.geometry.attributes
      .position as THREE.BufferAttribute;

    for (let i = 0; i < PARTICLE_COUNT_PER_SESSION; i++) {
      // Progress along path, cycling with time
      const progress = (offsets[i] + t * 0.3) % 1;
      const x = source.x + (target.x - source.x) * progress;
      const y =
        source.y +
        (target.y - source.y) * progress +
        Math.sin(progress * Math.PI) * 0.4; // arc
      const z = source.z + (target.z - source.z) * progress;

      posAttr.setXYZ(i, x, y, z);
    }
    posAttr.needsUpdate = true;

    // Update material opacity for fade-out
    const mat = pointsRef.current.material as THREE.PointsMaterial;
    mat.opacity = opacity * (1 - fadeOut);

    // Glow opacity
    if (glowRef.current) {
      const glowMat = glowRef.current.material as THREE.MeshBasicMaterial;
      glowMat.opacity = 0.15 * opacity * (1 - fadeOut);
    }
  });

  const midpoint = useMemo(
    () =>
      new THREE.Vector3(
        (source.x + target.x) / 2,
        (source.y + target.y) / 2 + 0.4,
        (source.z + target.z) / 2
      ),
    [source, target]
  );

  return (
    <group>
      <points ref={pointsRef} geometry={geometry} material={material} />
      {/* Glow at midpoint */}
      <mesh ref={glowRef} position={midpoint}>
        <sphereGeometry args={[0.2, 8, 8]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.15 * opacity * (1 - fadeOut)}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

/* ── Main component ── */

export function CrossPodParticles({ active = true }: { active?: boolean }) {
  const activeSessions = useSwarmStore(s => s.activeSessions);

  if (!active) return null;

  // Track fade-out state for ended sessions
  const fadeMapRef = useRef<Map<string, { startTime: number }>>(new Map());
  const prevSessionIdsRef = useRef<Set<string>>(new Set());
  const clockRef = useRef(0);

  // Build render data for active + fading sessions
  const sessionRenderData = useMemo<SessionRenderData[]>(() => {
    return activeSessions
      .filter(s => s.status === "active" || s.status === "pending")
      .map((session, idx) => {
        const sourcePodId = session.request.sourcePodId;
        const targetPodId =
          session.response?.targetPodId ?? `target-${session.id}`;
        return {
          session,
          source: podPosition(sourcePodId),
          target: podPosition(targetPodId),
          color: new THREE.Color(SESSION_COLORS[idx % SESSION_COLORS.length]),
        };
      });
  }, [activeSessions]);

  // Detect ended sessions and start fade-out timers
  useFrame(({ clock }) => {
    clockRef.current = clock.elapsedTime;

    const currentIds = new Set(
      activeSessions
        .filter(s => s.status === "active" || s.status === "pending")
        .map(s => s.id)
    );

    // Sessions that were active but are no longer → start fade
    for (const prevId of Array.from(prevSessionIdsRef.current)) {
      if (!currentIds.has(prevId) && !fadeMapRef.current.has(prevId)) {
        fadeMapRef.current.set(prevId, { startTime: clock.elapsedTime });
      }
    }

    // Clean up fully faded sessions
    for (const [id, { startTime }] of Array.from(fadeMapRef.current)) {
      if (clock.elapsedTime - startTime > FADE_OUT_DURATION) {
        fadeMapRef.current.delete(id);
      }
    }

    prevSessionIdsRef.current = currentIds;
  });

  // Compute opacity per session based on total active count
  const baseOpacity = useMemo(() => {
    const count = sessionRenderData.length;
    if (count <= 1) return 1.0;
    if (count <= 3) return 0.8;
    if (count <= 6) return 0.6;
    return 0.4;
  }, [sessionRenderData.length]);

  if (sessionRenderData.length === 0 && fadeMapRef.current.size === 0) {
    return null;
  }

  return (
    <group>
      {/* Active sessions */}
      {sessionRenderData.map(data => (
        <SessionParticleStream
          key={data.session.id}
          source={data.source}
          target={data.target}
          color={data.color}
          opacity={baseOpacity}
          fadeOut={0}
        />
      ))}

      {/* Pod glow highlights for active sessions */}
      {sessionRenderData.map(data => (
        <PodGlow
          key={`glow-${data.session.id}`}
          position={data.source}
          color={data.color}
          opacity={baseOpacity}
        />
      ))}
    </group>
  );
}

/* ── Pod glow highlight ── */

function PodGlow({
  position,
  color,
  opacity,
}: {
  position: THREE.Vector3;
  color: THREE.Color;
  opacity: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    const pulse = 0.1 + Math.sin(clock.elapsedTime * 2) * 0.05;
    mat.opacity = pulse * opacity;
  });

  return (
    <mesh ref={meshRef} position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[0.6, 24]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.1 * opacity}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}
