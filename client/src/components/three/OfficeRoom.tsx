import { Html, useGLTF } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { FURNITURE_MODELS } from '@/lib/assets';
import { useAppStore } from '@/lib/store';

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
      <mesh position={[0, 1.7, -4.9]} receiveShadow>
        <boxGeometry args={[15.5, 3.4, 0.18]} />
        <meshStandardMaterial color="#D8C8B7" roughness={0.98} />
      </mesh>
      <mesh position={[-7.8, 1.7, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <boxGeometry args={[10, 3.4, 0.18]} />
        <meshStandardMaterial color="#D2C2B2" roughness={0.98} />
      </mesh>
      <mesh position={[7.8, 1.7, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <boxGeometry args={[10, 3.4, 0.18]} />
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
    <group position={[-7.65, 1.8, -1.2]}>
      {[-2.6, 0, 2.6].map((offset) => (
        <group key={offset} position={[0, 0, offset]}>
          <FurnitureModel
            url={FURNITURE_MODELS.wallWindowSlide}
            position={[-0.12, -1.6, 0]}
            rotation={[0, Math.PI / 2, 0]}
            scale={1.05}
          />
          <mesh rotation={[0, Math.PI / 2, 0]}>
            <boxGeometry args={[2.1, 1.55, 0.08]} />
            <meshStandardMaterial color="#D9CDBC" roughness={0.7} />
          </mesh>
          <mesh rotation={[0, Math.PI / 2, 0]} position={[-0.08, 0, 0]}>
            <planeGeometry args={[1.9, 1.36]} />
            <meshBasicMaterial color="#F6EFE2" transparent opacity={0.52} />
          </mesh>
          <mesh rotation={[0, Math.PI / 2, 0]} position={[0.02, 0, 0]}>
            <planeGeometry args={[1.86, 1.32]} />
            <meshStandardMaterial
              color="#BFD5DF"
              transparent
              opacity={0.18}
              roughness={0.25}
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
        position={[-1.9, 1.25, -4.72]}
        scale={1.05}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.lampWall}
        position={[1.9, 1.25, -4.72]}
        scale={1.05}
      />
      <pointLight position={[-1.9, 1.38, -4.4]} intensity={0.22} color="#FFDDB0" distance={3.2} decay={2} />
      <pointLight position={[1.9, 1.38, -4.4]} intensity={0.22} color="#FFDDB0" distance={3.2} decay={2} />
    </group>
  );
}

function CorkBoard() {
  return (
    <group position={[0, 2.35, -4.72]}>
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
  return (
    <group position={[0, 3.48, -4.72]}>
      <mesh position={[0, 0, -0.015]}>
        <boxGeometry args={[4.48, 0.88, 0.03]} />
        <meshStandardMaterial color="#705742" roughness={0.96} />
      </mesh>
      <mesh>
        <boxGeometry args={[4.16, 0.66, 0.06]} />
        <meshStandardMaterial color="#E6D4BF" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.22, 0.03]}>
        <boxGeometry args={[4.16, 0.08, 0.015]} />
        <meshStandardMaterial color="#A6815C" roughness={0.76} />
      </mesh>
      {[-1.42, 1.42].map((x) => (
        <mesh key={x} position={[x, 0.22, 0.045]}>
          <cylinderGeometry args={[0.035, 0.035, 0.024, 20]} />
          <meshStandardMaterial color="#E8D9C7" metalness={0.06} roughness={0.46} />
        </mesh>
      ))}
      <Html
        center
        transform
        position={[0, -0.015, 0.045]}
        distanceFactor={5.4}
        style={{ pointerEvents: 'none' }}
      >
        <div className="w-[220px] text-center">
          <div className="text-[8px] font-semibold uppercase tracking-[0.3em] text-[#8C6B4A]">
            Live Workspace
          </div>
          <div
            className="mt-1 text-[22px] font-bold leading-none text-[#4A3626]"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Cube Pets Office
          </div>
          <div className="mt-1.5 text-[8px] uppercase tracking-[0.24em] text-[#977C63]">
            Multi-Agent 3D Command Floor
          </div>
        </div>
      </Html>
    </group>
  );
}

function ZoneBase({
  position,
  color,
  title,
}: {
  position: [number, number, number];
  color: string;
  title: string;
}) {
  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <planeGeometry args={[4.2, 3.3]} />
        <meshStandardMaterial color={color} transparent opacity={0.13} />
      </mesh>
      <Html center position={[0, 0.1, -1.75]} distanceFactor={12} style={{ pointerEvents: 'none' }}>
        <div className="rounded-full bg-white/88 px-3 py-1 text-[10px] font-semibold text-[#5A4A3A] shadow-sm">
          {title}
        </div>
      </Html>
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
        <boxGeometry args={[1.55, 0.9, panelDepth]} />
        <meshStandardMaterial color="#F4E9DB" roughness={0.92} />
      </mesh>
      <mesh position={[0, 0.3, panelDepth / 2 + accentDepth / 2]}>
        <boxGeometry args={[1.55, 0.16, accentDepth]} />
        <meshStandardMaterial color={color} roughness={0.65} />
      </mesh>
      <mesh position={[-0.56, 0.3, panelDepth / 2 + badgeDepth / 2 + 0.002]}>
        <cylinderGeometry args={[0.045, 0.045, badgeDepth, 20]} />
        <meshStandardMaterial color="#FFF7EA" emissive={color} emissiveIntensity={0.26} />
      </mesh>
      <Html center transform position={[0, -0.02, htmlZ]} distanceFactor={8} style={{ pointerEvents: 'none' }}>
        <div className="w-[120px] rounded-xl bg-white/85 px-3 py-2 text-center shadow-md backdrop-blur-sm">
          <div className="text-[11px] font-bold tracking-[0.22em] text-[#3F3124]">{title}</div>
          <div className="mt-1 text-[9px] uppercase tracking-[0.16em] text-[#8F7A66]">{subtitle}</div>
        </div>
      </Html>
    </group>
  );
}

function GameDepartmentDecor() {
  return (
    <group>
      <ZoneBanner
        position={[-7.6, 1.93, -1.75]}
        rotation={[0, Math.PI / 2, 0]}
        color="#D97706"
        title="GAME LAB"
        subtitle="loops and events"
        wallMounted
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-3.45, 0.03, -1.78]}>
        <torusGeometry args={[1.12, 0.06, 16, 64]} />
        <meshStandardMaterial color="#B86C18" emissive="#D97706" emissiveIntensity={0.14} />
      </mesh>

      <group position={[-5.6, 0, -1.15]}>
        <mesh position={[0, 0.11, 0]}>
          <boxGeometry args={[0.52, 0.18, 0.52]} />
          <meshStandardMaterial color="#8E5F31" roughness={0.8} />
        </mesh>
        <mesh position={[-0.12, 0.28, -0.08]}>
          <boxGeometry args={[0.13, 0.13, 0.13]} />
          <meshStandardMaterial color="#F59E0B" roughness={0.55} />
        </mesh>
        <mesh position={[0.05, 0.28, 0.02]}>
          <boxGeometry args={[0.16, 0.16, 0.16]} />
          <meshStandardMaterial color="#FB923C" roughness={0.55} />
        </mesh>
        <mesh position={[0.18, 0.28, -0.12]}>
          <boxGeometry args={[0.1, 0.1, 0.1]} />
          <meshStandardMaterial color="#FCD34D" roughness={0.48} />
        </mesh>
      </group>

      <FurnitureModel url={FURNITURE_MODELS.sideTable} position={[-4.95, 0, -2.9]} scale={0.86} centerXZ />
      <FurnitureModel url={FURNITURE_MODELS.books} position={[-4.96, 0.34, -2.92]} scale={0.75} centerXZ />
    </group>
  );
}

function AIDepartmentDecor() {
  return (
    <group>
      <ZoneBanner
        position={[7.6, 1.93, -1.7]}
        rotation={[0, -Math.PI / 2, 0]}
        color="#2563EB"
        title="AI CORE"
        subtitle="models and data"
        wallMounted
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[3.35, 0.03, -1.72]}>
        <ringGeometry args={[1.06, 1.22, 48]} />
        <meshStandardMaterial color="#2A5DD8" transparent opacity={0.26} />
      </mesh>

      <group position={[5.95, 0, -1.2]}>
        {[0, 0.48].map((offset, index) => (
          <group key={index} position={[0, 0, offset]}>
            <mesh position={[0, 0.42, 0]}>
              <boxGeometry args={[0.42, 0.84, 0.3]} />
              <meshStandardMaterial color="#384861" roughness={0.7} />
            </mesh>
            {[-0.22, 0, 0.22].map((y) => (
              <mesh key={y} position={[0, 0.42 + y, 0.16]}>
                <boxGeometry args={[0.28, 0.05, 0.02]} />
                <meshStandardMaterial color="#8BC3FF" emissive="#3B82F6" emissiveIntensity={0.55} />
              </mesh>
            ))}
          </group>
        ))}
      </group>

      <group position={[5.18, 1.08, -0.92]} rotation={[0, -Math.PI / 12, 0]}>
        <mesh>
          <boxGeometry args={[0.92, 0.68, 0.05]} />
          <meshStandardMaterial color="#D6E8F7" transparent opacity={0.3} metalness={0.12} roughness={0.25} />
        </mesh>
        {[-0.2, 0, 0.2].map((y) => (
          <mesh key={y} position={[0, y, 0.03]}>
            <boxGeometry args={[0.58, 0.02, 0.02]} />
            <meshStandardMaterial color="#60A5FA" emissive="#2563EB" emissiveIntensity={0.45} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function LifeDepartmentDecor() {
  return (
    <group>
      <ZoneBanner
        position={[-7.6, 1.93, 2.65]}
        rotation={[0, Math.PI / 2, 0]}
        color="#059669"
        title="LIFE HUB"
        subtitle="community and voice"
        wallMounted
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-3.08, 0.03, 2.45]}>
        <torusGeometry args={[1.18, 0.08, 18, 64]} />
        <meshStandardMaterial color="#2F8E68" transparent opacity={0.34} />
      </mesh>

      <FurnitureModel url={FURNITURE_MODELS.sideTable} position={[-4.92, 0, 3.02]} scale={0.9} centerXZ />
      <FurnitureModel url={FURNITURE_MODELS.books} position={[-4.92, 0.34, 3.02]} scale={0.7} centerXZ />
      <FurnitureModel url={FURNITURE_MODELS.plantSmall2} position={[-5.55, 0, 2.45]} scale={1.05} centerXZ />
      <FurnitureModel url={FURNITURE_MODELS.plantSmall3} position={[-4.4, 0, 2.38]} scale={1.05} centerXZ />

      <mesh position={[-4.82, 0.41, 3.18]}>
        <cylinderGeometry args={[0.06, 0.06, 0.08, 18]} />
        <meshStandardMaterial color="#FFF1D6" roughness={0.45} />
      </mesh>
    </group>
  );
}

function MetaDepartmentDecor() {
  return (
    <group>
      <ZoneBanner
        position={[7.6, 1.93, 2.55]}
        rotation={[0, -Math.PI / 2, 0]}
        color="#7C3AED"
        title="META DESK"
        subtitle="audit and ops"
        wallMounted
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[3.25, 0.03, 2.45]}>
        <ringGeometry args={[1.05, 1.2, 48]} />
        <meshStandardMaterial color="#7C3AED" transparent opacity={0.22} />
      </mesh>

      <group position={[5.6, 0, 2.7]}>
        <mesh position={[0, 0.16, 0]}>
          <boxGeometry args={[0.55, 0.22, 0.4]} />
          <meshStandardMaterial color="#725B93" roughness={0.75} />
        </mesh>
        {[-0.1, 0.05, 0.2].map((x, index) => (
          <mesh key={index} position={[x, 0.34 + index * 0.08, 0.02]}>
            <boxGeometry args={[0.32, 0.06, 0.02]} />
            <meshStandardMaterial color={index === 1 ? '#C4B5FD' : '#E9D5FF'} roughness={0.5} />
          </mesh>
        ))}
      </group>

      <FurnitureModel url={FURNITURE_MODELS.bookcaseOpenLow} position={[5.95, 0, 1.55]} rotation={[0, -Math.PI / 2, 0]} scale={0.92} centerXZ />
      <FurnitureModel url={FURNITURE_MODELS.books} position={[5.96, 0.48, 1.55]} rotation={[0, -Math.PI / 2, 0]} scale={0.68} centerXZ />
    </group>
  );
}

function DepartmentDecor() {
  return (
    <group>
      <GameDepartmentDecor />
      <AIDepartmentDecor />
      <LifeDepartmentDecor />
      <MetaDepartmentDecor />
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
      <DepartmentDecor />

      <ZoneBase position={[-3.5, 0, -1.8]} color="#F59E0B" title="游戏部工位区" />
      <ZoneBase position={[3.5, 0, -1.8]} color="#3B82F6" title="AI 部工位区" />
      <ZoneBase position={[-3.2, 0, 2.35]} color="#10B981" title="生活部协作区" />
      <ZoneBase position={[3.2, 0, 2.35]} color="#8B5CF6" title="元部门审计区" />

      <DesktopDesk position={[0, 0, -3.15]} withLamp />

      <DesktopDesk position={[-3.35, 0, -3.1]} />
      <DesktopDesk position={[-5.25, 0, -1.75]} rotation={[0, Math.PI / 2, 0]} compact />
      <LaptopDesk position={[-3.4, 0, -0.95]} />
      <DesktopDesk position={[-1.65, 0, -2.2]} compact />
      <StorageColumn position={[-6.15, 0, -3.45]} rotation={[0, Math.PI / 2, 0]} />

      <DesktopDesk position={[3.35, 0, -3.1]} />
      <DesktopDesk position={[5.25, 0, -1.75]} rotation={[0, -Math.PI / 2, 0]} compact />
      <LaptopDesk position={[3.4, 0, -0.95]} />
      <DesktopDesk position={[1.65, 0, -2.2]} compact />
      <StorageColumn position={[6.15, 0, -3.45]} rotation={[0, -Math.PI / 2, 0]} />

      <MeetingSet position={[-3.25, 0, 2.55]} />
      <LaptopDesk position={[-5.45, 0, 2.35]} rotation={[0, Math.PI / 2, 0]} />
      <StorageColumn position={[-6.1, 0, 1.0]} rotation={[0, Math.PI / 2, 0]} low />
      <FurnitureModel url={FURNITURE_MODELS.rugRectangle} position={[-3.25, 0.01, 2.55]} scale={1.35} />

      <MeetingSet position={[3.15, 0, 2.55]} />
      <DesktopDesk position={[5.55, 0, 2.15]} rotation={[0, -Math.PI / 2, 0]} compact />
      <StorageColumn position={[6.1, 0, 0.95]} rotation={[0, -Math.PI / 2, 0]} low />
      <FurnitureModel url={FURNITURE_MODELS.rugRectangle} position={[3.15, 0.01, 2.55]} scale={1.35} />
      <FurnitureModel url={FURNITURE_MODELS.rugRounded} position={[0, 0.01, -3.15]} scale={1.05} />

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
