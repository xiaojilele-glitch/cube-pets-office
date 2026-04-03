// Feature: nl-command-center, Property 6: decomposition execution order topological sort correctness
// **Validates: Requirements 3.4, 3.5, 4.4, 4.5**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { topoSortWithGroups, CyclicDependencyError } from '../../core/nl-command/topo-sort.js';
import type { Edge } from '../../core/nl-command/topo-sort.js';

// --- Generators ---

/**
 * Generate a random DAG (directed acyclic graph).
 * Strategy: assign each node an integer "level". Edges only go from higher-level
 * nodes to lower-level nodes, which guarantees acyclicity.
 */
const dagArb = (minNodes = 1, maxNodes = 12): fc.Arbitrary<{ nodeIds: string[]; edges: Edge[] }> =>
  fc.integer({ min: minNodes, max: maxNodes }).chain((n) => {
    const nodeIds = Array.from({ length: n }, (_, i) => `node-${i}`);
    // Assign each node a random level (0..n-1) to enforce acyclicity
    return fc.tuple(
      fc.constant(nodeIds),
      fc.array(fc.nat({ max: n - 1 }), { minLength: n, maxLength: n }),
    ).chain(([ids, levels]) => {
      // Generate random edges: from depends on to, where level[from] > level[to]
      const possibleEdges: Array<{ from: string; to: string; fromLevel: number; toLevel: number }> = [];
      for (let i = 0; i < ids.length; i++) {
        for (let j = 0; j < ids.length; j++) {
          if (i !== j && levels[i] > levels[j]) {
            possibleEdges.push({ from: ids[i], to: ids[j], fromLevel: levels[i], toLevel: levels[j] });
          }
        }
      }
      return fc.subarray(possibleEdges, { minLength: 0 }).map((selected) => ({
        nodeIds: ids,
        edges: selected.map(({ from, to }) => ({ from, to })),
      }));
    });
  });

/**
 * Generate a graph that contains at least one cycle.
 */
const cyclicGraphArb: fc.Arbitrary<{ nodeIds: string[]; edges: Edge[] }> =
  fc.integer({ min: 2, max: 8 }).chain((n) => {
    const nodeIds = Array.from({ length: n }, (_, i) => `c-${i}`);
    // Create a guaranteed cycle: 0 -> 1 -> ... -> n-1 -> 0
    const cycleEdges: Edge[] = nodeIds.map((_, i) => ({
      from: nodeIds[i],
      to: nodeIds[(i + 1) % n],
    }));
    return fc.constant({ nodeIds, edges: cycleEdges });
  });

// --- Tests ---

describe('Property 6: decomposition execution order topological sort correctness', () => {
  it('for any DAG, executionOrder SHALL be a valid topological ordering: for every edge (A depends on B), B appears in an earlier or same group as A', () => {
    fc.assert(
      fc.property(dagArb(), ({ nodeIds, edges }) => {
        const groups = topoSortWithGroups(nodeIds, edges);

        // Build a map: nodeId -> group index
        const groupIndex = new Map<string, number>();
        for (let g = 0; g < groups.length; g++) {
          for (const id of groups[g]) {
            groupIndex.set(id, g);
          }
        }

        // Every node must appear in exactly one group
        const allNodes = groups.flat();
        expect(allNodes.length).toBe(nodeIds.length);
        expect(new Set(allNodes).size).toBe(nodeIds.length);

        // For every edge (from depends on to), to must be in an earlier or same group
        for (const { from, to } of edges) {
          const fromGroup = groupIndex.get(from);
          const toGroup = groupIndex.get(to);
          expect(fromGroup).toBeDefined();
          expect(toGroup).toBeDefined();
          expect(toGroup!).toBeLessThanOrEqual(fromGroup!);
        }
      }),
      { numRuns: 20 },
    );
  });

  it('for any DAG, all dependency references SHALL point to valid entity IDs within the decomposition', () => {
    fc.assert(
      fc.property(dagArb(), ({ nodeIds, edges }) => {
        const groups = topoSortWithGroups(nodeIds, edges);
        const allOutputIds = new Set(groups.flat());
        const inputIds = new Set(nodeIds);

        // All output IDs are valid input IDs
        for (const id of allOutputIds) {
          expect(inputIds.has(id)).toBe(true);
        }

        // All edge references are valid IDs
        for (const { from, to } of edges) {
          expect(inputIds.has(from)).toBe(true);
          expect(inputIds.has(to)).toBe(true);
        }
      }),
      { numRuns: 20 },
    );
  });

  it('for any DAG, nodes with no dependencies SHALL appear in the first group', () => {
    fc.assert(
      fc.property(dagArb(), ({ nodeIds, edges }) => {
        const groups = topoSortWithGroups(nodeIds, edges);
        if (groups.length === 0) return;

        // Nodes that have no incoming edges (no dependency)
        const dependents = new Set(edges.map((e) => e.from));
        const roots = nodeIds.filter((id) => !dependents.has(id));

        const firstGroup = new Set(groups[0]);
        for (const root of roots) {
          expect(firstGroup.has(root)).toBe(true);
        }
      }),
      { numRuns: 20 },
    );
  });

  it('for any DAG with no edges, all nodes SHALL be in a single group', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }).map((n) => Array.from({ length: n }, (_, i) => `iso-${i}`)),
        (nodeIds) => {
          const groups = topoSortWithGroups(nodeIds, []);
          expect(groups.length).toBe(1);
          expect(groups[0].sort()).toEqual([...nodeIds].sort());
        },
      ),
      { numRuns: 20 },
    );
  });

  it('for any cyclic graph, topoSortWithGroups SHALL throw CyclicDependencyError', () => {
    fc.assert(
      fc.property(cyclicGraphArb, ({ nodeIds, edges }) => {
        expect(() => topoSortWithGroups(nodeIds, edges)).toThrow(CyclicDependencyError);
      }),
      { numRuns: 20 },
    );
  });

  it('for any DAG, the execution order SHALL maximize parallelism (group count equals longest path + 1)', () => {
    fc.assert(
      fc.property(dagArb(1, 8), ({ nodeIds, edges }) => {
        const groups = topoSortWithGroups(nodeIds, edges);

        // Compute the longest path in the DAG using dynamic programming
        // longestPath[node] = length of longest path ending at node
        const longestPath = new Map<string, number>();
        for (const id of nodeIds) {
          longestPath.set(id, 0);
        }

        // Process in topological order (which we already have from groups)
        for (const group of groups) {
          for (const node of group) {
            // For each dependent of this node, update their longest path
            for (const { from, to } of edges) {
              if (to === node) {
                const newLen = longestPath.get(node)! + 1;
                if (newLen > longestPath.get(from)!) {
                  longestPath.set(from, newLen);
                }
              }
            }
          }
        }

        const maxPath = Math.max(0, ...longestPath.values());
        // Number of groups should equal longest path + 1
        expect(groups.length).toBe(maxPath + 1);
      }),
      { numRuns: 20 },
    );
  });
});
