/**
 * CommunicationLine — Animated line between two agents in 3D space.
 *
 * Uses @react-three/drei Line component with useFrame-driven opacity
 * animation to visualise message flow between agents. When `active` is
 * true the line pulses; otherwise it fades to a faint trace.
 *
 * A small sphere "particle" travels along the line while active.
 *
 * Requirements: 8.2
 */

import { useMemo, useRef } from 'react';

import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export interface CommunicationLineProps {
  from: [number, number, number];
  to: [number, number, number];
  active: boolean;
  color?: string;
}

export function CommunicationLine({
  from,
  to,
  active,
  color = '#60A5FA',
}: CommunicationLineProps) {
  const particleRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  /* Build a gentle arc between the two points */
  const points = useMemo(() => {
    const mid: [number, number, number] = [
      (from[0] + to[0]) / 2,
      Math.max(from[1], to[1]) + 1.2,
      (from[2] + to[2]) / 2,
    ];
    return [from, mid, to];
  }, [from, to]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;

    /* Fade line opacity */
    groupRef.current.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh?.material) {
        const mat = mesh.material as THREE.Material & { opacity?: number };
        if (typeof mat.opacity === 'number') {
          mat.opacity = active
            ? 0.6 + Math.sin(clock.elapsedTime * 4) * 0.3
            : 0.12;
        }
      }
    });

    /* Animate particle along the arc */
    if (particleRef.current) {
      if (!active) {
        particleRef.current.visible = false;
        return;
      }
      particleRef.current.visible = true;

      const t = (clock.elapsedTime * 0.8) % 1; // 0→1 loop
      // Quadratic bezier interpolation
      const invT = 1 - t;
      particleRef.current.position.set(
        invT * invT * from[0] + 2 * invT * t * points[1][0] + t * t * to[0],
        invT * invT * from[1] + 2 * invT * t * points[1][1] + t * t * to[1],
        invT * invT * from[2] + 2 * invT * t * points[1][2] + t * t * to[2],
      );
    }
  });

  return (
    <group ref={groupRef}>
      <Line
        points={points}
        color={color}
        lineWidth={active ? 2.5 : 1}
        transparent
        opacity={active ? 0.7 : 0.12}
      />

      {/* Travelling particle */}
      <mesh ref={particleRef} visible={active}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.2}
          transparent
          opacity={0.9}
        />
      </mesh>
    </group>
  );
}
