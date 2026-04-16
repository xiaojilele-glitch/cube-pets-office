/**
 * ReputationRadar — SVG-based five-dimension radar chart.
 * @see Requirement 9.2
 */

import type { DimensionScores } from "@shared/reputation";

interface ReputationRadarProps {
  dimensions: DimensionScores;
  size?: number;
}

const LABELS = [
  "Quality",
  "Speed",
  "Efficiency",
  "Collaboration",
  "Reliability",
];

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function ReputationRadar({
  dimensions,
  size = 200,
}: ReputationRadarProps) {
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.4;
  const values = [
    dimensions.qualityScore,
    dimensions.speedScore,
    dimensions.efficiencyScore,
    dimensions.collaborationScore,
    dimensions.reliabilityScore,
  ];
  const angleStep = 360 / 5;

  // Grid rings at 25%, 50%, 75%, 100%
  const rings = [0.25, 0.5, 0.75, 1.0];

  // Data polygon points
  const dataPoints = values.map((v, i) => {
    const r = (v / 1000) * maxR;
    return polarToCartesian(cx, cy, r, i * angleStep);
  });
  const dataPath =
    dataPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") +
    "Z";

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Reputation radar chart"
    >
      {/* Grid rings */}
      {rings.map(pct => {
        const ringPoints = Array.from({ length: 5 }, (_, i) =>
          polarToCartesian(cx, cy, maxR * pct, i * angleStep)
        );
        const ringPath =
          ringPoints
            .map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`)
            .join(" ") + "Z";
        return (
          <path
            key={pct}
            d={ringPath}
            fill="none"
            stroke="#444"
            strokeWidth={0.5}
            opacity={0.5}
          />
        );
      })}

      {/* Axis lines */}
      {Array.from({ length: 5 }, (_, i) => {
        const end = polarToCartesian(cx, cy, maxR, i * angleStep);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={end.x}
            y2={end.y}
            stroke="#555"
            strokeWidth={0.5}
          />
        );
      })}

      {/* Data polygon */}
      <path
        d={dataPath}
        fill="rgba(59,130,246,0.3)"
        stroke="#3b82f6"
        strokeWidth={1.5}
      />

      {/* Data points */}
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill="#3b82f6" />
      ))}

      {/* Labels */}
      {LABELS.map((label, i) => {
        const pos = polarToCartesian(cx, cy, maxR + 16, i * angleStep);
        return (
          <text
            key={label}
            x={pos.x}
            y={pos.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#aaa"
            fontSize={10}
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}
