/**
 * ErrorHighlight — Red pulsing highlight with warning icon for error events.
 *
 * Renders a red emissive ring and an Html-based warning badge above the
 * agent position when an error/exception event is active.
 *
 * Requirements: 8.6
 */

import { useRef } from 'react';

import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export interface ErrorHighlightProps {
  position: [number, number, number];
}

export function ErrorHighlight({ position }: ErrorHighlightProps) {
  const ringRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(({ clock }) => {
    if (!ringRef.current || !matRef.current) return;

    const t = clock.elapsedTime;
    const pulse = Math.sin(t * 5) * 0.5 + 0.5; // 0→1

    matRef.current.opacity = 0.3 + pulse * 0.45;
    matRef.current.emissiveIntensity = 0.6 + pulse * 0.8;

    const scale = 1 + pulse * 0.15;
    ringRef.current.scale.setScalar(scale);
  });

  return (
    <group position={[position[0], position[1] + 0.05, position[2]]}>
      {/* Pulsing red ring on the ground plane */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.6, 0.8, 32]} />
        <meshStandardMaterial
          ref={matRef}
          color="#EF4444"
          transparent
          opacity={0.5}
          emissive="#EF4444"
          emissiveIntensity={1}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Warning badge */}
      <Html position={[0, 2.6, 0]} center distanceFactor={7} style={{ pointerEvents: 'none' }}>
        <div className="animate-pulse rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-md">
          ⚠ ERROR
        </div>
      </Html>
    </group>
  );
}
