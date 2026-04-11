import { ContactShadows } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect, useState } from 'react';
import { ACESFilmicToneMapping } from 'three';

import { useViewportTier } from '@/hooks/useViewportTier';
import { useTasksStore } from '@/lib/tasks-store';

import { CrossFrameworkParticles } from './three/CrossFrameworkParticles';
import { CrossPodParticles } from './three/CrossPodParticles';
import { MissionIsland } from './three/MissionIsland';
import { OfficeRoom } from './three/OfficeRoom';
import { PetWorkers } from './three/PetWorkers';
import { SandboxMonitor } from './three/SandboxMonitor';
import { SceneStageFlow } from './three/SceneStageFlow';
import { WaitingDecisionBubble } from './three/WaitingDecisionBubble';

export function Scene3D() {
  const { isMobile, isTablet } = useViewportTier();

  // Sandbox shield: show when the selected mission runs at strict security level.
  const isStrictSandbox = useTasksStore(state => {
    const detail = state.selectedTaskId ? state.detailsById[state.selectedTaskId] : null;
    return detail?.securitySummary?.level === 'strict' && detail?.status === 'running';
  });

  const [isRecovering, setIsRecovering] = useState(false);

  useEffect(() => {
    (globalThis as { __sceneSetRecovering?: (value: boolean) => void }).__sceneSetRecovering =
      (value: boolean) => {
        setIsRecovering(value);
      };

    return () => {
      delete (globalThis as { __sceneSetRecovering?: (value: boolean) => void })
        .__sceneSetRecovering;
    };
  }, []);

  const camera = isMobile
    ? { position: [0, 8.4, 16.2] as [number, number, number], fov: 46, near: 0.1, far: 100 }
    : isTablet
      ? { position: [0, 7.8, 14.6] as [number, number, number], fov: 43, near: 0.1, far: 100 }
      : { position: [0, 7.3, 13.8] as [number, number, number], fov: 40, near: 0.1, far: 100 };

  return (
    <div className="absolute inset-0 z-0 h-full w-full touch-pan-y">
      <Canvas
        shadows
        camera={camera}
        dpr={isMobile ? [1, 1.5] : [1, 2]}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl, camera: sceneCamera }) => {
          gl.setClearColor('#BFDFFF');
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = isMobile ? 0.92 : 0.88;
          sceneCamera.lookAt(0, isMobile ? 1.6 : 1.35, 0);
        }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.38} color="#F7EDE1" />
          <hemisphereLight color="#FAEEDD" groundColor="#B28A67" intensity={0.34} />

          <directionalLight
            position={[-5.2, 7.2, 4.4]}
            intensity={0.98}
            color="#FBE2BC"
            castShadow
            shadow-mapSize-height={2048}
            shadow-mapSize-width={2048}
            shadow-camera-bottom={-11}
            shadow-camera-far={22}
            shadow-camera-left={-11}
            shadow-camera-right={11}
            shadow-camera-top={11}
            shadow-bias={-0.00025}
          />

          <directionalLight position={[6.4, 4.5, 5.5]} intensity={0.24} color="#F1E4D4" />

          <spotLight
            position={[-7.2, 2.9, 0.3]}
            angle={0.92}
            penumbra={1}
            intensity={0.34}
            color="#FFF0D8"
            distance={18}
            decay={2}
          />

          <pointLight
            position={[0.3, 2.35, -1.1]}
            intensity={0.28}
            color="#F6D8A9"
            distance={6.6}
            decay={2}
          />

          <OfficeRoom />
          <SceneStageFlow />
          <PetWorkers />
          <MissionIsland />
          <SandboxMonitor />
          <WaitingDecisionBubble />
          <CrossPodParticles />
          <CrossFrameworkParticles />

          <ContactShadows
            position={[0, 0.01, 0]}
            opacity={0.34}
            scale={15}
            blur={2.2}
            far={5.5}
            color="#665140"
          />
        </Suspense>
      </Canvas>

      {isRecovering && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="mb-4 size-8 animate-spin rounded-full border-4 border-white/30 border-t-white" />
          <p className="text-base font-medium text-white drop-shadow-md">
            Recovering previous task...
          </p>
        </div>
      )}

      {isStrictSandbox && (
        <div
          className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-2xl border border-rose-200/60 bg-white/80 px-3.5 py-2 shadow-lg backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <span className="text-lg" aria-hidden="true">
            {"\uD83D\uDEE1\uFE0F"}
          </span>
          <span className="text-xs font-semibold text-rose-700">
            Sandbox Protected
          </span>
        </div>
      )}
    </div>
  );
}
