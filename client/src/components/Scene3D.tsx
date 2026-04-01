import { ContactShadows } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { AlertTriangle, DollarSign, ShieldOff } from 'lucide-react';
import { Suspense } from 'react';
import { ACESFilmicToneMapping } from 'three';

import { useViewportTier } from '@/hooks/useViewportTier';
import { useCostStore } from '@/lib/cost-store';

import { CostDashboard } from './CostDashboard';
import { MissionIsland } from './three/MissionIsland';
import { OfficeRoom } from './three/OfficeRoom';
import { PetWorkers } from './three/PetWorkers';

export function Scene3D() {
  const { isMobile, isTablet } = useViewportTier();
  const snapshot = useCostStore((s) => s.snapshot);
  const dashboardOpen = useCostStore((s) => s.dashboardOpen);
  const toggleDashboard = useCostStore((s) => s.toggleDashboard);

  const hasAlerts = (snapshot?.alerts?.filter((a) => !a.resolved).length ?? 0) > 0;
  const isDowngraded = snapshot?.downgradeLevel !== 'none' && snapshot?.downgradeLevel != null;
  const budgetRemaining = snapshot ? Math.max(0, 100 - snapshot.budgetUsedPercent * 100) : 100;
  const totalCost = snapshot?.totalCost ?? 0;

  const camera = isMobile
    ? { position: [0, 8.4, 16.2] as [number, number, number], fov: 46, near: 0.1, far: 100 }
    : isTablet
      ? { position: [0, 7.8, 14.6] as [number, number, number], fov: 43, near: 0.1, far: 100 }
      : { position: [0, 7.3, 13.8] as [number, number, number], fov: 40, near: 0.1, far: 100 };

  return (
    <div className="absolute inset-0 z-0 h-full w-full touch-pan-y">
      {/* Cost overlay — HTML layer above the 3D canvas */}
      <div
        role="button"
        tabIndex={0}
        onClick={toggleDashboard}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleDashboard(); }}
        className={`absolute right-3 top-3 z-10 flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/80 px-3 py-1.5 text-xs shadow-md backdrop-blur transition-colors select-none ${
          hasAlerts ? 'border-2 border-red-500' : 'border border-gray-200'
        }`}
      >
        {hasAlerts && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
        {isDowngraded && <ShieldOff className="h-3.5 w-3.5 text-amber-500" />}
        <DollarSign className="h-3.5 w-3.5 text-gray-600" />
        <span className="font-medium text-gray-800">${totalCost.toFixed(4)}</span>
        <span className="text-gray-500">|</span>
        <span className={budgetRemaining < 20 ? 'font-semibold text-red-600' : 'text-gray-600'}>
          {budgetRemaining.toFixed(0)}%
        </span>
      </div>

      {dashboardOpen && (
        <div className="absolute right-3 top-14 z-10 max-h-[80vh] w-96 overflow-y-auto rounded-xl bg-white/95 shadow-xl backdrop-blur">
          <CostDashboard />
        </div>
      )}

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
          <PetWorkers />
          <MissionIsland />

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
    </div>
  );
}
