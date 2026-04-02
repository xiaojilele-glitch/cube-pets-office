/**
 * 知识图谱力导向图可视化面板
 *
 * 使用 d3-force 实现力导向图，SVG 渲染。
 * 不同 entityType 使用不同颜色，节点大小反映关联关系数量。
 * 支持交互：点击展开详情、双击展开邻居、缩放平移、搜索高亮。
 *
 * Requirements: 9.1, 9.2
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import type { Entity, Relation } from "@shared/knowledge/types";

// ---------------------------------------------------------------------------
// Color mapping per entityType
// ---------------------------------------------------------------------------

const ENTITY_COLORS: Record<string, string> = {
  CodeModule: "#4A90D9",
  API: "#50C878",
  BusinessRule: "#FFB347",
  ArchitectureDecision: "#9B59B6",
  Bug: "#E74C3C",
  Agent: "#1ABC9C",
  Mission: "#F39C12",
  TechStack: "#3498DB",
  Role: "#E67E22",
  Config: "#8E44AD",
};

const DEFAULT_COLOR = "#95A5A6";

export function getEntityColor(entityType: string): string {
  return ENTITY_COLORS[entityType] ?? DEFAULT_COLOR;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KnowledgeGraphPanelProps {
  nodes: Entity[];
  edges: Relation[];
  searchTerm?: string;
  onNodeClick?: (entity: Entity) => void;
  onNodeExpand?: (entityId: string) => void;
  onBoxSelect?: (entityIds: string[]) => void;
  className?: string;
}

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  entity: Entity;
  radius: number;
  color: string;
  matched: boolean;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  relation: Relation;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NODE_MIN_RADIUS = 8;
const NODE_MAX_RADIUS = 24;
const RADIUS_PER_EDGE = 2;

export function computeRadius(entityId: string, edges: Relation[]): number {
  const count = edges.filter(
    (e) => e.sourceEntityId === entityId || e.targetEntityId === entityId,
  ).length;
  return Math.min(NODE_MAX_RADIUS, Math.max(NODE_MIN_RADIUS, NODE_MIN_RADIUS + count * RADIUS_PER_EDGE));
}

export function matchesSearch(entity: Entity, term: string): boolean {
  if (!term) return false;
  const lower = term.toLowerCase();
  return (
    entity.name.toLowerCase().includes(lower) ||
    entity.entityType.toLowerCase().includes(lower)
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function KnowledgeGraphPanel({
  nodes,
  edges,
  searchTerm = "",
  onNodeClick,
  onNodeExpand,
  onBoxSelect,
  className = "",
}: KnowledgeGraphPanelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);

  // Build simulation data from props
  const { simNodes, simLinks } = useMemo(() => {
    const nodeMap = new Map<string, SimNode>();
    const sNodes: SimNode[] = nodes.map((entity) => {
      const node: SimNode = {
        id: entity.entityId,
        entity,
        radius: computeRadius(entity.entityId, edges),
        color: getEntityColor(entity.entityType),
        matched: matchesSearch(entity, searchTerm),
      };
      nodeMap.set(entity.entityId, node);
      return node;
    });

    const sLinks: SimLink[] = edges
      .filter((e) => nodeMap.has(e.sourceEntityId) && nodeMap.has(e.targetEntityId))
      .map((relation) => ({
        source: relation.sourceEntityId,
        target: relation.targetEntityId,
        relation,
      }));

    return { simNodes: sNodes, simLinks: sLinks };
  }, [nodes, edges, searchTerm]);

  // Double-click handler (stable ref)
  const handleDblClick = useCallback(
    (_event: MouseEvent, d: SimNode) => {
      onNodeExpand?.(d.id);
    },
    [onNodeExpand],
  );

  // Click handler (stable ref)
  const handleClick = useCallback(
    (_event: MouseEvent, d: SimNode) => {
      onNodeClick?.(d.entity);
    },
    [onNodeClick],
  );

  // ---------------------------------------------------------------------------
  // d3 simulation setup & teardown
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const width = svg.clientWidth || 800;
    const height = svg.clientHeight || 600;

    // Clear previous render
    const root = d3.select(svg);
    root.selectAll("*").remove();

    // Container group for zoom/pan
    const g = root.append("g");

    // Zoom behaviour
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    root.call(zoom);

    // Arrow marker for directed edges
    g.append("defs")
      .append("marker")
      .attr("id", "kg-arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#999");

    // Links
    const link = g
      .append("g")
      .attr("class", "kg-links")
      .selectAll<SVGLineElement, SimLink>("line")
      .data(simLinks)
      .join("line")
      .attr("stroke", "#ccc")
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.6)
      .attr("marker-end", "url(#kg-arrow)");

    // Node groups
    const node = g
      .append("g")
      .attr("class", "kg-nodes")
      .selectAll<SVGGElement, SimNode>("g")
      .data(simNodes, (d) => d.id)
      .join("g")
      .attr("cursor", "pointer")
      .on("click", handleClick as any)
      .on("dblclick", handleDblClick as any);

    // Circle for each node
    node
      .append("circle")
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => d.color)
      .attr("stroke", (d) => (d.matched ? "#FFD700" : "#fff"))
      .attr("stroke-width", (d) => (d.matched ? 3 : 1.5))
      .attr("opacity", (d) =>
        searchTerm && !d.matched ? 0.3 : 1,
      );

    // Label
    node
      .append("text")
      .text((d) => d.entity.name)
      .attr("text-anchor", "middle")
      .attr("dy", (d) => d.radius + 12)
      .attr("font-size", 10)
      .attr("fill", "#333")
      .attr("pointer-events", "none")
      .attr("opacity", (d) =>
        searchTerm && !d.matched ? 0.3 : 1,
      );

    // Drag behaviour
    const drag = d3
      .drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    node.call(drag);

    // Box-selection via d3-brush (Shift + drag to select multiple nodes)
    const brushG = g.append("g").attr("class", "kg-brush");
    const brush = d3.brush<unknown>()
      .extent([[0, 0], [width * 4, height * 4]])
      .on("start", (event) => {
        // Only activate brush on shift-click; otherwise let zoom/drag handle it
        if (!event.sourceEvent?.shiftKey) {
          brushG.call(brush.move, null);
        }
      })
      .on("end", (event) => {
        const sel = event.selection as [[number, number], [number, number]] | null;
        if (!sel) return;
        const [[x0, y0], [x1, y1]] = sel;
        const selected = simNodes
          .filter((d) => {
            const nx = d.x ?? 0;
            const ny = d.y ?? 0;
            return nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1;
          })
          .map((d) => d.id);
        if (selected.length > 0) {
          onBoxSelect?.(selected);
        }
        // Clear brush rect after selection
        brushG.call(brush.move, null);
      });
    brushG.call(brush);
    // Make brush transparent so it doesn't block normal interactions
    brushG.select(".overlay").attr("pointer-events", "none");
    // Re-enable brush overlay only when shift is held
    const svgEl = svg;
    const enableBrush = (e: KeyboardEvent) => {
      if (e.key === "Shift") brushG.select(".overlay").attr("pointer-events", "all");
    };
    const disableBrush = (e: KeyboardEvent) => {
      if (e.key === "Shift") brushG.select(".overlay").attr("pointer-events", "none");
    };
    svgEl.ownerDocument.addEventListener("keydown", enableBrush);
    svgEl.ownerDocument.addEventListener("keyup", disableBrush);

    // Force simulation
    const simulation = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(100),
      )
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<SimNode>().radius((d) => d.radius + 4))
      .on("tick", () => {
        link
          .attr("x1", (d) => (d.source as SimNode).x ?? 0)
          .attr("y1", (d) => (d.source as SimNode).y ?? 0)
          .attr("x2", (d) => (d.target as SimNode).x ?? 0)
          .attr("y2", (d) => (d.target as SimNode).y ?? 0);

        node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      });

    simulationRef.current = simulation;

    // If there's a search match, zoom to the first matched node after simulation settles
    if (searchTerm) {
      const firstMatch = simNodes.find((n) => n.matched);
      if (firstMatch) {
        simulation.on("end", () => {
          const x = firstMatch.x ?? width / 2;
          const y = firstMatch.y ?? height / 2;
          const transform = d3.zoomIdentity.translate(width / 2 - x, height / 2 - y);
          root.transition().duration(500).call(zoom.transform, transform);
        });
      }
    }

    return () => {
      simulation.stop();
      simulationRef.current = null;
      svgEl.ownerDocument.removeEventListener("keydown", enableBrush);
      svgEl.ownerDocument.removeEventListener("keyup", disableBrush);
    };
  }, [simNodes, simLinks, searchTerm, handleClick, handleDblClick, onBoxSelect]);

  return (
    <svg
      ref={svgRef}
      className={`w-full h-full ${className}`}
      style={{ minHeight: 400 }}
      role="img"
      aria-label="Knowledge graph visualization"
    />
  );
}
