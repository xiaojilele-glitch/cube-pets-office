/**
 * 分块策略路由
 *
 * 按 sourceType 将内容路由到对应的 Chunker 实现。
 * 各 Chunker 通过 register() 注册，支持延迟加载。
 *
 * 路由映射（设计文档 §2）：
 *   code_snippet          → CodeChunker（语法感知）
 *   conversation           → ConversationChunker（对话轮次）
 *   document               → DocumentChunker（语义段落）
 *   task_result / mission_log / bug_report → SlidingWindowChunker（滑动窗口）
 *   architecture_decision  → PassthroughChunker（不分块）
 */

import type {
  SourceType,
  ChunkRecord,
  ChunkMetadata,
} from "../../../shared/rag/contracts.js";
import { SOURCE_TYPES } from "../../../shared/rag/contracts.js";
import { getRAGConfig, type ChunkingConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Chunker 接口
// ---------------------------------------------------------------------------

export interface Chunker {
  /** 将内容按策略分块，返回 ChunkRecord 数组 */
  chunk(content: string, metadata: ChunkMetadata): ChunkRecord[];
}

// ---------------------------------------------------------------------------
// ChunkRouter
// ---------------------------------------------------------------------------

/**
 * sourceType → Chunker 策略名称的默认映射。
 * 与设计文档 §2 "Chunker 接口族" 一致。
 */
const DEFAULT_STRATEGY_MAP: Record<SourceType, string> = {
  code_snippet: "syntax_aware",
  conversation: "conversation_turn",
  document: "semantic_paragraph",
  task_result: "sliding_window",
  mission_log: "sliding_window",
  architecture_decision: "passthrough",
  bug_report: "sliding_window",
};

export class ChunkRouter {
  /** strategy name → Chunker 实例或惰性工厂 */
  private readonly registry = new Map<string, Chunker | (() => Chunker)>();

  /** 已解析（实例化）的 Chunker 缓存 */
  private readonly resolved = new Map<string, Chunker>();

  // -----------------------------------------------------------------------
  // 注册
  // -----------------------------------------------------------------------

  /**
   * 注册一个 Chunker 实现。
   * @param strategy  策略名称，如 'sliding_window'、'syntax_aware'
   * @param chunker   Chunker 实例或惰性工厂函数（延迟实例化）
   */
  register(strategy: string, chunker: Chunker | (() => Chunker)): void {
    this.registry.set(strategy, chunker);
    // 清除已解析缓存，下次 route 时重新解析
    this.resolved.delete(strategy);
  }

  // -----------------------------------------------------------------------
  // 路由
  // -----------------------------------------------------------------------

  /**
   * 按 sourceType 返回对应的 Chunker。
   *
   * 解析顺序：
   * 1. 如果 RAGConfig.chunking[sourceType].strategy 有自定义值，优先使用
   * 2. 否则使用 DEFAULT_STRATEGY_MAP 中的默认策略名称
   * 3. 在 registry 中查找对应的 Chunker
   *
   * @throws Error 如果 sourceType 无效或对应策略未注册
   */
  route(sourceType: SourceType): Chunker {
    // 验证 sourceType
    if (!SOURCE_TYPES.includes(sourceType)) {
      throw new Error(`Unknown sourceType: ${sourceType}`);
    }

    const strategy = this.resolveStrategy(sourceType);
    return this.resolveChunker(strategy);
  }

  // -----------------------------------------------------------------------
  // 查询
  // -----------------------------------------------------------------------

  /** 返回当前已注册的所有策略名称 */
  registeredStrategies(): string[] {
    return Array.from(this.registry.keys());
  }

  /** 检查某个策略是否已注册 */
  hasStrategy(strategy: string): boolean {
    return this.registry.has(strategy);
  }

  /**
   * 获取指定 sourceType 的分块配置（合并默认 + 环境变量覆盖）。
   * 供各 Chunker 实现读取 maxTokens / minTokens / windowSize / overlap 等参数。
   */
  getChunkingConfig(sourceType: SourceType): ChunkingConfig | undefined {
    const config = getRAGConfig();
    return config.chunking[sourceType];
  }

  // -----------------------------------------------------------------------
  // 内部方法
  // -----------------------------------------------------------------------

  /** 确定 sourceType 对应的策略名称 */
  private resolveStrategy(sourceType: SourceType): string {
    const config = getRAGConfig();
    const perType = config.chunking[sourceType];
    if (perType?.strategy) {
      return perType.strategy;
    }
    return DEFAULT_STRATEGY_MAP[sourceType];
  }

  /** 从 registry 解析 Chunker 实例（支持惰性工厂） */
  private resolveChunker(strategy: string): Chunker {
    // 已解析缓存
    const cached = this.resolved.get(strategy);
    if (cached) return cached;

    const entry = this.registry.get(strategy);
    if (!entry) {
      throw new Error(
        `No Chunker registered for strategy "${strategy}". ` +
          `Registered: [${this.registeredStrategies().join(", ")}]`
      );
    }

    // 如果是工厂函数，调用并缓存
    const chunker = typeof entry === "function" ? entry() : entry;
    this.resolved.set(strategy, chunker);
    return chunker;
  }
}
