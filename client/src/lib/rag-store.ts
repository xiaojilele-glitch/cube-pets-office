/**
 * RAG 前端状态管理（Zustand）
 *
 * 管理 RAG 数据获取、缓存、反馈提交状态。
 *
 * Requirements: 9.6
 */

import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types (mirrors shared/rag contracts for frontend use)
// ---------------------------------------------------------------------------

export interface RAGChunkInfo {
  content: string;
  sourceType: string;
  sourceId: string;
  score: number;
  status: "injected" | "pruned" | "below_threshold";
}

export interface RAGAugmentationLog {
  logId: string;
  taskId: string;
  agentId: string;
  projectId: string;
  mode: "auto" | "on_demand" | "disabled";
  retrievedChunkIds: string[];
  injectedChunkIds: string[];
  prunedChunkIds: string[];
  tokenUsage: number;
  latencyMs: number;
  timestamp: string;
}

export interface RAGTaskData {
  logs: RAGAugmentationLog[];
}

interface RAGFeedbackPayload {
  taskId: string;
  agentId: string;
  projectId?: string;
  helpfulChunkIds?: string[];
  irrelevantChunkIds?: string[];
  missingContext?: string;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface RAGStoreState {
  /** Cached RAG data per taskId */
  taskData: Record<string, RAGTaskData>;
  /** Loading state per taskId */
  loading: Record<string, boolean>;
  /** Error state per taskId */
  errors: Record<string, string | null>;
  /** Feedback submission state */
  feedbackSubmitting: boolean;
  feedbackError: string | null;

  /** Fetch RAG data for a task */
  fetchTaskRAG: (workflowId: string, taskId: string) => Promise<void>;
  /** Submit feedback */
  submitFeedback: (feedback: RAGFeedbackPayload) => Promise<void>;
  /** Clear cached data */
  clearCache: () => void;
}

export const useRAGStore = create<RAGStoreState>((set, get) => ({
  taskData: {},
  loading: {},
  errors: {},
  feedbackSubmitting: false,
  feedbackError: null,

  fetchTaskRAG: async (workflowId: string, taskId: string) => {
    const state = get();
    if (state.loading[taskId]) return;

    set({
      loading: { ...state.loading, [taskId]: true },
      errors: { ...state.errors, [taskId]: null },
    });

    try {
      const res = await fetch(`/api/rag/task-rag/${taskId}`);
      if (!res.ok) throw new Error(`Failed to fetch RAG data: ${res.status}`);
      const data: RAGTaskData = await res.json();
      set(s => ({
        taskData: { ...s.taskData, [taskId]: data },
        loading: { ...s.loading, [taskId]: false },
      }));
    } catch (err) {
      set(s => ({
        loading: { ...s.loading, [taskId]: false },
        errors: { ...s.errors, [taskId]: String(err) },
      }));
    }
  },

  submitFeedback: async (feedback: RAGFeedbackPayload) => {
    set({ feedbackSubmitting: true, feedbackError: null });
    try {
      const res = await fetch("/api/rag/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(feedback),
      });
      if (!res.ok) throw new Error(`Feedback submission failed: ${res.status}`);
      set({ feedbackSubmitting: false });
    } catch (err) {
      set({ feedbackSubmitting: false, feedbackError: String(err) });
    }
  },

  clearCache: () => set({ taskData: {}, loading: {}, errors: {} }),
}));
