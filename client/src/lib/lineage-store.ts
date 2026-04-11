import { create } from "zustand";
import type { Socket } from "socket.io-client";

import type {
  ChangeAlert,
  DataLineageNode,
  ImpactAnalysisResult,
  LineageEdge,
  LineageFilters,
  LineageGraph,
} from "@shared/lineage/contracts.js";
import { LINEAGE_SOCKET_EVENTS } from "@shared/lineage/socket.js";
import type {
  LineageAlertTriggeredPayload,
  LineageNodeCreatedPayload,
} from "@shared/lineage/socket.js";

import { fetchJsonSafe, type ApiRequestError } from "./api-client";

const DEFAULT_FILTERS: LineageFilters = {};
const DEFAULT_RECENT_LIMIT = 120;

type LineageRequest =
  | { type: "recent"; limit: number }
  | { type: "upstream"; dataId: string; depth?: number }
  | { type: "downstream"; dataId: string; depth?: number }
  | { type: "path"; sourceId: string; decisionId: string }
  | { type: "impact"; dataId: string };

interface LineageListResponse {
  ok?: boolean;
  nodes?: DataLineageNode[];
}

interface LineageGraphResponse {
  ok?: boolean;
  graph?: LineageGraph;
}

interface LineageImpactResponse {
  ok?: boolean;
  result?: ImpactAnalysisResult;
}

export interface LineageState {
  graph: LineageGraph | null;
  selectedNodeId: string | null;
  filters: LineageFilters;
  loading: boolean;
  hasLoaded: boolean;
  error: ApiRequestError | null;
  impactResult: ImpactAnalysisResult | null;
  alerts: ChangeAlert[];
  lastRequest: LineageRequest | null;

  fetchRecentGraph(limit?: number): Promise<void>;
  fetchUpstream(dataId: string, depth?: number): Promise<void>;
  fetchDownstream(dataId: string, depth?: number): Promise<void>;
  fetchFullPath(sourceId: string, decisionId: string): Promise<void>;
  fetchImpactAnalysis(dataId: string): Promise<void>;
  retryLastRequest(): Promise<void>;
  selectNode(nodeId: string | null): void;
  setFilters(filters: Partial<LineageFilters>): void;
  resetFilters(): void;
  initSocket(socket: Socket): void;
}

function buildGraphFromNodes(nodes: DataLineageNode[]): LineageGraph {
  const edges: LineageEdge[] = [];
  const knownIds = new Set(nodes.map(node => node.lineageId));
  const seenEdges = new Set<string>();

  const pushEdge = (
    fromId: string,
    toId: string,
    type: LineageEdge["type"],
    timestamp: number
  ) => {
    if (!knownIds.has(fromId) || !knownIds.has(toId) || fromId === toId) return;

    const edgeKey = `${fromId}:${toId}:${type}`;
    if (seenEdges.has(edgeKey)) return;

    seenEdges.add(edgeKey);
    edges.push({ fromId, toId, type, timestamp });
  };

  for (const node of nodes) {
    const upstreamIds = [
      ...(node.upstream ?? []),
      ...(node.inputLineageIds ?? []),
    ];
    upstreamIds.forEach(upstreamId =>
      pushEdge(upstreamId, node.lineageId, "input-to", node.timestamp)
    );

    if (node.outputLineageId) {
      pushEdge(
        node.lineageId,
        node.outputLineageId,
        "produced-by",
        node.timestamp
      );
    }
  }

  return { nodes, edges };
}

function matchesSearch(
  node: DataLineageNode,
  searchText: string | undefined
): boolean {
  if (!searchText?.trim()) return true;

  const normalized = searchText.trim().toLowerCase();
  const haystacks = [
    node.lineageId,
    node.sourceId,
    node.sourceName,
    node.agentId,
    node.decisionId,
    node.operation,
    node.result,
  ];

  return haystacks.some(
    value =>
      typeof value === "string" && value.toLowerCase().includes(normalized)
  );
}

function filterNodes(
  nodes: DataLineageNode[],
  filters: LineageFilters
): DataLineageNode[] {
  return nodes.filter(node => {
    if (filters.nodeType && node.type !== filters.nodeType) return false;
    if (filters.agentId && node.agentId !== filters.agentId) return false;
    if (!matchesSearch(node, filters.searchText)) return false;
    return true;
  });
}

async function runGraphRequest(
  request: LineageRequest,
  set: (
    partial:
      | Partial<LineageState>
      | ((state: LineageState) => Partial<LineageState>)
  ) => void,
  get: () => LineageState
): Promise<void> {
  set({ loading: true, error: null, lastRequest: request });

  try {
    if (request.type === "recent") {
      const params = new URLSearchParams({ limit: String(request.limit) });
      const { filters } = get();
      if (filters.nodeType) params.set("type", filters.nodeType);
      if (filters.agentId) params.set("agentId", filters.agentId);

      const result = await fetchJsonSafe<LineageListResponse>(
        `/api/lineage?${params.toString()}`
      );
      if (!result.ok) {
        set({ error: result.error, hasLoaded: true, graph: null });
        return;
      }

      const filteredNodes = filterNodes(result.data.nodes ?? [], filters);
      set({
        graph: buildGraphFromNodes(filteredNodes),
        hasLoaded: true,
        error: null,
      });
      return;
    }

    if (request.type === "impact") {
      const result = await fetchJsonSafe<LineageImpactResponse>(
        `/api/lineage/${encodeURIComponent(request.dataId)}/impact`
      );
      if (!result.ok) {
        set({ error: result.error, hasLoaded: true });
        return;
      }

      set({
        impactResult: result.data.result ?? null,
        hasLoaded: true,
        error: null,
      });
      return;
    }

    let endpoint = "";
    if (request.type === "upstream") {
      const params = new URLSearchParams();
      if (request.depth !== undefined)
        params.set("depth", String(request.depth));
      endpoint = `/api/lineage/${encodeURIComponent(request.dataId)}/upstream?${params.toString()}`;
    } else if (request.type === "downstream") {
      const params = new URLSearchParams();
      if (request.depth !== undefined)
        params.set("depth", String(request.depth));
      endpoint = `/api/lineage/${encodeURIComponent(request.dataId)}/downstream?${params.toString()}`;
    } else {
      const params = new URLSearchParams({
        sourceId: request.sourceId,
        decisionId: request.decisionId,
      });
      endpoint = `/api/lineage/path?${params.toString()}`;
    }

    const result = await fetchJsonSafe<LineageGraphResponse>(endpoint);
    if (!result.ok) {
      set({ error: result.error, hasLoaded: true });
      return;
    }

    set({
      graph: result.data.graph ?? null,
      hasLoaded: true,
      error: null,
    });
  } finally {
    set({ loading: false });
  }
}

export const useLineageStore = create<LineageState>((set, get) => ({
  graph: null,
  selectedNodeId: null,
  filters: { ...DEFAULT_FILTERS },
  loading: false,
  hasLoaded: false,
  error: null,
  impactResult: null,
  alerts: [],
  lastRequest: null,

  fetchRecentGraph: async (limit = DEFAULT_RECENT_LIMIT) => {
    await runGraphRequest({ type: "recent", limit }, set, get);
  },

  fetchUpstream: async (dataId: string, depth?: number) => {
    await runGraphRequest({ type: "upstream", dataId, depth }, set, get);
  },

  fetchDownstream: async (dataId: string, depth?: number) => {
    await runGraphRequest({ type: "downstream", dataId, depth }, set, get);
  },

  fetchFullPath: async (sourceId: string, decisionId: string) => {
    await runGraphRequest({ type: "path", sourceId, decisionId }, set, get);
  },

  fetchImpactAnalysis: async (dataId: string) => {
    await runGraphRequest({ type: "impact", dataId }, set, get);
  },

  retryLastRequest: async () => {
    const { lastRequest } = get();
    if (!lastRequest) {
      await get().fetchRecentGraph();
      return;
    }

    await runGraphRequest(lastRequest, set, get);
  },

  selectNode: (nodeId: string | null) => set({ selectedNodeId: nodeId }),

  setFilters: (filters: Partial<LineageFilters>) =>
    set(state => ({ filters: { ...state.filters, ...filters } })),

  resetFilters: () => set({ filters: { ...DEFAULT_FILTERS } }),

  initSocket: (socket: Socket) => {
    socket.on(
      LINEAGE_SOCKET_EVENTS.nodeCreated,
      (payload: LineageNodeCreatedPayload) => {
        const { graph } = get();
        if (!graph) return;

        const exists = graph.nodes.some(
          node => node.lineageId === payload.node.lineageId
        );
        if (exists) return;

        const nextNodes = [...graph.nodes, payload.node];
        set({
          graph: buildGraphFromNodes(nextNodes),
        });
      }
    );

    socket.on(
      LINEAGE_SOCKET_EVENTS.alertTriggered,
      (payload: LineageAlertTriggeredPayload) => {
        set(state => ({ alerts: [payload.alert, ...state.alerts] }));
      }
    );
  },
}));
