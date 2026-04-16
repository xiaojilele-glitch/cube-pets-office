/**
 * RAG 模块入口 — 初始化所有 RAG 管道组件
 *
 * 提供 initRAG() 启动函数，返回所有组件依赖供路由使用。
 */

import { getRAGConfig } from "./config.js";
import { DedupChecker } from "./ingestion/dedup-checker.js";
import { DataCleaner } from "./ingestion/data-cleaner.js";
import { DeadLetterQueue } from "./ingestion/dead-letter-queue.js";
import { IngestionPipeline } from "./ingestion/ingestion-pipeline.js";
import { RAGEventListener } from "./ingestion/event-listener.js";
import { ChunkRouter } from "./chunking/chunk-router.js";
import { SlidingWindowChunker } from "./chunking/sliding-window-chunker.js";
import { CodeChunker } from "./chunking/code-chunker.js";
import { ConversationChunker } from "./chunking/conversation-chunker.js";
import { DocumentChunker } from "./chunking/document-chunker.js";
import { PassthroughChunker } from "./chunking/passthrough-chunker.js";
import { createEmbeddingProviderFromConfig } from "./embedding/embedding-provider.js";
import { EmbeddingGenerator } from "./embedding/embedding-generator.js";
import { createQdrantAdapter } from "./store/qdrant-adapter.js";
import { MetadataStore } from "./store/metadata-store.js";
import { KeywordSearcher } from "./retrieval/keyword-searcher.js";
import { ContextExpander } from "./retrieval/context-expander.js";
import { RAGRetriever } from "./retrieval/rag-retriever.js";
import { createReranker } from "./augmentation/reranker.js";
import { TokenBudgetManager } from "./augmentation/token-budget-manager.js";
import { AugmentationLogger } from "./augmentation/augmentation-logger.js";
import { RAGPipeline } from "./augmentation/rag-pipeline.js";
import { FeedbackCollector } from "./feedback/feedback-collector.js";
import { HardNegativeSet } from "./feedback/hard-negative-set.js";
import { WeightTuner } from "./feedback/weight-tuner.js";
import { HotColdManager } from "./lifecycle/hot-cold-manager.js";
import { LifecycleManager } from "./lifecycle/lifecycle-manager.js";
import { RAGMetrics, ragMetrics } from "./observability/metrics.js";
import { QuotaManager } from "./observability/quota-manager.js";
import { HealthChecker } from "./observability/health-checker.js";
import type { RAGRouteDeps } from "../routes/rag.js";

export function initRAG(): RAGRouteDeps {
  const config = getRAGConfig();

  // Stores
  const metadataStore = new MetadataStore();
  const dedupChecker = new DedupChecker();
  const deadLetterQueue = new DeadLetterQueue();

  // Chunking
  const chunkRouter = new ChunkRouter();
  chunkRouter.register("sliding_window", () =>
    SlidingWindowChunker.fromConfig(config.chunking.task_result)
  );
  chunkRouter.register("syntax_aware", () =>
    CodeChunker.fromConfig(config.chunking.code_snippet)
  );
  chunkRouter.register("conversation_turn", () =>
    ConversationChunker.fromConfig(config.chunking.conversation)
  );
  chunkRouter.register("semantic_paragraph", () =>
    DocumentChunker.fromConfig(config.chunking.document)
  );
  chunkRouter.register("passthrough", () =>
    PassthroughChunker.fromConfig(config.chunking.architecture_decision)
  );

  // Embedding
  const embeddingProvider = createEmbeddingProviderFromConfig();
  const embeddingGenerator = new EmbeddingGenerator(embeddingProvider);

  // Vector store
  const vectorStore = createQdrantAdapter(config.vectorStore.connectionUrl);

  // Ingestion pipeline
  const ingestionPipeline = new IngestionPipeline({
    dedupChecker,
    dataCleaner: new DataCleaner(),
    chunkRouter,
    embeddingGenerator,
    vectorStore,
    metadataStore,
    deadLetterQueue,
  });

  // Event listener
  const eventListener = new RAGEventListener();
  eventListener.bind(ingestionPipeline);

  // Retrieval
  const keywordSearcher = new KeywordSearcher(metadataStore);
  const contextExpander = new ContextExpander(metadataStore);
  const retriever = new RAGRetriever({
    embeddingGenerator,
    vectorStore,
    metadataStore,
    keywordSearcher,
    contextExpander,
  });

  // Augmentation
  const reranker = createReranker(config.augmentation.reranker);
  const augmentationLogger = new AugmentationLogger();
  const ragPipeline = new RAGPipeline({
    retriever,
    reranker,
    augmentationLogger,
    tokenBudgetManager: new TokenBudgetManager(config.augmentation.tokenBudget),
  });

  // Feedback
  const feedbackCollector = new FeedbackCollector();
  const hardNegativeSet = new HardNegativeSet();
  const weightTuner = new WeightTuner();

  // Lifecycle
  const hotColdManager = new HotColdManager(vectorStore, metadataStore);
  const lifecycleManager = new LifecycleManager(
    vectorStore,
    metadataStore,
    hotColdManager
  );

  // Observability
  const healthChecker = new HealthChecker({
    vectorStore,
    embeddingProvider,
    deadLetterQueue,
  });

  return {
    ingestionPipeline,
    retriever,
    ragPipeline,
    feedbackCollector,
    lifecycleManager,
    healthChecker,
    metrics: ragMetrics,
    augmentationLogger,
  };
}

// Re-export key types
export type { RAGRouteDeps } from "../routes/rag.js";
export { getRAGConfig } from "./config.js";
