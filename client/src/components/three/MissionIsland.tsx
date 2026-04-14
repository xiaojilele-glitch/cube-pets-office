import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useLocation } from "wouter";

import { useViewportTier } from "@/hooks/useViewportTier";
import { useTasksStore } from "@/lib/tasks-store";

import { MissionDetailOverlay } from "../tasks/MissionDetailOverlay";
import { MissionMiniView } from "../tasks/MissionMiniView";
import {
  extractActiveAgents,
  getIslandScale,
  selectDisplayMission,
} from "../tasks/mission-island-helpers";

/* ── Constants ── */
const ISLAND_POSITION: [number, number, number] = [0, 0, -2.5];
const MINI_VIEW_OFFSET: [number, number, number] = [0, 2.8, 0];
const WALL_MOUNT_OFFSET: [number, number, number] = [0, 1.42, -2.29];
const WALL_MOUNT_ROTATION: [number, number, number] = [0, 0, 0];

const GLOW_COLOR_ACTIVE = new THREE.Color("#F59E0B");
const GLOW_COLOR_IDLE = new THREE.Color("#D6C4A8");
const PLATFORM_COLOR = "#8B7355";

/* ── Data Hook ── */
function useMissionIslandData() {
  const tasks = useTasksStore((s) => s.tasks);
  const detailsById = useTasksStore((s) => s.detailsById);

  const selectedMission = useMemo(() => selectDisplayMission(tasks), [tasks]);

  const missionDetail = selectedMission
    ? (detailsById[selectedMission.id] ?? null)
    : null;

  const isRunning = selectedMission?.status === "running";

  const activeAgents = useMemo(
    () => (missionDetail ? extractActiveAgents(missionDetail) : []),
    [missionDetail],
  );

  return { selectedMission, missionDetail, isRunning, activeAgents };
}

/* ── Main Component ── */
export function MissionIsland() {
  const { selectedMission, missionDetail, isRunning } =
    useMissionIslandData();
  const [expanded, setExpanded] = useState(false);
  const [, setLocation] = useLocation();
  const { tier } = useViewportTier();

  const glowRef = useRef<THREE.Mesh>(null);

  const scale = getIslandScale(tier);
  const mountOnWall = tier === "desktop";

  /* Close overlay when selected mission disappears */
  useEffect(() => {
    if (!selectedMission && expanded) setExpanded(false);
  }, [selectedMission, expanded]);

  /* Escape key closes Detail Overlay */
  useEffect(() => {
    if (!expanded) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [expanded]);

  /* Glow pulse animation */
  useFrame(({ clock }) => {
    if (!glowRef.current) return;
    const mat = glowRef.current.material as THREE.MeshStandardMaterial;
    if (isRunning) {
      const pulse = 0.4 + Math.sin(clock.elapsedTime * 2.5) * 0.3;
      mat.emissive.copy(GLOW_COLOR_ACTIVE);
      mat.emissiveIntensity = pulse;
      mat.opacity = 0.5 + pulse * 0.4;
    } else {
      mat.emissive.copy(GLOW_COLOR_IDLE);
      mat.emissiveIntensity = 0.15;
      mat.opacity = 0.25;
    }
  });

  const handleIslandClick = useCallback(
    (e: THREE.Event) => {
      (e as unknown as { stopPropagation: () => void }).stopPropagation();
      setExpanded((prev) => !prev);
    },
    [],
  );

  const handleExpand = useCallback(() => setExpanded(true), []);
  const handleClose = useCallback(() => setExpanded(false), []);

  const handleNavigateToDetail = useCallback(
    (taskId: string) => {
      setExpanded(false);
      setLocation(`/tasks/${taskId}`);
    },
    [setLocation],
  );

  const handleCreateMission = useCallback(() => {
    setLocation("/tasks?new=1");
  }, [setLocation]);

  return (
    <group
      position={ISLAND_POSITION}
      scale={scale}
      onClick={handleIslandClick}
      onPointerOver={() => {
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "auto";
      }}
    >
      {/* Platform base */}
      <mesh position={[0, 0.15, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[1.2, 1.4, 0.3, 32]} />
        <meshStandardMaterial color={PLATFORM_COLOR} roughness={0.7} />
      </mesh>

      {/* Glow ring */}
      <mesh
        ref={glowRef}
        position={[0, 0.32, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[1.0, 1.35, 48]} />
        <meshStandardMaterial
          transparent
          opacity={0.3}
          emissive={GLOW_COLOR_IDLE}
          emissiveIntensity={0.15}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Mini View (always visible) */}
      {mountOnWall ? (
        <group position={WALL_MOUNT_OFFSET} rotation={WALL_MOUNT_ROTATION}>
          <Html
            transform
            position={[0, 0, 0.002]}
            center
            distanceFactor={5.3}
            style={{ pointerEvents: expanded ? "none" : "auto" }}
          >
            <MissionMiniView
              mission={selectedMission}
              onExpand={handleExpand}
              onCreateMission={handleCreateMission}
              mounted
              compactMounted
            />
          </Html>
        </group>
      ) : (
        <Html
          position={MINI_VIEW_OFFSET}
          center
          distanceFactor={7}
          style={{ pointerEvents: expanded ? "none" : "auto" }}
        >
          <MissionMiniView
            mission={selectedMission}
            onExpand={handleExpand}
            onCreateMission={handleCreateMission}
          />
        </Html>
      )}

      {/* Detail Overlay (visible when expanded) */}
      {expanded && missionDetail && (
        <Html
          fullscreen
          style={{ pointerEvents: "auto" }}
        >
          <MissionDetailOverlay
            detail={missionDetail}
            onClose={handleClose}
            onNavigateToDetail={handleNavigateToDetail}
          />
        </Html>
      )}
    </group>
  );
}
