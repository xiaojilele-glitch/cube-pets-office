/**
 * Knowledge graph Zustand store.
 *
 * Manages graph data (nodes/edges), filter state, review queue, and entity
 * selection. Integrates with Socket.IO for real-time knowledge.entityChanged
 * events and REST API for data loading and review actions.
 *
 * @see Requirements 9.6
 */

import { create } from "zustand";
import type { Socket } from "socket.io-client";

import type { Entity, Relation, ReviewAction } from "@shared/knowledge/types";
import { KNOWLEDGE_API } from "@shared/knowledge/api";
import type {
  GetKnowledgeGraphResponse,
  GetReviewQueueResponse,
  GetReviewQueueQuery,
  PostReviewResponse,
} from "@shared/knowledge/api";

import {
  type KnowledgeFilterState,
  createDefaultFilterState,
} from "../components/knowledge/KnowledgeFilters";

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface KnowledgeState {
  nodes: Entity[];
  edges: Relation[];
  filters: KnowledgeFilterState;
  reviewQueue: Entity[];
  selectedEntity: Entity | null;
  loading: boolean;

  fetchGraph: (projectId: string) => Promise<void>;
  fetchReviewQueue: (filters?: GetReviewQueueQuery) => Promise<void>;
  setFilters: (filters: KnowledgeFilterState) => void;
  selectEntity: (entity: Entity | null) => void;
  reviewEntity: (entityId: string, action: ReviewAction) => Promise<void>;
  subscribeToChanges: (socket: Socket) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  nodes: [],
  edges: [],
  filters: createDefaultFilterState(),
  reviewQueue: [],
  selectedEntity: null,
  loading: false,

  fetchGraph: async (projectId: string) => {
    set({ loading: true });
    try {
      const url = `${KNOWLEDGE_API.graph}?projectId=${encodeURIComponent(projectId)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data: GetKnowledgeGraphResponse = await res.json();
        set({ nodes: data.nodes, edges: data.edges });
      }
    } catch {
      // Network error — keep current state
    } finally {
      set({ loading: false });
    }
  },

  fetchReviewQueue: async (filters?: GetReviewQueueQuery) => {
    try {
      const params = new URLSearchParams();
      if (filters?.projectId) params.set("projectId", filters.projectId);
      if (filters?.entityType) params.set("entityType", filters.entityType);
      if (filters?.sortBy) params.set("sortBy", filters.sortBy);

      const qs = params.toString();
      const url = qs
        ? `${KNOWLEDGE_API.reviewQueue}?${qs}`
        : KNOWLEDGE_API.reviewQueue;

      const res = await fetch(url);
      if (res.ok) {
        const data: GetReviewQueueResponse = await res.json();
        set({ reviewQueue: data.items });
      }
    } catch {
      // Network error — keep current state
    }
  },

  setFilters: (filters: KnowledgeFilterState) => {
    set({ filters });
  },

  selectEntity: (entity: Entity | null) => {
    set({ selectedEntity: entity });
  },

  reviewEntity: async (entityId: string, action: ReviewAction) => {
    const url = KNOWLEDGE_API.review.replace(":entityId", entityId);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(
        (data as { error?: string }).error ??
          `Review failed (${res.status})`,
      );
    }

    const { entity }: PostReviewResponse = await res.json();

    // Update the entity in nodes list if present
    set((s) => ({
      nodes: s.nodes.map((n) => (n.entityId === entity.entityId ? entity : n)),
      reviewQueue: s.reviewQueue.filter((e) => e.entityId !== entityId),
      selectedEntity:
        s.selectedEntity?.entityId === entityId ? entity : s.selectedEntity,
    }));
  },

  subscribeToChanges: (socket: Socket) => {
    socket.on(
      "knowledge.entityChanged",
      (payload: { entity: Entity; action: "created" | "updated" | "deleted" }) => {
        const { entity, action } = payload;

        set((s) => {
          let nodes = s.nodes;

          if (action === "created") {
            nodes = [...nodes, entity];
          } else if (action === "updated") {
            nodes = nodes.map((n) =>
              n.entityId === entity.entityId ? entity : n,
            );
          } else if (action === "deleted") {
            nodes = nodes.filter((n) => n.entityId !== entity.entityId);
          }

          // Keep selectedEntity in sync
          const selectedEntity =
            s.selectedEntity?.entityId === entity.entityId
              ? action === "deleted"
                ? null
                : entity
              : s.selectedEntity;

          return { nodes, selectedEntity };
        });
      },
    );
  },
}));
