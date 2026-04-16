/**
 * 通用拓扑排序工具
 *
 * 使用 Kahn 算法（BFS）实现拓扑排序，支持：
 * - 循环依赖检测（抛出 CyclicDependencyError 并附带循环路径）
 * - 并行分组（同层可并行的节点归为一组）
 *
 * 适用于 MissionDependency 和 TaskDependency 的执行顺序计算。
 *
 * @module topo-sort
 * Requirements: 3.5, 4.5
 */

/** 有向边：from 依赖 to（to 必须先于 from 执行） */
export interface Edge {
  from: string;
  to: string;
}

/**
 * 循环依赖错误，包含检测到的循环路径。
 */
export class CyclicDependencyError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Cyclic dependency detected: ${cycle.join(" → ")}`);
    this.name = "CyclicDependencyError";
  }
}

/**
 * 对给定节点和边进行拓扑排序，返回并行分组。
 *
 * 每个内层数组是一组可以并行执行的节点（它们的所有依赖都已在前面的组中）。
 * 外层数组的顺序即为执行顺序。
 *
 * @param nodeIds - 所有节点 ID
 * @param edges   - 依赖边列表（from 依赖 to）
 * @returns 二维数组，每层为可并行执行的节点组
 * @throws {CyclicDependencyError} 当存在循环依赖时
 */
export function topoSortWithGroups(
  nodeIds: string[],
  edges: Edge[]
): string[][] {
  const nodeSet = new Set(nodeIds);

  // Build adjacency list (to → from[]) and in-degree map
  const adjacency = new Map<string, string[]>(); // to → [dependents]
  const inDegree = new Map<string, number>();

  const nodeArray = Array.from(nodeSet);

  for (const id of nodeArray) {
    adjacency.set(id, []);
    inDegree.set(id, 0);
  }

  for (const { from, to } of edges) {
    // Skip edges referencing nodes not in the node set
    if (!nodeSet.has(from) || !nodeSet.has(to)) continue;

    adjacency.get(to)!.push(from);
    inDegree.set(from, (inDegree.get(from) ?? 0) + 1);
  }

  // Kahn's algorithm with level grouping
  const groups: string[][] = [];
  let queue: string[] = [];

  // Seed with nodes that have no dependencies (in-degree 0)
  for (const id of nodeArray) {
    if (inDegree.get(id) === 0) {
      queue.push(id);
    }
  }

  let visited = 0;

  while (queue.length > 0) {
    // Sort for deterministic output
    queue.sort();
    groups.push([...queue]);
    visited += queue.length;

    const nextQueue: string[] = [];

    for (const node of queue) {
      for (const dependent of adjacency.get(node)!) {
        const newDeg = inDegree.get(dependent)! - 1;
        inDegree.set(dependent, newDeg);
        if (newDeg === 0) {
          nextQueue.push(dependent);
        }
      }
    }

    queue = nextQueue;
  }

  // If not all nodes were visited, there is a cycle
  if (visited < nodeSet.size) {
    const cyclePath = detectCycle(nodeSet, edges);
    throw new CyclicDependencyError(cyclePath);
  }

  return groups;
}

/**
 * Detect a cycle in the dependency graph using DFS and return the cycle path.
 * Only called when Kahn's algorithm confirms a cycle exists.
 */
function detectCycle(nodeSet: Set<string>, edges: Edge[]): string[] {
  const nodes = Array.from(nodeSet);

  // Build forward adjacency: from → to[] (from depends on to)
  const deps = new Map<string, string[]>();
  for (const id of nodes) {
    deps.set(id, []);
  }
  for (const { from, to } of edges) {
    if (!nodeSet.has(from) || !nodeSet.has(to)) continue;
    deps.get(from)!.push(to);
  }

  const WHITE = 0; // unvisited
  const GRAY = 1; // in current DFS path
  const BLACK = 2; // fully processed

  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();

  for (const id of nodes) {
    color.set(id, WHITE);
    parent.set(id, null);
  }

  for (const startNode of nodes) {
    if (color.get(startNode) !== WHITE) continue;

    const stack: string[] = [startNode];

    while (stack.length > 0) {
      const node = stack[stack.length - 1];

      if (color.get(node) === WHITE) {
        color.set(node, GRAY);
      }

      const neighbors = deps.get(node)!;
      let pushed = false;

      for (const neighbor of neighbors) {
        if (!nodeSet.has(neighbor)) continue;

        if (color.get(neighbor) === WHITE) {
          parent.set(neighbor, node);
          stack.push(neighbor);
          pushed = true;
          break;
        } else if (color.get(neighbor) === GRAY) {
          // Found a cycle — reconstruct path
          const cycle: string[] = [neighbor, node];
          let cur = node;
          while (cur !== neighbor) {
            cur = parent.get(cur)!;
            cycle.push(cur);
          }
          cycle.reverse();
          return cycle;
        }
      }

      if (!pushed) {
        color.set(node, BLACK);
        stack.pop();
      }
    }
  }

  // Fallback: should not reach here if Kahn's confirmed a cycle
  return ["unknown cycle"];
}
