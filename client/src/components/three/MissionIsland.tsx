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
  getIslandScale,
  selectDisplayMission,
} from "../tasks/mission-island-helpers";

/* ── Constants ── */
const ISLAND_POSITION: [number, number, number] = [0, 0, -2.5];
const MINI_VIEW_OFFSET: [number, number, number] = [0, 2.8, 0];

const GLOW_COLOR_ACTIVE = new THREE.Color("#F59E0B");
const GLOW_COLOR_IDLE = new THREE.Color("#D6C4A8");

/* ── Data Hook ── */
function useMissionIslandData() {
  const tasks = useTasksStore(s => s.tasks);
  const detailsById = useTasksStore(s => s.detailsById);

  const selectedMission = useMemo(() => selectDisplayMission(tasks), [tasks]);

  const missionDetail = selectedMission
    ? (detailsById[selectedMission.id] ?? null)
    : null;

  const isRunning = selectedMission?.status === "running";

  return { selectedMission, missionDetail, isRunning };
}

/* ── Main Component ── */
export function MissionIsland() {
  const { selectedMission, missionDetail, isRunning } = useMissionIslandData();
  const [expanded, setExpanded] = useState(false);
  const [, setLocation] = useLocation();
  const { tier } = useViewportTier();

  const glowRef = useRef<THREE.Mesh>(null);

  const scale = getIslandScale(tier);
  const interactive = tier !== "desktop";

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
      const pulse = 0.22 + Math.sin(clock.elapsedTime * 2.5) * 0.14;
      mat.emissive.copy(GLOW_COLOR_ACTIVE);
      mat.emissiveIntensity = pulse;
      mat.opacity = 0.18 + pulse * 0.2;
    } else {
      mat.emissive.copy(GLOW_COLOR_IDLE);
      mat.emissiveIntensity = 0.08;
      mat.opacity = 0.1;
    }
  });

  const handleIslandClick = useCallback((e: THREE.Event) => {
    (e as unknown as { stopPropagation: () => void }).stopPropagation();
    setExpanded(prev => !prev);
  }, []);

  const handleExpand = useCallback(() => setExpanded(true), []);
  const handleClose = useCallback(() => setExpanded(false), []);

  const handleNavigateToDetail = useCallback(
    (taskId: string) => {
      setExpanded(false);
      setLocation(`/tasks/${taskId}`);
    },
    [setLocation]
  );

  const handleCreateMission = useCallback(() => {
    setLocation("/tasks?new=1");
  }, [setLocation]);

  return (
    <group
      position={ISLAND_POSITION}
      scale={scale}
      onClick={interactive ? handleIslandClick : undefined}
      onPointerOver={
        interactive
          ? () => {
              document.body.style.cursor = "pointer";
            }
          : undefined
      }
      onPointerOut={
        interactive
          ? () => {
              document.body.style.cursor = "auto";
            }
          : undefined
      }
    >
      {/* Floor ring */}
      <mesh
        ref={glowRef}
        position={[0, 0.035, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[0.82, 1.04, 48]} />
        <meshStandardMaterial
          transparent
          opacity={0.1}
          emissive={GLOW_COLOR_IDLE}
          emissiveIntensity={0.08}
          roughness={0.9}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Mini View (always visible) */}
      {interactive ? (
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
      ) : null}

      {/* Detail Overlay (visible when expanded) */}
      {expanded && missionDetail && (
        <Html fullscreen style={{ pointerEvents: "auto" }}>
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
