/**
 * RAGPipeline — 增强生成管道
 *
 * 串联：RAGRetriever.search → Reranker.rerank → TokenBudgetManager.allocate
 *       → 组装 ragContext → AugmentationLogger.log
 *
 * 支持 auto/on_demand/disabled 三种注入模式。
 *
 * Requirements: 5.1, 5.4, 5.5
 */

import type {
  RetrievalResult,
  SourceType,
  RAGAugmentationLog,
} from "../../../shared/rag/contracts.js";
import type { RAGRetriever } from "../retrieval/rag-retriever.js";
import type { Reranker } from "./reranker.js";
import type { AugmentationLogger } from "./augmentation-logger.js";
import {
  TokenBudgetManager,
  type BudgetedChunk,
} from "./token-budget-manager.js";
import { getRAGConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskContext {
  taskId: string;
  projectId: string;
  directive: string;
  stage?: string;
}

export interface AgentContext {
  agentId: string;
  role: string;
  capabilities?: string[];
}

export interface RAGContext {
  mode: "auto" | "on_demand" | "disabled";
  chunks: Array<{
    content: string;
    sourceType: SourceType;
    sourceId: string;
    score: number;
    status: "injected" | "pruned" | "below_threshold";
  }>;
  totalTokens: number;
  retrievalLatencyMs: number;
}

export interface AugmentationResult {
  ragContext: RAGContext;
  retrievedChunks: RetrievalResult[];
  injectedChunks: RetrievalResult[];
  prunedChunks: RetrievalResult[];
  belowThresholdChunks: RetrievalResult[];
  tokenUsage: number;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// RAGPipeline
// ---------------------------------------------------------------------------

export interface RAGPipelineDeps {
  retriever: RAGRetriever;
  reranker: Reranker;
  augmentationLogger: AugmentationLogger;
  tokenBudgetManager?: TokenBudgetManager;
}

export class RAGPipeline {
  private readonly deps: RAGPipelineDeps;
  private readonly budgetManager: TokenBudgetManager;

  constructor(deps: RAGPipelineDeps) {
    this.deps = deps;
    const config = getRAGConfig();
    this.budgetManager =
      deps.tokenBudgetManager ??
      new TokenBudgetManager(config.augmentation.tokenBudget);
  }

  async augment(
    task: TaskContext,
    agent: AgentContext
  ): Promise<AugmentationResult> {
    const start = Date.now();
    const config = getRAGConfig();
    const mode = config.augmentation.mode;

    // disabled mode → empty result
    if (mode === "disabled") {
      return this.emptyResult(mode, Date.now() - start);
    }

    // on_demand mode → only augment if directive contains RAG trigger
    if (mode === "on_demand" && !this.shouldAugment(task.directive)) {
      return this.emptyResult(mode, Date.now() - start);
    }

    // Retrieve
    const retrievalStart = Date.now();
    let retrieved: RetrievalResult[];
    try {
      retrieved = await this.deps.retriever.search(task.directive, {
        projectId: task.projectId,
      });
    } catch {
      return this.emptyResult(mode, Date.now() - start);
    }
    const retrievalLatencyMs = Date.now() - retrievalStart;

    if (retrieved.length === 0) {
      return this.emptyResult(mode, Date.now() - start);
    }

    // Rerank
    let reranked: RetrievalResult[];
    try {
      reranked = await this.deps.reranker.rerank(task.directive, retrieved);
    } catch {
      reranked = retrieved; // fallback to original order
    }

    // Token budget allocation
    const allocation = this.budgetManager.allocate(reranked);

    const injected = allocation.chunks.filter(c => c.status === "injected");
    const pruned = allocation.chunks.filter(c => c.status === "pruned");
    const belowThreshold = allocation.chunks.filter(
      c => c.status === "below_threshold"
    );

    const ragContext: RAGContext = {
      mode,
      chunks: allocation.chunks.map(c => ({
        content: c.result.content,
        sourceType: c.result.sourceType,
        sourceId: c.result.sourceId,
        score: c.result.score,
        status: c.status,
      })),
      totalTokens: allocation.injectedTokens,
      retrievalLatencyMs,
    };

    const latencyMs = Date.now() - start;

    // Log
    this.deps.augmentationLogger.log({
      taskId: task.taskId,
      agentId: agent.agentId,
      projectId: task.projectId,
      mode,
      retrievedChunkIds: retrieved.map(r => r.chunkId),
      injectedChunkIds: injected.map(c => c.result.chunkId),
      prunedChunkIds: pruned.map(c => c.result.chunkId),
      tokenUsage: allocation.injectedTokens,
      latencyMs,
    });

    return {
      ragContext,
      retrievedChunks: retrieved,
      injectedChunks: injected.map(c => c.result),
      prunedChunks: pruned.map(c => c.result),
      belowThresholdChunks: belowThreshold.map(c => c.result),
      tokenUsage: allocation.injectedTokens,
      latencyMs,
    };
  }

  private shouldAugment(directive: string): boolean {
    const triggers = ["@rag", "@context", "@search", "检索", "历史"];
    return triggers.some(t => directive.toLowerCase().includes(t));
  }

  private emptyResult(
    mode: RAGContext["mode"],
    latencyMs: number
  ): AugmentationResult {
    return {
      ragContext: { mode, chunks: [], totalTokens: 0, retrievalLatencyMs: 0 },
      retrievedChunks: [],
      injectedChunks: [],
      prunedChunks: [],
      belowThresholdChunks: [],
      tokenUsage: 0,
      latencyMs,
    };
  }
}
