import { Html, Line, useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useCallback, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import {
  AGENT_VISUAL_CONFIGS,
  DEPARTMENT_COLORS,
  type AgentAnimationType,
  type AgentVisualConfig,
} from '@/lib/agent-config';
import { PET_MODELS } from '@/lib/assets';
import { useAppStore } from '@/lib/store';
import { useWorkflowStore } from '@/lib/workflow-store';

function SpeechBubble({ text, visible, accent }: { text: string; visible: boolean; accent: string }) {
  if (!visible) return null;

  return (
    <Html position={[0, 3.3, 0]} center distanceFactor={7.6} style={{ pointerEvents: 'none' }}>
      <div
        className="min-w-[136px] max-w-[176px] rounded-2xl border bg-white/95 px-2 py-1.5 text-center shadow-lg backdrop-blur-sm animate-in fade-in duration-300"
        style={{ borderColor: `${accent}55` }}
      >
        <p className="whitespace-pre-line break-words text-[11px] leading-5 text-[#3A3A3A]">{text}</p>
        <div className="absolute -bottom-2 left-1/2 h-0 w-0 -translate-x-1/2 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-white/95" />
      </div>
    </Html>
  );
}

function animateWorker(
  group: THREE.Group,
  animationType: AgentAnimationType,
  basePosition: [number, number, number],
  baseRotation: [number, number, number],
  time: number,
  speedBoost: number
) {
  const motion = speedBoost > 1 ? speedBoost : 1;

  switch (animationType) {
    case 'typing':
      group.position.y = basePosition[1] + Math.sin(time * 4 * motion) * 0.015;
      group.rotation.z = Math.sin(time * 2 * motion) * 0.03;
      break;
    case 'reading':
      group.position.y = basePosition[1] + Math.sin(time * 1.5 * motion) * 0.012;
      group.rotation.z = Math.sin(time * 0.8 * motion) * 0.02;
      break;
    case 'organizing': {
      const walkCycle = Math.sin(time * 0.8 * motion);
      group.position.x = basePosition[0] + walkCycle * 0.3;
      group.position.y = basePosition[1] + Math.abs(Math.sin(time * 1.6 * motion)) * 0.07;
      group.rotation.y = walkCycle > 0 ? baseRotation[1] + 0.3 : baseRotation[1] - 0.3;
      group.rotation.z = Math.sin(time * 1.6 * motion) * 0.06;
      break;
    }
    case 'discussing':
      group.rotation.y = baseRotation[1] + Math.sin(time * 1.2 * motion) * 0.25;
      group.position.y = basePosition[1] + Math.abs(Math.sin(time * 3 * motion)) * 0.03;
      break;
    case 'noting':
      group.position.y = basePosition[1] + Math.sin(time * 5 * motion) * 0.01;
      group.rotation.x = baseRotation[0] + Math.sin(time * 2.5 * motion) * 0.05;
      break;
  }
}

function getStatusBubble(status: string, fallback: string): string {
  return (
    {
      analyzing: '正在分析指令...\n先拆清楚重点。',
      planning: '正在规划任务...\n把人放到对的位置。',
      executing: '执行中...\n先把结果做出来。',
      reviewing: '评审中...\n我在逐条看。',
      auditing: '审计中...\n把问题找出来。',
      revising: '修订中...\n这一版会更稳。',
      verifying: '验证中...\n确认是不是真的解决。',
      summarizing: '汇总中...\n准备交付结论。',
      evaluating: '评估中...\n看整体表现。',
      thinking: '思考中...\n让我组织一下。',
    }[status] || fallback
  );
}

const STAGE_FLOW_COLORS: Record<string, string> = {
  direction: '#F59E0B',
  planning: '#F97316',
  execution: '#3B82F6',
  review: '#A855F7',
  meta_audit: '#8B5CF6',
  revision: '#EF4444',
  verify: '#14B8A6',
  summary: '#F59E0B',
  feedback: '#22C55E',
  evolution: '#EAB308',
};

function getFlowAnchor(position: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(position[0], 0.74, position[2]);
}

function MessageFlowPath({
  from,
  to,
  color,
  opacity,
  phase,
}: {
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  opacity: number;
  phase: number;
}) {
  const particleRefs = useRef<Array<THREE.Mesh | null>>([]);

  const curve = useMemo(() => {
    const start = getFlowAnchor(from);
    const end = getFlowAnchor(to);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const distance = start.distanceTo(end);

    mid.y += Math.max(0.72, distance * 0.18);
    mid.x += (end.z - start.z) * 0.04;
    mid.z += (start.x - end.x) * 0.04;

    return new THREE.QuadraticBezierCurve3(start, mid, end);
  }, [from, to]);

  const points = useMemo(() => curve.getPoints(28), [curve]);

  useFrame(({ clock }) => {
    particleRefs.current.forEach((mesh, index) => {
      if (!mesh) return;

      const t = (clock.elapsedTime * 0.18 + phase + index * 0.19) % 1;
      mesh.position.copy(curve.getPointAt(t));

      const pulse = 0.88 + Math.sin(clock.elapsedTime * 6 + index) * 0.12;
      mesh.scale.setScalar(0.84 * pulse);
    });
  });

  return (
    <group>
      <Line points={points} color={color} lineWidth={1.25} transparent opacity={opacity} />

      {[0, 1, 2].map((index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            particleRefs.current[index] = mesh;
          }}
        >
          <sphereGeometry args={[0.065, 16, 16]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.55}
            transparent
            opacity={Math.min(0.95, opacity + 0.18)}
          />
        </mesh>
      ))}
    </group>
  );
}

function AgentWorker({ config }: { config: AgentVisualConfig }) {
  const { scene } = useGLTF(PET_MODELS[config.animal]);
  const cloned = useMemo(() => {
    const next = scene.clone(true);
    const bounds = new THREE.Box3().setFromObject(next);
    const minY = Number.isFinite(bounds.min.y) ? bounds.min.y : 0;
    next.position.y -= minY;

    next.traverse((child) => {
      if (!('isMesh' in child) || !child.isMesh) return;

      const mesh = child as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material || !('envMapIntensity' in material)) continue;
        material.envMapIntensity = 0.05;
      }
    });
    return next;
  }, [scene]);

  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const [showBubble, setShowBubble] = useState(false);

  const selectedPet = useAppStore((state) => state.selectedPet);
  const setSelectedPet = useAppStore((state) => state.setSelectedPet);
  const toggleChat = useAppStore((state) => state.toggleChat);
  const isChatOpen = useAppStore((state) => state.isChatOpen);
  const agentStatuses = useWorkflowStore((state) => state.agentStatuses);

  const agentStatus = agentStatuses[config.id] || 'idle';
  const accent = DEPARTMENT_COLORS[config.department];
  const isActive = hovered || selectedPet === config.id;

  const handleClick = useCallback(() => {
    setSelectedPet(config.id);
    setShowBubble(true);
    if (!isChatOpen) {
      toggleChat();
    }
    window.setTimeout(() => setShowBubble(false), 3500);
  }, [config.id, isChatOpen, setSelectedPet, toggleChat]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;

    groupRef.current.position.set(...config.position);
    groupRef.current.rotation.set(...config.rotation);

    const speedBoost =
      agentStatus === 'executing' || agentStatus === 'revising'
        ? 1.7
        : agentStatus === 'thinking' || agentStatus === 'planning'
          ? 1.25
          : 1;

    animateWorker(
      groupRef.current,
      config.animationType,
      config.position,
      config.rotation,
      clock.elapsedTime,
      speedBoost
    );

    const targetScale =
      isActive
        ? config.scale * 1.14
        : agentStatus !== 'idle'
          ? config.scale * 1.04
          : config.scale;

    const currentScale = groupRef.current.scale.x;
    const nextScale = currentScale + (targetScale - currentScale) * 0.12;
    groupRef.current.scale.setScalar(nextScale);
  });

  return (
    <group
      ref={groupRef}
      position={config.position}
      rotation={config.rotation}
      scale={config.scale}
      onClick={handleClick}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = 'auto';
      }}
    >
      <primitive object={cloned} />

      <Html position={[0, 1.8, 0]} center distanceFactor={7} style={{ pointerEvents: 'none' }}>
        <div
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap shadow-sm transition-all duration-200 ${
            isActive
              ? 'scale-110 text-white'
              : 'bg-white/88 text-[#3A3A3A]'
          }`}
          style={{
            background: isActive ? accent : 'rgba(255,255,255,0.88)',
            borderColor: `${accent}66`,
          }}
        >
          <span>{config.emoji} {config.shortLabel}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[9px] font-bold tracking-[0.08em] ${
              isActive ? 'bg-white/20 text-white' : 'bg-black/6 text-[#6B5A4A]'
            }`}
          >
            {config.title}
          </span>
        </div>
      </Html>

      <SpeechBubble
        text={getStatusBubble(agentStatus, config.idleText)}
        visible={showBubble || selectedPet === config.id || agentStatus !== 'idle'}
        accent={accent}
      />

      {agentStatus !== 'idle' && (
        <pointLight
          position={[0, 1.3, 0]}
          intensity={0.42}
          color={
            agentStatus === 'executing'
              ? '#3B82F6'
              : agentStatus === 'reviewing'
                ? '#A855F7'
                : agentStatus === 'auditing'
                  ? '#F97316'
                  : accent
          }
          distance={2.6}
          decay={2}
        />
      )}

      {(hovered || selectedPet === config.id) && (
        <pointLight
          position={[0, 0.6, 0]}
          intensity={0.32}
          color={accent}
          distance={2}
          decay={2}
        />
      )}
    </group>
  );
}

function DepartmentMarker({
  label,
  position,
  color,
}: {
  label: string;
  position: [number, number, number];
  color: string;
}) {
  return (
    <group position={position}>
      <Html center position={[0, 0.18, 0]} distanceFactor={10} style={{ pointerEvents: 'none' }}>
        <div
          className="rounded-full px-3 py-1 text-[10px] font-semibold text-white shadow-md"
          style={{ background: `${color}CC` }}
        >
          {label}
        </div>
      </Html>
    </group>
  );
}

export function PetWorkers() {
  const agents = useWorkflowStore((state) => state.agents);
  const currentWorkflow = useWorkflowStore((state) => state.currentWorkflow);
  const messages = useWorkflowStore((state) => state.messages);

  const configs = useMemo(() => {
    if (agents.length === 0) return AGENT_VISUAL_CONFIGS;

    return AGENT_VISUAL_CONFIGS.map((config) => {
      const liveAgent = agents.find((agent) => agent.id === config.id);
      return liveAgent
        ? {
            ...config,
            name: liveAgent.name || config.name,
            shortLabel: liveAgent.name || config.shortLabel,
          }
        : config;
    });
  }, [agents]);

  const configMap = useMemo(
    () => Object.fromEntries(configs.map((config) => [config.id, config])) as Record<string, AgentVisualConfig>,
    [configs]
  );

  const flowRoutes = useMemo(() => {
    const recentMessages = messages
      .filter((message) => configMap[message.from_agent] && configMap[message.to_agent])
      .slice(-8);

    if (recentMessages.length > 0) {
      return recentMessages.map((message, index) => ({
        key: `${message.id}-${message.from_agent}-${message.to_agent}`,
        from: configMap[message.from_agent].position,
        to: configMap[message.to_agent].position,
        color:
          STAGE_FLOW_COLORS[message.stage] || DEPARTMENT_COLORS[configMap[message.to_agent].department],
        opacity: 0.16 + ((index + 1) / recentMessages.length) * 0.36,
        phase: index * 0.11,
      }));
    }

    if (!currentWorkflow?.current_stage) return [];

    const involvedDepartments =
      currentWorkflow.departments_involved?.length > 0
        ? currentWorkflow.departments_involved
        : ['game', 'ai', 'life', 'meta'];

    const managers = configs.filter(
      (config) => config.role === 'manager' && involvedDepartments.includes(config.department)
    );
    const workers = configs.filter(
      (config) => config.role === 'worker' && involvedDepartments.includes(config.department)
    );

    const makeRoute = (fromId: string, toId: string, index: number) => ({
      key: `${currentWorkflow.current_stage}-${fromId}-${toId}-${index}`,
      from: configMap[fromId]?.position,
      to: configMap[toId]?.position,
      color:
        STAGE_FLOW_COLORS[currentWorkflow.current_stage || ''] ||
        DEPARTMENT_COLORS[configMap[toId]?.department || 'meta'],
      opacity: 0.26,
      phase: index * 0.13,
    });

    const routes =
      currentWorkflow.current_stage === 'direction' || currentWorkflow.current_stage === 'feedback'
        ? managers.map((manager, index) => makeRoute('ceo', manager.id, index))
        : currentWorkflow.current_stage === 'summary'
          ? managers.map((manager, index) => makeRoute(manager.id, 'ceo', index))
          : currentWorkflow.current_stage === 'meta_audit'
            ? managers.flatMap((manager, index) => [
                makeRoute('warden', manager.id, index * 2),
                makeRoute('prism', manager.id, index * 2 + 1),
              ])
            : managers.flatMap((manager, index) =>
                workers
                  .filter((worker) => worker.department === manager.department)
                  .map((worker, workerIndex) =>
                    makeRoute(manager.id, worker.id, index * 8 + workerIndex)
                  )
              );

    return routes.filter(
      (route): route is {
        key: string;
        from: [number, number, number];
        to: [number, number, number];
        color: string;
        opacity: number;
        phase: number;
      } => Boolean(route.from && route.to)
    );
  }, [configMap, configs, currentWorkflow, messages]);

  return (
    <group>
      {flowRoutes.map((route) => (
        <MessageFlowPath
          key={route.key}
          from={route.from}
          to={route.to}
          color={route.color}
          opacity={route.opacity}
          phase={route.phase}
        />
      ))}

      <DepartmentMarker label="CEO" position={[0, 0, -2.45]} color="#7C3AED" />
      <DepartmentMarker label="GAME" position={[-3.25, 0, -1.7]} color={DEPARTMENT_COLORS.game} />
      <DepartmentMarker label="AI" position={[3.2, 0, -1.7]} color={DEPARTMENT_COLORS.ai} />
      <DepartmentMarker label="LIFE" position={[-2.8, 0, 2.2]} color={DEPARTMENT_COLORS.life} />
      <DepartmentMarker label="META" position={[2.9, 0, 2.2]} color={DEPARTMENT_COLORS.meta} />

      {configs.map((config) => (
        <AgentWorker key={config.id} config={config} />
      ))}
    </group>
  );
}

Object.values(PET_MODELS).forEach((url) => {
  useGLTF.preload(url);
});
