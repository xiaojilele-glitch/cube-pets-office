import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { useAppStore } from "@/lib/store";
import { useTasksStore } from "@/lib/tasks-store";
import { useWorkflowStore } from "@/lib/workflow-store";
import {
  getSceneStageSignal,
  getSceneZoneLabel,
  SCENE_FLOW_ZONES,
} from "@/lib/scene-stage-flow";

function StageFlowSegment({
  from,
  to,
  color,
  phase,
  opacity,
}: {
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  phase: number;
  opacity: number;
}) {
  const particleRefs = useRef<Array<THREE.Mesh | null>>([]);

  const curve = useMemo(() => {
    const start = new THREE.Vector3(from[0], 0.24, from[2]);
    const end = new THREE.Vector3(to[0], 0.24, to[2]);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const distance = start.distanceTo(end);

    mid.y += Math.max(0.5, distance * 0.12);
    mid.x += (end.z - start.z) * 0.03;
    mid.z += (start.x - end.x) * 0.03;

    return new THREE.QuadraticBezierCurve3(start, mid, end);
  }, [from, to]);

  const points = useMemo(() => curve.getPoints(34), [curve]);

  useFrame(({ clock }) => {
    particleRefs.current.forEach((mesh, index) => {
      if (!mesh) return;
      const t = (clock.elapsedTime * 0.12 + phase + index * 0.26) % 1;
      mesh.position.copy(curve.getPointAt(t));
      mesh.scale.setScalar(
        0.7 + Math.sin(clock.elapsedTime * 5 + index) * 0.08
      );
    });
  });

  return (
    <group>
      <Line
        points={points}
        color={color}
        lineWidth={1.2}
        transparent
        opacity={opacity}
      />
      {[0, 1, 2].map(index => (
        <mesh
          key={index}
          ref={mesh => {
            particleRefs.current[index] = mesh;
          }}
        >
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.7}
            transparent
            opacity={Math.min(0.94, opacity + 0.16)}
          />
        </mesh>
      ))}
    </group>
  );
}

function StageZonePulse({
  position,
  color,
  emphasized,
  label,
}: {
  position: [number, number, number];
  color: string;
  emphasized: boolean;
  label: string;
}) {
  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]}>
        <ringGeometry
          args={[emphasized ? 0.42 : 0.28, emphasized ? 0.62 : 0.4, 40]}
        />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emphasized ? 0.35 : 0.18}
          transparent
          opacity={emphasized ? 0.38 : 0.22}
          side={THREE.DoubleSide}
        />
      </mesh>
      <pointLight
        position={[0, 0.45, 0]}
        intensity={emphasized ? 0.34 : 0.18}
        color={color}
        distance={2.8}
        decay={2}
      />
      {emphasized ? (
        <Html
          position={[0, 0.75, 0]}
          center
          distanceFactor={10}
          style={{ pointerEvents: "none" }}
        >
          <div className="rounded-full border border-white/70 bg-white/92 px-3 py-1 text-[10px] font-semibold text-[#4C3A2A] shadow-[0_8px_22px_rgba(76,58,42,0.16)]">
            {label}
          </div>
        </Html>
      ) : null}
    </group>
  );
}

export function SceneStageFlow() {
  const locale = useAppStore(state => state.locale);
  const tasks = useTasksStore(state => state.tasks);
  const selectedTaskId = useTasksStore(state => state.selectedTaskId);
  const currentWorkflow = useWorkflowStore(state => state.currentWorkflow);

  const signal = useMemo(
    () =>
      getSceneStageSignal({
        locale,
        tasks,
        selectedTaskId,
        currentWorkflow,
      }),
    [locale, tasks, selectedTaskId, currentWorkflow]
  );

  const zoneTrail = useMemo(
    () =>
      signal
        ? signal.zones.map(zoneId => ({
            zoneId,
            zone: SCENE_FLOW_ZONES[zoneId],
          }))
        : [],
    [signal]
  );

  if (!signal || zoneTrail.length < 2) return null;

  const focusZone = zoneTrail[zoneTrail.length - 1];

  return (
    <group>
      {zoneTrail.map(({ zoneId, zone }, index) => (
        <StageZonePulse
          key={zoneId}
          position={zone.floorPosition}
          color={signal.color}
          emphasized={index === zoneTrail.length - 1}
          label={getSceneZoneLabel(zoneId, locale)}
        />
      ))}

      {zoneTrail.slice(0, -1).map((item, index) => (
        <StageFlowSegment
          key={`${item.zoneId}-${zoneTrail[index + 1].zoneId}-${signal.stageKey}`}
          from={item.zone.floorPosition}
          to={zoneTrail[index + 1].zone.floorPosition}
          color={signal.color}
          opacity={0.22 + index * 0.1}
          phase={index * 0.18}
        />
      ))}

      <Html
        position={[focusZone.zone.position[0], 1.4, focusZone.zone.position[2]]}
        center
        distanceFactor={11}
        style={{ pointerEvents: "none" }}
      >
        <div className="min-w-[180px] max-w-[240px] rounded-[24px] border border-white/70 bg-[rgba(255,252,247,0.95)] px-4 py-3 text-center shadow-[0_14px_34px_rgba(78,58,38,0.18)] backdrop-blur-sm">
          <div
            className="text-[11px] font-semibold uppercase tracking-[0.2em]"
            style={{ color: signal.color }}
          >
            {signal.statusLabel}
          </div>
          <div className="mt-2 text-sm font-semibold text-[#3F2F22]">
            {signal.stageLabel}
          </div>
          {signal.summary ? (
            <div className="mt-2 line-clamp-2 text-xs leading-5 text-[#7A6652]">
              {signal.summary}
            </div>
          ) : null}
          {signal.progress !== null ? (
            <div className="mt-3 overflow-hidden rounded-full bg-[#F0E8DC]">
              <div
                className="h-1.5 rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.max(0, Math.min(100, signal.progress))}%`,
                  backgroundColor: signal.color,
                }}
              />
            </div>
          ) : null}
        </div>
      </Html>
    </group>
  );
}
