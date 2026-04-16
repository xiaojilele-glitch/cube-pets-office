import type {
  ExecutionEvent,
  LineageNode,
  LineageEdge,
  LineageGraph,
} from "../../../../shared/replay/contracts";

/* ─── Local Types ─── */

/** A chain of lineage nodes from source to target. */
export interface LineageChain {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

/** A data source referenced by a decision. */
export interface DataSource {
  node: LineageNode;
  inputKey: string;
}

/** A record of data changing across events. */
export interface DataChange {
  eventId: string;
  agentId: string;
  timestamp: number;
  dataKey: string;
}

/* ─── Helpers ─── */

/**
 * Extract data keys produced by an event (outputs).
 * Heuristic: keys from executionOutput.returnValue, decisionResult, or accessResult.dataSummary.
 */
function extractOutputKeys(event: ExecutionEvent): string[] {
  const data = event.eventData as Record<string, unknown>;
  const keys: string[] = [];

  // CODE_EXECUTED → output keys from executionOutput
  if (event.eventType === "CODE_EXECUTED" && data.executionOutput) {
    keys.push(`code-output:${event.eventId}`);
  }

  // DECISION_MADE → decision result as a data key
  if (
    event.eventType === "DECISION_MADE" &&
    data.decisionResult !== undefined
  ) {
    keys.push(`decision:${data.decisionId ?? event.eventId}`);
  }

  // RESOURCE_ACCESSED → resource data
  if (event.eventType === "RESOURCE_ACCESSED" && data.resourceId) {
    keys.push(`resource:${data.resourceId}`);
  }

  // MESSAGE_SENT / MESSAGE_RECEIVED → message data
  if (
    (event.eventType === "MESSAGE_SENT" ||
      event.eventType === "MESSAGE_RECEIVED") &&
    data.messageId
  ) {
    keys.push(`message:${data.messageId}`);
  }

  return keys;
}

/**
 * Extract data keys consumed by an event (inputs).
 */
function extractInputKeys(event: ExecutionEvent): string[] {
  const data = event.eventData as Record<string, unknown>;
  const keys: string[] = [];

  // DECISION_MADE → input keys from decisionInput
  if (event.eventType === "DECISION_MADE" && data.decisionInput) {
    const input = data.decisionInput as Record<string, unknown>;
    for (const k of Object.keys(input)) {
      keys.push(k);
    }
  }

  // CODE_EXECUTED → input keys from executionInput
  if (event.eventType === "CODE_EXECUTED" && data.executionInput) {
    const input = data.executionInput as Record<string, unknown>;
    for (const k of Object.keys(input)) {
      keys.push(k);
    }
  }

  return keys;
}

/**
 * DataLineageTracker — 数据血缘追踪
 *
 * 从事件流构建数据血缘有向图，支持追溯数据点的完整链路、
 * 决策依赖的数据源和数据变更历史。
 */
export class DataLineageTracker {
  private graph: LineageGraph = { nodes: [], edges: [] };
  private nodesByDataKey = new Map<string, LineageNode[]>();
  private nodesById = new Map<string, LineageNode>();
  private nodesByEventId = new Map<string, LineageNode[]>();

  /**
   * 从事件流构建血缘有向图。
   * 每个产生数据的事件创建一个 LineageNode，
   * 当一个事件的输入 key 匹配另一个事件的输出 key 时创建 LineageEdge。
   */
  buildLineageGraph(events: ExecutionEvent[]): LineageGraph {
    const nodes: LineageNode[] = [];
    const edges: LineageEdge[] = [];
    const nodesByDataKey = new Map<string, LineageNode[]>();
    const nodesById = new Map<string, LineageNode>();
    const nodesByEventId = new Map<string, LineageNode[]>();

    // Phase 1: Create nodes for each output key of each event
    for (const event of events) {
      const outputKeys = extractOutputKeys(event);
      for (const dataKey of outputKeys) {
        const node: LineageNode = {
          id: `${event.eventId}:${dataKey}`,
          eventId: event.eventId,
          agentId: event.sourceAgent,
          dataKey,
          timestamp: event.timestamp,
        };
        nodes.push(node);
        nodesById.set(node.id, node);

        const existing = nodesByDataKey.get(dataKey) ?? [];
        existing.push(node);
        nodesByDataKey.set(dataKey, existing);

        const byEvent = nodesByEventId.get(event.eventId) ?? [];
        byEvent.push(node);
        nodesByEventId.set(event.eventId, byEvent);
      }
    }

    // Phase 2: Create edges — connect input keys to matching output nodes
    for (const event of events) {
      const inputKeys = extractInputKeys(event);
      const consumerNodes = nodesByEventId.get(event.eventId) ?? [];

      for (const inputKey of inputKeys) {
        // Find producer nodes whose dataKey matches this input key
        const producers = nodesByDataKey.get(inputKey) ?? [];
        for (const producer of producers) {
          // Only link if producer happened before consumer
          if (producer.timestamp >= event.timestamp) continue;
          // Link to each consumer node of this event
          for (const consumer of consumerNodes) {
            edges.push({
              from: producer.id,
              to: consumer.id,
              transformType:
                producer.agentId === event.sourceAgent
                  ? "pass-through"
                  : "transform",
            });
          }
        }
      }
    }

    this.graph = { nodes, edges };
    this.nodesByDataKey = nodesByDataKey;
    this.nodesById = nodesById;
    this.nodesByEventId = nodesByEventId;

    return this.graph;
  }

  /**
   * 追溯数据点的完整血缘链路。
   * 从目标节点沿 edges 反向遍历，返回从源头到目标的完整路径。
   */
  traceDataPoint(nodeId: string): LineageChain {
    const visited = new Set<string>();
    const chainNodes: LineageNode[] = [];
    const chainEdges: LineageEdge[] = [];

    const walk = (currentId: string) => {
      if (visited.has(currentId)) return;
      visited.add(currentId);

      const node = this.nodesById.get(currentId);
      if (!node) return;

      // Find all edges pointing TO this node (incoming)
      const incoming = this.graph.edges.filter(e => e.to === currentId);
      for (const edge of incoming) {
        walk(edge.from);
        chainEdges.push(edge);
      }

      chainNodes.push(node);
    };

    walk(nodeId);

    // Sort by timestamp for a logical ordering
    chainNodes.sort((a, b) => a.timestamp - b.timestamp);

    return { nodes: chainNodes, edges: chainEdges };
  }

  /**
   * 追溯决策依赖的所有数据源。
   * 查找 DECISION_MADE 事件对应的节点，然后找到所有直接输入节点。
   */
  traceDecisionInputs(decisionEventId: string): DataSource[] {
    const sources: DataSource[] = [];
    const consumerNodes = this.nodesByEventId.get(decisionEventId) ?? [];

    for (const consumer of consumerNodes) {
      // Find all edges pointing to this consumer node
      const incoming = this.graph.edges.filter(e => e.to === consumer.id);
      for (const edge of incoming) {
        const sourceNode = this.nodesById.get(edge.from);
        if (sourceNode) {
          sources.push({
            node: sourceNode,
            inputKey: sourceNode.dataKey,
          });
        }
      }
    }

    return sources;
  }

  /**
   * 获取数据变更历史。
   * 查找所有修改同一 dataKey 的事件，按时间排序。
   */
  getDataChanges(dataKey: string): DataChange[] {
    const nodes = this.nodesByDataKey.get(dataKey) ?? [];

    return nodes
      .map(n => ({
        eventId: n.eventId,
        agentId: n.agentId,
        timestamp: n.timestamp,
        dataKey: n.dataKey,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }
}
