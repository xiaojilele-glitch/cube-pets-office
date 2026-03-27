import { Html, useGLTF } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { useI18n } from '@/i18n';
import { FURNITURE_MODELS } from '@/lib/assets';
import { useAppStore } from '@/lib/store';
import type { WorkflowOrganizationSnapshot } from '@/lib/workflow-store';
import { useWorkflowStore } from '@/lib/workflow-store';

type SceneDepartmentInfo = {
  id: string;
  title: string;
  subtitle: string;
  zoneLabel: string;
  color: string;
};

const SCENE_DEPARTMENT_COLORS = ['#D97706', '#2563EB', '#059669', '#7C3AED'];

function getPodLabel(index: number, locale: 'zh-CN' | 'en-US') {
  const suffix = String.fromCharCode(65 + index);
  return locale === 'zh-CN' ? `临时战区 ${suffix}` : `Pod ${suffix}`;
}

function getScenePodTitle(index: number, locale: 'zh-CN' | 'en-US') {
  const suffix = String.fromCharCode(65 + index);
  return locale === 'zh-CN' ? `战区 ${suffix}` : `Pod ${suffix}`;
}

function getFallbackPodSubtitle(index: number, locale: 'zh-CN' | 'en-US') {
  const zhSubtitles = ['策略集结单元', '能力装配单元', '协作推进单元', '复核汇总单元'];
  const enSubtitles = ['Strategy Rally Cell', 'Capability Assembly Cell', 'Execution Push Cell', 'Review Wrap-up Cell'];
  return locale === 'zh-CN' ? zhSubtitles[index] || '动态编组' : enSubtitles[index] || 'Dynamic Team';
}

function getWorkflowOrganization(
  workflow: ReturnType<typeof useWorkflowStore.getState>['currentWorkflow']
): WorkflowOrganizationSnapshot | null {
  const organization = workflow?.results?.organization;
  if (!organization || typeof organization !== 'object') return null;
  return Array.isArray((organization as WorkflowOrganizationSnapshot).nodes)
    ? (organization as WorkflowOrganizationSnapshot)
    : null;
}

function toShortLabel(value: string, fallback: string) {
  const text = (value || fallback).trim();
  return text.length > 12 ? `${text.slice(0, 12)}…` : text;
}

function FurnitureModel({
  url,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  centerXZ = false,
}: {
  url: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  centerXZ?: boolean;
}) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => {
    const next = scene.clone(true);
    const bounds = new THREE.Box3().setFromObject(next);
    const minY = Number.isFinite(bounds.min.y) ? bounds.min.y : 0;
    const center = bounds.getCenter(new THREE.Vector3());

    next.position.y -= minY;
    if (centerXZ) {
      next.position.x -= center.x;
      next.position.z -= center.z;
    }

    next.traverse((child) => {
      if (!('isMesh' in child) || !child.isMesh) return;

      const mesh = child as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material || !('envMapIntensity' in material)) continue;

        material.envMapIntensity = 0.05;
        if ('roughness' in material && typeof material.roughness === 'number') {
          material.roughness = Math.min(1, Math.max(material.roughness, 0.76));
        }
      }
    });
    return next;
  }, [centerXZ, scene]);

  return <primitive object={cloned} position={position} rotation={rotation} scale={scale} />;
}

function Floor() {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[18, 14]} />
        <meshStandardMaterial color="#CBB596" roughness={0.9} metalness={0} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} receiveShadow>
        <planeGeometry args={[14.8, 10.6]} />
        <meshStandardMaterial color="#D8C2A5" roughness={0.94} metalness={0} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} receiveShadow>
        <planeGeometry args={[11.8, 7.8]} />
        <meshStandardMaterial color="#E4D2BA" roughness={0.98} metalness={0} transparent opacity={0.62} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, -4.42]} receiveShadow>
        <planeGeometry args={[15.1, 0.85]} />
        <meshStandardMaterial color="#8C765F" transparent opacity={0.14} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, Math.PI / 2, 0]} position={[-7.38, 0.006, 0]} receiveShadow>
        <planeGeometry args={[9.6, 0.78]} />
        <meshStandardMaterial color="#8C765F" transparent opacity={0.1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, -Math.PI / 2, 0]} position={[7.38, 0.006, 0]} receiveShadow>
        <planeGeometry args={[9.6, 0.78]} />
        <meshStandardMaterial color="#8C765F" transparent opacity={0.08} />
      </mesh>

      {[
        [-5.8, 0.01, -4.15],
        [-1.9, 0.01, -4.15],
        [1.9, 0.01, -4.15],
        [5.8, 0.01, -4.15],
      ].map((position, index) => (
        <FurnitureModel key={`floor-back-${index}`} url={FURNITURE_MODELS.floorFull} position={position as [number, number, number]} scale={1.02} />
      ))}

      {[
        [-6.95, 0.01, -2.05, Math.PI / 2],
        [-6.95, 0.01, 1.75, Math.PI / 2],
        [6.95, 0.01, -2.05, -Math.PI / 2],
        [6.95, 0.01, 1.75, -Math.PI / 2],
      ].map(([x, y, z, ry], index) => (
        <FurnitureModel
          key={`floor-side-${index}`}
          url={FURNITURE_MODELS.floorHalf}
          position={[x, y, z]}
          rotation={[0, ry, 0]}
          scale={1.02}
        />
      ))}

      <FurnitureModel url={FURNITURE_MODELS.floorCornerRound} position={[-6.95, 0.01, -4.15]} rotation={[0, Math.PI / 2, 0]} scale={1.05} />
      <FurnitureModel url={FURNITURE_MODELS.floorCornerRound} position={[6.95, 0.01, -4.15]} rotation={[0, Math.PI, 0]} scale={1.05} />
    </>
  );
}

function Walls() {
  return (
    <group>
      <mesh position={[0, 1.5, -4.9]} receiveShadow>
        <boxGeometry args={[15.42, 3, 0.18]} />
        <meshStandardMaterial color="#D8C8B7" roughness={0.98} />
      </mesh>
      <mesh position={[-7.8, 1.5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <boxGeometry args={[9.98, 3, 0.18]} />
        <meshStandardMaterial color="#D2C2B2" roughness={0.98} />
      </mesh>
      <mesh position={[7.8, 1.5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <boxGeometry args={[9.98, 3, 0.18]} />
        <meshStandardMaterial color="#D2C2B2" roughness={0.98} />
      </mesh>

      <mesh position={[0, 0.42, -4.79]} receiveShadow>
        <boxGeometry args={[15.2, 0.56, 0.05]} />
        <meshStandardMaterial color="#B39C83" roughness={1} transparent opacity={0.72} />
      </mesh>
      <mesh position={[-7.7, 0.42, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <boxGeometry args={[9.6, 0.56, 0.05]} />
        <meshStandardMaterial color="#AE9881" roughness={1} transparent opacity={0.64} />
      </mesh>
      <mesh position={[7.7, 0.42, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <boxGeometry args={[9.6, 0.56, 0.05]} />
        <meshStandardMaterial color="#AE9881" roughness={1} transparent opacity={0.64} />
      </mesh>

      {[-5.1, 0, 5.1].map((x, index) => (
        <FurnitureModel
          key={`paneling-${index}`}
          url={FURNITURE_MODELS.paneling}
          position={[x, 0, -4.78]}
          scale={1.25}
        />
      ))}

      <FurnitureModel url={FURNITURE_MODELS.wallCorner} position={[-7.72, 0, -4.82]} rotation={[0, Math.PI / 2, 0]} scale={1.08} />
      <FurnitureModel url={FURNITURE_MODELS.wallCornerRond} position={[7.72, 0, -4.82]} rotation={[0, Math.PI, 0]} scale={1.08} />

      <FurnitureModel url={FURNITURE_MODELS.wallHalf} position={[-4.7, 0, -4.78]} scale={1.02} />
      <FurnitureModel url={FURNITURE_MODELS.wallHalf} position={[4.7, 0, -4.78]} scale={1.02} />

    </group>
  );
}

function WindowStrip() {
  return (
    <group position={[-7.65, 1.68, -1.2]}>
      {[-2.6, 0, 2.6].map((offset) => (
        <group key={offset} position={[0, 0, offset]}>
          <mesh rotation={[0, Math.PI / 2, 0]}>
            <boxGeometry args={[2.1, 1.55, 0.08]} />
            <meshStandardMaterial color="#D9CDBC" roughness={0.7} />
          </mesh>
          <mesh rotation={[0, Math.PI / 2, 0]} position={[-0.05, 0, 0]}>
            <boxGeometry args={[2.02, 1.46, 0.03]} />
            <meshStandardMaterial color="#EEE2D2" roughness={0.78} />
          </mesh>
          <mesh rotation={[0, Math.PI / 2, 0]} position={[-0.08, 0, 0]}>
            <planeGeometry args={[1.9, 1.36]} />
            <meshBasicMaterial color="#F4F9FF" transparent opacity={0.24} />
          </mesh>
          <mesh rotation={[0, Math.PI / 2, 0]} position={[0.02, 0, 0]}>
            <planeGeometry args={[1.86, 1.32]} />
            <meshStandardMaterial
              color="#B6DBF8"
              transparent
              opacity={0.12}
              roughness={0.18}
              metalness={0.02}
            />
          </mesh>
        </group>
      ))}

      <pointLight position={[0.65, 0.7, 0]} intensity={0.52} color="#FFF1D4" distance={9.5} decay={1.8} />
    </group>
  );
}

function ArchitecturalAccents() {
  return (
    <group>
      <FurnitureModel
        url={FURNITURE_MODELS.wallDoorwayWide}
        position={[7.65, 0, -2.9]}
        rotation={[0, -Math.PI / 2, 0]}
        scale={1.06}
      />

      <FurnitureModel
        url={FURNITURE_MODELS.coatRackStanding}
        position={[6.55, 0, -1.35]}
        rotation={[0, -Math.PI / 3, 0]}
      />

      <FurnitureModel
        url={FURNITURE_MODELS.lampRoundFloor}
        position={[-6.3, 0, 0.6]}
        rotation={[0, Math.PI / 6, 0]}
      />

      <pointLight position={[-6.15, 1.85, 0.65]} intensity={0.42} color="#FFE2B8" distance={4.6} decay={2} />

      <FurnitureModel
        url={FURNITURE_MODELS.lampWall}
        position={[-1.9, 1.08, -4.72]}
        scale={1.05}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.lampWall}
        position={[1.9, 1.08, -4.72]}
        scale={1.05}
      />
      <pointLight position={[-1.9, 1.22, -4.4]} intensity={0.22} color="#FFDDB0" distance={3.2} decay={2} />
      <pointLight position={[1.9, 1.22, -4.4]} intensity={0.22} color="#FFDDB0" distance={3.2} decay={2} />
    </group>
  );
}

function CorkBoard() {
  return (
    <group position={[0, 2.02, -4.72]}>
      <mesh>
        <boxGeometry args={[3.4, 1.45, 0.06]} />
        <meshStandardMaterial color="#C4956A" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0, 0.03]}>
        <boxGeometry args={[3.55, 1.58, 0.03]} />
        <meshStandardMaterial color="#8B6914" roughness={0.7} />
      </mesh>
      {[
        { pos: [-1.0, 0.2, 0.05] as [number, number, number], color: '#FFE4B5', rot: 0.04 },
        { pos: [-0.2, -0.22, 0.05] as [number, number, number], color: '#E8F5E9', rot: -0.1 },
        { pos: [0.7, 0.1, 0.05] as [number, number, number], color: '#FFF3E0', rot: 0.08 },
        { pos: [1.15, -0.15, 0.05] as [number, number, number], color: '#E3F2FD', rot: -0.04 },
      ].map((note, index) => (
        <mesh key={index} position={note.pos} rotation={[0, 0, note.rot]}>
          <planeGeometry args={[0.62, 0.45]} />
          <meshStandardMaterial color={note.color} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function WallBrandPlaque() {
  const { copy } = useI18n();

  return (
    <group position={[0, 3.42, -4.2]}>
      <Html center transform position={[0, 0, 0]} distanceFactor={8.4} style={{ pointerEvents: 'none' }}>
        <div
          className="whitespace-nowrap text-center text-[26px] font-bold leading-none tracking-[-0.03em] text-[#8B765F]"
          style={{
            fontFamily: "'Playfair Display', serif",
            textShadow: '0 3px 14px rgba(255,248,238,0.38)',
          }}
        >
          {copy.scene.brand}
        </div>
      </Html>
    </group>
  );
}

function ZoneBase({
  position,
  color,
}: {
  position: [number, number, number];
  color: string;
}) {
  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <planeGeometry args={[4.2, 3.3]} />
        <meshStandardMaterial color={color} transparent opacity={0.13} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, -1.46]}>
        <planeGeometry args={[1.48, 0.1]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.12} transparent opacity={0.28} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.021, -1.46]}>
        <planeGeometry args={[0.92, 0.04]} />
        <meshStandardMaterial color="#FFF8ED" transparent opacity={0.42} />
      </mesh>
    </group>
  );
}

function ZoneBanner({
  position,
  rotation = [0, 0, 0],
  color,
  title,
  subtitle,
  wallMounted = false,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  color: string;
  title: string;
  subtitle: string;
  wallMounted?: boolean;
}) {
  const panelDepth = wallMounted ? 0.04 : 0.08;
  const accentDepth = wallMounted ? 0.014 : 0.02;
  const badgeDepth = wallMounted ? 0.028 : 0.04;
  const htmlZ = wallMounted ? 0.045 : 0.07;

  return (
    <group position={position} rotation={rotation}>
      {wallMounted && (
        <>
          <mesh position={[0, 0, -0.016]}>
            <boxGeometry args={[1.68, 1.02, 0.015]} />
            <meshStandardMaterial color="#8E765E" roughness={0.94} />
          </mesh>
          <mesh position={[0, 0.56, -0.012]}>
            <boxGeometry args={[0.76, 0.06, 0.01]} />
            <meshStandardMaterial color="#A98C71" roughness={0.88} />
          </mesh>
          {[-0.3, 0.3].map((x) => (
            <mesh key={x} position={[x, 0.56, -0.002]}>
              <cylinderGeometry args={[0.02, 0.02, 0.018, 16]} />
              <meshStandardMaterial color="#D9C4A4" metalness={0.12} roughness={0.42} />
            </mesh>
          ))}
        </>
      )}

      <mesh>
        <boxGeometry args={[1.74, 0.84, panelDepth]} />
        <meshStandardMaterial color="#F4E9DB" roughness={0.92} />
      </mesh>
      <mesh position={[0, 0.28, panelDepth / 2 + accentDepth / 2]}>
        <boxGeometry args={[1.74, 0.14, accentDepth]} />
        <meshStandardMaterial color={color} roughness={0.65} />
      </mesh>
      <mesh position={[-0.64, 0.28, panelDepth / 2 + badgeDepth / 2 + 0.002]}>
        <cylinderGeometry args={[0.045, 0.045, badgeDepth, 20]} />
        <meshStandardMaterial color="#FFF7EA" emissive={color} emissiveIntensity={0.26} />
      </mesh>
      <Html center position={[0, -0.02, htmlZ + 0.01]} distanceFactor={13} style={{ pointerEvents: 'none' }}>
        <div className="w-[152px] rounded-2xl border border-white/70 bg-white/92 px-3 py-2 text-center shadow-[0_10px_24px_rgba(74,54,34,0.16)] backdrop-blur-md">
          <div className="whitespace-nowrap text-[12px] font-bold tracking-[0.08em] text-[#3F3124]">{title}</div>
          <div className="mt-1 truncate text-[9px] font-medium tracking-[0.04em] text-[#8F7A66]">{subtitle}</div>
        </div>
      </Html>
    </group>
  );
}

const POD_SLOTS = [
  {
    bannerPosition: [-6.92, 1.76, -1.75] as [number, number, number],
    bannerRotation: [0, Math.PI / 2, 0] as [number, number, number],
    floorPosition: [-3.45, 0.03, -1.78] as [number, number, number],
    decorPosition: [-5.15, 0, -1.95] as [number, number, number],
    glassPosition: [-4.52, 1.02, -1.02] as [number, number, number],
    storagePosition: [-4.92, 0, -2.9] as [number, number, number],
    storageRotation: [0, 0, 0] as [number, number, number],
  },
  {
    bannerPosition: [6.92, 1.76, -1.7] as [number, number, number],
    bannerRotation: [0, -Math.PI / 2, 0] as [number, number, number],
    floorPosition: [3.35, 0.03, -1.72] as [number, number, number],
    decorPosition: [5.3, 0, -1.8] as [number, number, number],
    glassPosition: [4.9, 1.06, -0.98] as [number, number, number],
    storagePosition: [5.92, 0, -2.78] as [number, number, number],
    storageRotation: [0, 0, 0] as [number, number, number],
  },
  {
    bannerPosition: [-6.92, 1.76, 2.65] as [number, number, number],
    bannerRotation: [0, Math.PI / 2, 0] as [number, number, number],
    floorPosition: [-3.08, 0.03, 2.45] as [number, number, number],
    decorPosition: [-5.08, 0, 2.68] as [number, number, number],
    glassPosition: [-4.48, 1.02, 2.96] as [number, number, number],
    storagePosition: [-4.92, 0, 3.02] as [number, number, number],
    storageRotation: [0, 0, 0] as [number, number, number],
  },
  {
    bannerPosition: [6.92, 1.76, 2.55] as [number, number, number],
    bannerRotation: [0, -Math.PI / 2, 0] as [number, number, number],
    floorPosition: [3.25, 0.03, 2.45] as [number, number, number],
    decorPosition: [5.25, 0, 2.58] as [number, number, number],
    glassPosition: [4.86, 1.04, 2.04] as [number, number, number],
    storagePosition: [5.94, 0, 1.55] as [number, number, number],
    storageRotation: [0, -Math.PI / 2, 0] as [number, number, number],
  },
];

function PodDecor({
  slotIndex,
  title,
  subtitle,
  color,
}: SceneDepartmentInfo & { slotIndex: number }) {
  const slot = POD_SLOTS[slotIndex];
  if (!slot) return null;

  const ringRadius = 1.04 + slotIndex * 0.05;
  const cardColors = ['#F7E7D2', '#E8F1FA', '#E6F3EA', '#EEE4F8'];

  return (
    <group>
      <ZoneBanner
        position={slot.bannerPosition}
        rotation={slot.bannerRotation}
        color={color}
        title={title}
        subtitle={subtitle}
        wallMounted
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={slot.floorPosition}>
        <torusGeometry args={[ringRadius, 0.055, 16, 64]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.14} transparent opacity={0.78} />
      </mesh>

      <group position={slot.decorPosition}>
        <mesh position={[0, 0.11, 0]}>
          <boxGeometry args={[0.58, 0.16, 0.44]} />
          <meshStandardMaterial color="#8E775F" roughness={0.82} />
        </mesh>
        {[-0.14, 0.02, 0.18].map((x, index) => (
          <mesh key={index} position={[x, 0.26 + index * 0.05, -0.06 + index * 0.06]}>
            <boxGeometry args={[0.26, 0.04, 0.18]} />
            <meshStandardMaterial
              color={cardColors[(slotIndex + index) % cardColors.length]}
              roughness={0.72}
            />
          </mesh>
        ))}
        <mesh position={[0.24, 0.28, -0.04]}>
          <cylinderGeometry args={[0.055, 0.055, 0.1, 18]} />
          <meshStandardMaterial color="#FFF3DB" emissive={color} emissiveIntensity={0.18} roughness={0.42} />
        </mesh>
      </group>

      <group position={slot.glassPosition} rotation={[0, slotIndex % 2 === 0 ? Math.PI / 16 : -Math.PI / 16, 0]}>
        <mesh>
          <boxGeometry args={[0.92, 0.68, 0.05]} />
          <meshStandardMaterial color="#EDF4FB" transparent opacity={0.28} metalness={0.12} roughness={0.25} />
        </mesh>
        {[-0.2, 0, 0.2].map((y) => (
          <mesh key={y} position={[0, y, 0.03]}>
            <boxGeometry args={[0.58, 0.02, 0.02]} />
            <meshStandardMaterial color="#FFFFFF" emissive={color} emissiveIntensity={0.38} />
          </mesh>
        ))}
      </group>

      <FurnitureModel
        url={slotIndex >= 2 ? FURNITURE_MODELS.bookcaseOpenLow : FURNITURE_MODELS.sideTable}
        position={slot.storagePosition}
        rotation={slot.storageRotation}
        scale={slotIndex >= 2 ? 0.92 : 0.88}
        centerXZ
      />
      <FurnitureModel
        url={FURNITURE_MODELS.books}
        position={[slot.storagePosition[0], slot.storagePosition[1] + (slotIndex >= 2 ? 0.48 : 0.34), slot.storagePosition[2]]}
        rotation={slot.storageRotation}
        scale={slotIndex >= 2 ? 0.68 : 0.74}
        centerXZ
      />
    </group>
  );
}

function DepartmentDecor({ departments }: { departments: SceneDepartmentInfo[] }) {
  const slots = departments.slice(0, 4);
  return (
    <group>
      {slots.map((department, index) => (
        <PodDecor key={department.id} slotIndex={index} {...department} />
      ))}
    </group>
  );
}

function DesktopDesk({
  position,
  rotation = [0, 0, 0],
  compact = false,
  withLamp = false,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  compact?: boolean;
  withLamp?: boolean;
}) {
  const chairOffsetZ = compact ? 0.72 : 0.82;
  const screenOffsetZ = compact ? 0.02 : -0.02;
  const keyboardOffsetZ = compact ? 0.24 : 0.2;
  // The normalized Kenney desk top sits at roughly y=0.384.
  const desktopSurfaceY = 0.392;

  return (
    <group position={position} rotation={rotation}>
      <FurnitureModel url={FURNITURE_MODELS.desk} centerXZ />
      <FurnitureModel url={FURNITURE_MODELS.chairDesk} position={[0, 0, chairOffsetZ]} rotation={[0, Math.PI, 0]} centerXZ />
      <FurnitureModel url={FURNITURE_MODELS.computerScreen} position={[0, desktopSurfaceY, screenOffsetZ]} centerXZ />
      <FurnitureModel url={FURNITURE_MODELS.computerKeyboard} position={[0, desktopSurfaceY, keyboardOffsetZ]} centerXZ />
      <FurnitureModel url={FURNITURE_MODELS.computerMouse} position={[0.22, desktopSurfaceY, keyboardOffsetZ]} centerXZ />
      {withLamp && <FurnitureModel url={FURNITURE_MODELS.lampRoundTable} position={[-0.24, desktopSurfaceY, 0.04]} centerXZ />}
    </group>
  );
}

function LaptopDesk({
  position,
  rotation = [0, 0, 0],
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  const desktopSurfaceY = 0.392;

  return (
    <group position={position} rotation={rotation}>
      <FurnitureModel url={FURNITURE_MODELS.desk} centerXZ />
      <FurnitureModel url={FURNITURE_MODELS.chairDesk} position={[0, 0, 0.82]} rotation={[0, Math.PI, 0]} centerXZ />
      <FurnitureModel url={FURNITURE_MODELS.laptop} position={[0, desktopSurfaceY, 0.08]} centerXZ />
      <FurnitureModel url={FURNITURE_MODELS.lampRoundTable} position={[0.24, desktopSurfaceY, 0.04]} centerXZ />
    </group>
  );
}

function MeetingSet({
  position,
  rotation = [0, 0, 0],
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  return (
    <group position={position} rotation={rotation}>
      <FurnitureModel url={FURNITURE_MODELS.tableRound} />
      <FurnitureModel url={FURNITURE_MODELS.chairRounded} position={[0.95, 0, 0]} rotation={[0, -Math.PI / 2, 0]} />
      <FurnitureModel url={FURNITURE_MODELS.chairRounded} position={[-0.95, 0, 0]} rotation={[0, Math.PI / 2, 0]} />
      <FurnitureModel url={FURNITURE_MODELS.chairRounded} position={[0, 0, 0.95]} rotation={[0, Math.PI, 0]} />
    </group>
  );
}

function LoungeArea({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <FurnitureModel url={FURNITURE_MODELS.loungeSofaLong} rotation={[0, Math.PI, 0]} />
      <FurnitureModel url={FURNITURE_MODELS.loungeChair} position={[1.6, 0, 0.15]} rotation={[0, -Math.PI / 2, 0]} />
      <FurnitureModel url={FURNITURE_MODELS.tableCoffeeSquare} position={[0.8, 0, 1.2]} />
      <FurnitureModel url={FURNITURE_MODELS.sideTable} position={[-1.45, 0, 0.3]} />
      <FurnitureModel url={FURNITURE_MODELS.lampRoundTable} position={[-1.45, 0.7, 0.3]} />
    </group>
  );
}

function StorageColumn({
  position,
  rotation = [0, 0, 0],
  low = false,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  low?: boolean;
}) {
  return (
    <group position={position} rotation={rotation}>
      <FurnitureModel url={low ? FURNITURE_MODELS.bookcaseOpenLow : FURNITURE_MODELS.bookcaseOpen} />
      <FurnitureModel url={FURNITURE_MODELS.books} position={[0, low ? 0.5 : 0.55, 0]} />
      {!low && <FurnitureModel url={FURNITURE_MODELS.books} position={[0, 1.05, 0]} />}
    </group>
  );
}

function MobileBoard({
  position,
  rotation = [0, 0, 0],
  color,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  color: string;
}) {
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 1.02, 0]}>
        <boxGeometry args={[1.18, 0.88, 0.05]} />
        <meshStandardMaterial color="#F9F7F2" roughness={0.92} />
      </mesh>
      <mesh position={[0, 1.48, 0.012]}>
        <boxGeometry args={[1.18, 0.08, 0.04]} />
        <meshStandardMaterial color={color} roughness={0.56} />
      </mesh>
      <mesh position={[-0.48, 0.58, 0]}>
        <boxGeometry args={[0.06, 1.12, 0.06]} />
        <meshStandardMaterial color="#8C765F" roughness={0.84} />
      </mesh>
      <mesh position={[0.48, 0.58, 0]}>
        <boxGeometry args={[0.06, 1.12, 0.06]} />
        <meshStandardMaterial color="#8C765F" roughness={0.84} />
      </mesh>
      <mesh position={[0, 0.06, 0]}>
        <boxGeometry args={[0.94, 0.05, 0.34]} />
        <meshStandardMaterial color="#90755B" roughness={0.86} />
      </mesh>
      {[-0.36, 0.36].flatMap((x) => [-0.12, 0.12].map((z) => ({ x, z }))).map(({ x, z }) => (
        <mesh key={`${x}-${z}`} position={[x, 0.02, z]}>
          <cylinderGeometry args={[0.045, 0.045, 0.04, 18]} />
          <meshStandardMaterial color="#625246" roughness={0.6} metalness={0.12} />
        </mesh>
      ))}
      {[
        { position: [-0.22, 1.08, 0.03] as [number, number, number], noteColor: '#FDE68A', rotationZ: -0.08 },
        { position: [0.08, 0.98, 0.03] as [number, number, number], noteColor: '#BFDBFE', rotationZ: 0.05 },
        { position: [0.24, 1.18, 0.03] as [number, number, number], noteColor: '#FBCFE8', rotationZ: -0.04 },
      ].map((note, index) => (
        <mesh key={index} position={note.position} rotation={[0, 0, note.rotationZ]}>
          <planeGeometry args={[0.18, 0.13]} />
          <meshStandardMaterial color={note.noteColor} roughness={0.88} />
        </mesh>
      ))}
    </group>
  );
}

function TaskCart({
  position,
  rotation = [0, 0, 0],
  color,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  color: string;
}) {
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[0.68, 0.08, 0.46]} />
        <meshStandardMaterial color="#8F755D" roughness={0.82} />
      </mesh>
      <mesh position={[0, 0.74, 0]}>
        <boxGeometry args={[0.68, 0.08, 0.46]} />
        <meshStandardMaterial color="#9B8268" roughness={0.8} />
      </mesh>
      {[-0.26, 0.26].flatMap((x) => [-0.16, 0.16].map((z) => ({ x, z }))).map(({ x, z }) => (
        <mesh key={`${x}-${z}`} position={[x, 0.38, z]}>
          <boxGeometry args={[0.04, 0.74, 0.04]} />
          <meshStandardMaterial color="#6F5B48" roughness={0.86} />
        </mesh>
      ))}
      <mesh position={[0.05, 0.82, 0.04]}>
        <boxGeometry args={[0.28, 0.12, 0.18]} />
        <meshStandardMaterial color={color} roughness={0.66} />
      </mesh>
      <mesh position={[-0.17, 0.82, -0.06]}>
        <boxGeometry args={[0.12, 0.18, 0.12]} />
        <meshStandardMaterial color="#FFF5E2" roughness={0.52} />
      </mesh>
      <FurnitureModel url={FURNITURE_MODELS.books} position={[-0.03, 0.41, 0]} scale={0.48} centerXZ />
      {[-0.22, 0.22].flatMap((x) => [-0.12, 0.12].map((z) => ({ x, z }))).map(({ x, z }) => (
        <mesh key={`wheel-${x}-${z}`} position={[x, 0.02, z]}>
          <cylinderGeometry args={[0.038, 0.038, 0.032, 18]} />
          <meshStandardMaterial color="#56483D" roughness={0.56} metalness={0.12} />
        </mesh>
      ))}
    </group>
  );
}

function DecorativePlants() {
  return (
    <group>
      <FurnitureModel url={FURNITURE_MODELS.pottedPlant} position={[-6.2, 0, 3.6]} scale={1.15} />
      <FurnitureModel url={FURNITURE_MODELS.pottedPlant} position={[6.25, 0, 3.4]} scale={1.15} />
      <FurnitureModel url={FURNITURE_MODELS.plantSmall1} position={[-6.6, 0, -4.0]} scale={1.2} />
      <FurnitureModel url={FURNITURE_MODELS.plantSmall1} position={[6.55, 0, -4.0]} scale={1.2} />
      <FurnitureModel url={FURNITURE_MODELS.plantSmall2} position={[-7.0, 0, 4.45]} scale={1.1} />
      <FurnitureModel url={FURNITURE_MODELS.plantSmall3} position={[7.0, 0, 4.45]} scale={1.1} />
    </group>
  );
}

export function OfficeRoom() {
  const setSceneReady = useAppStore((state) => state.setSceneReady);
  const setLoadingProgress = useAppStore((state) => state.setLoadingProgress);
  const { copy } = useI18n();
  const currentWorkflow = useWorkflowStore((state) => state.currentWorkflow);
  const locale = useAppStore((state) => state.locale);
  const organization = useMemo(() => getWorkflowOrganization(currentWorkflow), [currentWorkflow]);
  const sceneDepartments = useMemo<SceneDepartmentInfo[]>(() => {
    if (organization) {
      return organization.departments.slice(0, 4).map((department, index) => {
        const manager =
          organization.nodes.find((node) => node.id === department.managerNodeId) || null;
        const slotName = getScenePodTitle(index, locale);
        return {
          id: department.id,
          title: slotName,
          subtitle: toShortLabel(
            department.label || manager?.title || manager?.name || department.strategy,
            locale === 'zh-CN' ? '动态编组' : 'Dynamic Team'
          ),
          zoneLabel: slotName,
          color: SCENE_DEPARTMENT_COLORS[index] || '#8B5CF6',
        };
      });
    }

    return [
      {
        id: 'game',
        title: getScenePodTitle(0, locale),
        subtitle: getFallbackPodSubtitle(0, locale),
        zoneLabel: getScenePodTitle(0, locale),
        color: SCENE_DEPARTMENT_COLORS[0],
      },
      {
        id: 'ai',
        title: getScenePodTitle(1, locale),
        subtitle: getFallbackPodSubtitle(1, locale),
        zoneLabel: getScenePodTitle(1, locale),
        color: SCENE_DEPARTMENT_COLORS[1],
      },
      {
        id: 'life',
        title: getScenePodTitle(2, locale),
        subtitle: getFallbackPodSubtitle(2, locale),
        zoneLabel: getScenePodTitle(2, locale),
        color: SCENE_DEPARTMENT_COLORS[2],
      },
      {
        id: 'meta',
        title: getScenePodTitle(3, locale),
        subtitle: getFallbackPodSubtitle(3, locale),
        zoneLabel: getScenePodTitle(3, locale),
        color: SCENE_DEPARTMENT_COLORS[3],
      },
    ];
  }, [locale, organization]);

  useEffect(() => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += 12;
      setLoadingProgress(Math.min(progress, 100));
      if (progress >= 100) {
        clearInterval(interval);
        window.setTimeout(() => setSceneReady(true), 280);
      }
    }, 180);

    return () => clearInterval(interval);
  }, [setLoadingProgress, setSceneReady]);

  return (
    <group>
      <Floor />
      <Walls />
      <WindowStrip />
      <ArchitecturalAccents />
      <WallBrandPlaque />
      <CorkBoard />
      <DepartmentDecor departments={sceneDepartments} />

      {sceneDepartments[0] ? <ZoneBase position={[-3.5, 0, -1.8]} color={sceneDepartments[0].color} /> : null}
      {sceneDepartments[1] ? <ZoneBase position={[3.5, 0, -1.8]} color={sceneDepartments[1].color} /> : null}
      {sceneDepartments[2] ? <ZoneBase position={[-3.2, 0, 2.35]} color={sceneDepartments[2].color} /> : null}
      {sceneDepartments[3] ? <ZoneBase position={[3.2, 0, 2.35]} color={sceneDepartments[3].color} /> : null}

      <DesktopDesk position={[0, 0, -3.15]} withLamp />
      <FurnitureModel url={FURNITURE_MODELS.rugRounded} position={[0, 0.01, -3.15]} scale={1.05} />

      <FurnitureModel
        url={FURNITURE_MODELS.rugRectangle}
        position={[-3.5, 0.01, -1.95]}
        rotation={[0, Math.PI / 12, 0]}
        scale={1.26}
      />
      <DesktopDesk position={[-4.35, 0, -2.95]} rotation={[0, Math.PI / 18, 0]} compact />
      <LaptopDesk position={[-2.45, 0, -1.15]} rotation={[0, -Math.PI / 7, 0]} />
      <FurnitureModel
        url={FURNITURE_MODELS.chairRounded}
        position={[-3.1, 0, -2.22]}
        rotation={[0, Math.PI / 2.8, 0]}
      />
      <StorageColumn position={[-2.1, 0, -2.92]} rotation={[0, -Math.PI / 5, 0]} low />
      <MobileBoard position={[-5.92, 0, -1.15]} rotation={[0, Math.PI / 2, 0]} color={sceneDepartments[0]?.color || SCENE_DEPARTMENT_COLORS[0]} />
      <TaskCart position={[-5.25, 0, -2.72]} rotation={[0, Math.PI / 8, 0]} color={sceneDepartments[0]?.color || SCENE_DEPARTMENT_COLORS[0]} />

      <FurnitureModel
        url={FURNITURE_MODELS.rugRectangle}
        position={[3.55, 0.01, -1.92]}
        rotation={[0, -Math.PI / 10, 0]}
        scale={1.22}
      />
      <LaptopDesk position={[2.35, 0, -1.08]} rotation={[0, Math.PI / 6, 0]} />
      <MeetingSet position={[4.85, 0, -1.42]} rotation={[0, -Math.PI / 8, 0]} />
      <FurnitureModel
        url={FURNITURE_MODELS.sideTable}
        position={[3.55, 0, -2.88]}
        rotation={[0, -Math.PI / 6, 0]}
        scale={0.92}
        centerXZ
      />
      <FurnitureModel
        url={FURNITURE_MODELS.laptop}
        position={[3.55, 0.39, -2.88]}
        rotation={[0, -Math.PI / 6, 0]}
        scale={0.92}
        centerXZ
      />
      <MobileBoard position={[5.95, 0, -2.45]} rotation={[0, -Math.PI / 2.3, 0]} color={sceneDepartments[1]?.color || SCENE_DEPARTMENT_COLORS[1]} />
      <TaskCart position={[2.05, 0, -2.52]} rotation={[0, -Math.PI / 10, 0]} color={sceneDepartments[1]?.color || SCENE_DEPARTMENT_COLORS[1]} />

      <FurnitureModel
        url={FURNITURE_MODELS.rugRectangle}
        position={[-3.35, 0.01, 2.45]}
        rotation={[0, -Math.PI / 14, 0]}
        scale={1.3}
      />
      <MeetingSet position={[-3.55, 0, 2.28]} rotation={[0, Math.PI / 10, 0]} />
      <LaptopDesk position={[-5.3, 0, 2.9]} rotation={[0, Math.PI / 2.4, 0]} />
      <FurnitureModel
        url={FURNITURE_MODELS.chairRounded}
        position={[-2.1, 0, 2.98]}
        rotation={[0, -Math.PI / 2.6, 0]}
      />
      <StorageColumn position={[-5.95, 0, 3.5]} rotation={[0, Math.PI / 2, 0]} low />
      <MobileBoard position={[-5.98, 0, 1.48]} rotation={[0, Math.PI / 2, 0]} color={sceneDepartments[2]?.color || SCENE_DEPARTMENT_COLORS[2]} />
      <TaskCart position={[-1.98, 0, 2.62]} rotation={[0, Math.PI / 7, 0]} color={sceneDepartments[2]?.color || SCENE_DEPARTMENT_COLORS[2]} />

      <FurnitureModel
        url={FURNITURE_MODELS.rugRounded}
        position={[3.18, 0.01, 2.42]}
        rotation={[0, Math.PI / 11, 0]}
        scale={1.24}
      />
      <FurnitureModel url={FURNITURE_MODELS.tableCoffeeSquare} position={[3.05, 0, 2.42]} />
      <FurnitureModel
        url={FURNITURE_MODELS.loungeChair}
        position={[2.02, 0, 2.08]}
        rotation={[0, Math.PI / 3.4, 0]}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.loungeChair}
        position={[4.18, 0, 2.12]}
        rotation={[0, -Math.PI / 2.8, 0]}
      />
      <LaptopDesk position={[5.25, 0, 2.26]} rotation={[0, -Math.PI / 2.2, 0]} />
      <StorageColumn position={[5.92, 0, 3.42]} rotation={[0, -Math.PI / 2.2, 0]} low />
      <MobileBoard position={[5.95, 0, 1.58]} rotation={[0, -Math.PI / 2, 0]} color={sceneDepartments[3]?.color || SCENE_DEPARTMENT_COLORS[3]} />
      <TaskCart position={[1.96, 0, 2.88]} rotation={[0, -Math.PI / 8, 0]} color={sceneDepartments[3]?.color || SCENE_DEPARTMENT_COLORS[3]} />

      <LoungeArea position={[0.2, 0, 4.1]} />
      <FurnitureModel url={FURNITURE_MODELS.tableCoffee} position={[-0.3, 0, 1.15]} />
      <FurnitureModel url={FURNITURE_MODELS.loungeChair} position={[-1.95, 0, 1.4]} rotation={[0, Math.PI / 3, 0]} />
      <FurnitureModel url={FURNITURE_MODELS.loungeChair} position={[1.6, 0, 1.35]} rotation={[0, -Math.PI / 3, 0]} />

      <DecorativePlants />
    </group>
  );
}

Object.values(FURNITURE_MODELS).forEach((url) => {
  useGLTF.preload(url);
});
