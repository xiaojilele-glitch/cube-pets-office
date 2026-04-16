import { describe, expect, it } from "vitest";

import {
  topoSortWithGroups,
  CyclicDependencyError,
} from "../../core/nl-command/topo-sort.js";
import type { Edge } from "../../core/nl-command/topo-sort.js";

describe("topoSortWithGroups", () => {
  it("should return a single group for nodes with no edges", () => {
    const result = topoSortWithGroups(["a", "b", "c"], []);
    expect(result).toEqual([["a", "b", "c"]]);
  });

  it("should return empty array for empty input", () => {
    const result = topoSortWithGroups([], []);
    expect(result).toEqual([]);
  });

  it("should handle a single node", () => {
    const result = topoSortWithGroups(["a"], []);
    expect(result).toEqual([["a"]]);
  });

  it("should produce correct linear ordering for a chain", () => {
    // a → b → c  (a depends on b, b depends on c)
    const edges: Edge[] = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];
    const result = topoSortWithGroups(["a", "b", "c"], edges);
    expect(result).toEqual([["c"], ["b"], ["a"]]);
  });

  it("should group independent nodes at the same level", () => {
    // a depends on c, b depends on c → c first, then a and b in parallel
    const edges: Edge[] = [
      { from: "a", to: "c" },
      { from: "b", to: "c" },
    ];
    const result = topoSortWithGroups(["a", "b", "c"], edges);
    expect(result).toEqual([["c"], ["a", "b"]]);
  });

  it("should handle diamond dependency pattern", () => {
    //   a
    //  / \
    // b   c
    //  \ /
    //   d
    const edges: Edge[] = [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "b", to: "d" },
      { from: "c", to: "d" },
    ];
    const result = topoSortWithGroups(["a", "b", "c", "d"], edges);
    expect(result).toEqual([["d"], ["b", "c"], ["a"]]);
  });

  it("should handle complex multi-level dependencies", () => {
    // e depends on c, d
    // c depends on a
    // d depends on b
    // a, b are independent roots
    const edges: Edge[] = [
      { from: "c", to: "a" },
      { from: "d", to: "b" },
      { from: "e", to: "c" },
      { from: "e", to: "d" },
    ];
    const result = topoSortWithGroups(["a", "b", "c", "d", "e"], edges);
    expect(result).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("should ignore edges referencing unknown nodes", () => {
    const edges: Edge[] = [
      { from: "a", to: "b" },
      { from: "a", to: "unknown" }, // unknown not in nodeIds
    ];
    const result = topoSortWithGroups(["a", "b"], edges);
    expect(result).toEqual([["b"], ["a"]]);
  });

  it("should deduplicate node IDs", () => {
    const result = topoSortWithGroups(["a", "a", "b"], []);
    expect(result).toEqual([["a", "b"]]);
  });

  // --- Cycle detection ---

  it("should throw CyclicDependencyError for a simple 2-node cycle", () => {
    const edges: Edge[] = [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ];
    expect(() => topoSortWithGroups(["a", "b"], edges)).toThrow(
      CyclicDependencyError
    );
  });

  it("should throw CyclicDependencyError for a 3-node cycle", () => {
    const edges: Edge[] = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "a" },
    ];
    try {
      topoSortWithGroups(["a", "b", "c"], edges);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CyclicDependencyError);
      const cycleErr = err as CyclicDependencyError;
      // The cycle should contain all 3 nodes
      expect(cycleErr.cycle.length).toBeGreaterThanOrEqual(3);
      expect(new Set(cycleErr.cycle)).toContain("a");
      expect(new Set(cycleErr.cycle)).toContain("b");
      expect(new Set(cycleErr.cycle)).toContain("c");
    }
  });

  it("should throw CyclicDependencyError with cycle path for self-loop", () => {
    const edges: Edge[] = [{ from: "a", to: "a" }];
    expect(() => topoSortWithGroups(["a"], edges)).toThrow(
      CyclicDependencyError
    );
  });

  it("should throw CyclicDependencyError when cycle exists among some nodes", () => {
    // d is independent, but a→b→c→a forms a cycle
    const edges: Edge[] = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "a" },
    ];
    expect(() => topoSortWithGroups(["a", "b", "c", "d"], edges)).toThrow(
      CyclicDependencyError
    );
  });

  // --- Respects dependency ordering ---

  it("should ensure every dependency appears in an earlier group", () => {
    const edges: Edge[] = [
      { from: "task-3", to: "task-1" },
      { from: "task-3", to: "task-2" },
      { from: "task-2", to: "task-1" },
    ];
    const result = topoSortWithGroups(["task-1", "task-2", "task-3"], edges);

    // Build a level map
    const levelOf = new Map<string, number>();
    for (let i = 0; i < result.length; i++) {
      for (const node of result[i]) {
        levelOf.set(node, i);
      }
    }

    // For every edge, "to" must be at a strictly earlier level than "from"
    for (const { from, to } of edges) {
      expect(levelOf.get(to)!).toBeLessThan(levelOf.get(from)!);
    }
  });
});
