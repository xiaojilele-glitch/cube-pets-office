/**
 * DecisionGlow — Pulsing emissive glow at a decision node.
 *
 * Renders a translucent sphere with emissive intensity modulated by
 * the decision confidence value. Higher confidence → brighter, steadier
 * glow; lower confidence → dimmer, faster pulse.
 *
 * Requirements: 8.3
 */

import { useRef } from "react";

import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export interface DecisionGlowProps {
  position: [number, number, number];
  /** 0–1 confidence value */
  confidence: number;
  color?: string;
}

export function DecisionGlow({
  position,
  confidence,
  color = "#FBBF24",
}: DecisionGlowProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current || !matRef.current) return;

    const t = clock.elapsedTime;
    // Lower confidence → faster, more erratic pulse
    const speed = 2 + (1 - confidence) * 4;
    const baseIntensity = 0.4 + confidence * 0.6;
    const pulse = Math.sin(t * speed) * 0.3 * (1 - confidence * 0.5);

    matRef.current.emissiveIntensity = baseIntensity + pulse;
    matRef.current.opacity = 0.3 + confidence * 0.35 + pulse * 0.15;

    const scale = 0.9 + confidence * 0.3 + Math.sin(t * speed) * 0.06;
    meshRef.current.scale.setScalar(scale);
  });

  return (
    <mesh
      ref={meshRef}
      position={[position[0], position[1] + 2.0, position[2]]}
    >
      <sphereGeometry args={[0.3, 16, 16]} />
      <meshStandardMaterial
        ref={matRef}
        color={color}
        transparent
        opacity={0.5}
        emissive={color}
        emissiveIntensity={0.8}
        depthWrite={false}
      />
    </mesh>
  );
}
