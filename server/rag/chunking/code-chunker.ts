/**
 * 代码语法感知分块器
 *
 * 用于 code_snippet 类型数据。
 * 使用正则匹配函数/类/import 块边界进行分割（不引入完整 AST 解析器），
 * 在准确性和复杂度之间取平衡。
 *
 * 提取 codeLanguage、functionSignature、imports 元数据写入 ChunkRecord.metadata。
 *
 * Requirements: 2.1, 2.3
 */

import type {
  ChunkRecord,
  ChunkMetadata,
  SourceType,
} from "../../../shared/rag/contracts.js";
import type { Chunker } from "./chunk-router.js";
import type { ChunkingConfig } from "../config.js";
import { estimateTokenCount } from "./sliding-window-chunker.js";

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

export interface CodeChunkerOptions {
  /** 单个 chunk 最小 token 数，默认 64 */
  minTokens?: number;
  /** 单个 chunk 最大 token 数，默认 1024 */
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// 语言检测
// ---------------------------------------------------------------------------

/** 从内容启发式检测编程语言 */
export function detectLanguage(content: string): string {
  const trimmed = content.trim();

  // Python: def/class/import with colon, or shebang
  if (/^#!.*python/m.test(trimmed)) return "python";
  if (
    /^(from\s+\S+\s+import|import\s+\S+)\s*$/m.test(trimmed) &&
    /\bdef\s+\w+\s*\(.*\)\s*(->\s*\S+\s*)?:/m.test(trimmed)
  )
    return "python";
  if (/\bdef\s+\w+\s*\(.*\)\s*(->\s*\S+\s*)?:/m.test(trimmed)) return "python";

  // TypeScript: import with type annotations, interface, type alias
  if (/\binterface\s+\w+/m.test(trimmed) || /\btype\s+\w+\s*=/m.test(trimmed))
    return "typescript";
  if (/:\s*(string|number|boolean|void|any|never)\b/m.test(trimmed))
    return "typescript";
  if (
    /import\s+.*\s+from\s+['"]/.test(trimmed) &&
    /:\s*\w+(\[\])?\s*[=;,)]/m.test(trimmed)
  )
    return "typescript";

  // JavaScript: import/export, function, const/let/var, arrow functions
  if (/^import\s+/m.test(trimmed) || /^export\s+(default\s+)?/m.test(trimmed))
    return "javascript";
  if (
    /\bfunction\s+\w+\s*\(/m.test(trimmed) ||
    /\bconst\s+\w+\s*=\s*(\(|async)/m.test(trimmed)
  )
    return "javascript";

  // Java: public class, package declaration
  if (/^package\s+[\w.]+;/m.test(trimmed)) return "java";
  if (/\bpublic\s+(class|interface|enum)\s+\w+/m.test(trimmed)) return "java";

  // Go: package/func declarations
  if (/^package\s+\w+$/m.test(trimmed) && /\bfunc\s+/m.test(trimmed))
    return "go";

  // Rust: fn/struct/impl/use
  if (/\bfn\s+\w+\s*[<(]/m.test(trimmed) && /\buse\s+\w+/m.test(trimmed))
    return "rust";

  return "unknown";
}

// ---------------------------------------------------------------------------
// Import 提取
// ---------------------------------------------------------------------------

/**
 * 正则模式：匹配各语言的 import/require 语句。
 * 每个模式匹配一整行。
 */
const IMPORT_PATTERNS = [
  // JS/TS: import ... from '...'; import '...'; import type ...
  /^import\s+.+$/gm,
  // JS: const x = require('...')
  /^(?:const|let|var)\s+\S+\s*=\s*require\s*\(.+\)\s*;?$/gm,
  // Python: import x / from x import y
  /^(?:from\s+\S+\s+)?import\s+.+$/gm,
  // Java: import ...;
  /^import\s+[\w.*]+\s*;$/gm,
  // Go: import "..." or import ( ... )  — single line only
  /^import\s+(?:"[^"]+"|`[^`]+`|\S+)$/gm,
  // Rust: use ...;
  /^use\s+.+;$/gm,
];

/** 从内容中提取所有 import 语句（去重） */
export function extractImports(content: string): string[] {
  const imports = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      imports.add(match[0].trim());
    }
  }
  return Array.from(imports);
}

// ---------------------------------------------------------------------------
// 代码块边界检测
// ---------------------------------------------------------------------------

/**
 * 代码块类型
 */
export interface CodeBlock {
  /** 块类型 */
  type: "import" | "function" | "class" | "other";
  /** 块内容 */
  content: string;
  /** 函数/类签名（仅 function/class 类型） */
  signature?: string;
}

/**
 * 函数/类声明的正则模式。
 * 每个模式匹配声明的第一行（签名行）。
 */
const DECLARATION_PATTERNS: RegExp[] = [
  // JS/TS: function name(...) / async function name(...)
  /^(?:export\s+)?(?:async\s+)?function\s*\*?\s+\w+\s*[(<]/m,
  // JS/TS: const/let/var name = (...) => / async (...) =>
  /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/m,
  // JS/TS: class Name
  /^(?:export\s+)?(?:abstract\s+)?class\s+\w+/m,
  // JS/TS: interface Name (TS)
  /^(?:export\s+)?interface\s+\w+/m,
  // Python: def name(...): / async def name(...):
  /^(?:async\s+)?def\s+\w+\s*\(/m,
  // Python: class Name:
  /^class\s+\w+/m,
  // Java: public/private/protected ... class/void/int/String name(
  /^(?:(?:public|private|protected)\s+)?(?:static\s+)?(?:final\s+)?(?:abstract\s+)?(?:class|interface|enum)\s+\w+/m,
  /^(?:(?:public|private|protected)\s+)?(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:\w+(?:<[^>]+>)?)\s+\w+\s*\(/m,
  // Go: func name(...) / func (receiver) name(...)
  /^func\s+(?:\([^)]+\)\s+)?\w+\s*[(<]/m,
  // Rust: fn name(...) / pub fn name(...)
  /^(?:pub\s+)?(?:async\s+)?fn\s+\w+/m,
  // Rust: struct/impl/trait/enum
  /^(?:pub\s+)?(?:struct|impl|trait|enum)\s+\w+/m,
];

/**
 * 检测一行是否是函数/类声明的开始。
 * 返回匹配的签名字符串，或 null。
 */
function matchDeclaration(line: string): string | null {
  const trimmed = line.trim();
  for (const pattern of DECLARATION_PATTERNS) {
    pattern.lastIndex = 0;
    const m = pattern.exec(trimmed);
    if (m) return trimmed;
  }
  return null;
}

/**
 * 检测一行是否是 import 语句。
 */
function isImportLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // JS/TS import
  if (/^import\s+/.test(trimmed)) return true;
  // JS require
  if (/^(?:const|let|var)\s+\S+\s*=\s*require\s*\(/.test(trimmed)) return true;
  // Python import
  if (/^(?:from\s+\S+\s+)?import\s+/.test(trimmed)) return true;
  // Java import
  if (/^import\s+[\w.*]+\s*;$/.test(trimmed)) return true;
  // Go import
  if (/^import\s+/.test(trimmed)) return true;
  // Rust use
  if (/^use\s+/.test(trimmed)) return true;
  return false;
}

/**
 * 将代码内容按函数/类/import 块边界分割为 CodeBlock 数组。
 *
 * 策略：逐行扫描，遇到声明行或 import 行时开始新块。
 * 连续的 import 行合并为一个 import 块。
 * 连续的非声明、非 import 行合并为 other 块。
 */
export function splitIntoBlocks(content: string): CodeBlock[] {
  const lines = content.split("\n");
  const blocks: CodeBlock[] = [];
  let currentLines: string[] = [];
  let currentType: CodeBlock["type"] = "other";
  let currentSignature: string | undefined;

  function flushBlock(): void {
    const text = currentLines.join("\n");
    if (text.trim()) {
      blocks.push({
        type: currentType,
        content: text,
        signature: currentSignature,
      });
    }
    currentLines = [];
    currentType = "other";
    currentSignature = undefined;
  }

  for (const line of lines) {
    const importLine = isImportLine(line);
    const declaration = !importLine ? matchDeclaration(line) : null;

    if (importLine) {
      // If we're already in an import block, continue accumulating
      if (currentType === "import") {
        currentLines.push(line);
        continue;
      }
      // Otherwise flush current block and start import block
      flushBlock();
      currentType = "import";
      currentLines.push(line);
    } else if (declaration) {
      // New function/class declaration — flush and start new block
      flushBlock();
      currentType = "function"; // covers both function and class
      currentSignature = declaration;
      currentLines.push(line);
    } else {
      // Regular line — if we're in a function/class block, keep accumulating
      // (the body belongs to the declaration)
      // If we're in an import block, flush first
      if (currentType === "import") {
        // Blank line after imports is still part of import block separation
        if (!line.trim()) {
          flushBlock();
          currentType = "other";
          currentLines.push(line);
        } else {
          flushBlock();
          currentType = "other";
          currentLines.push(line);
        }
      } else {
        currentLines.push(line);
      }
    }
  }

  flushBlock();
  return blocks;
}

// ---------------------------------------------------------------------------
// CodeChunker
// ---------------------------------------------------------------------------

export class CodeChunker implements Chunker {
  private readonly minTokens: number;
  private readonly maxTokens: number;

  constructor(options?: CodeChunkerOptions) {
    this.minTokens = options?.minTokens ?? 64;
    this.maxTokens = options?.maxTokens ?? 1024;
  }

  /**
   * 从 ChunkingConfig 创建实例。
   */
  static fromConfig(config?: ChunkingConfig): CodeChunker {
    return new CodeChunker({
      minTokens: config?.minTokens ?? 64,
      maxTokens: config?.maxTokens ?? 1024,
    });
  }

  chunk(content: string, metadata: ChunkMetadata): ChunkRecord[] {
    if (!content || !content.trim()) {
      return [];
    }

    // 1. 检测语言
    const language = metadata.codeLanguage || detectLanguage(content);

    // 2. 提取全局 imports
    const imports = extractImports(content);

    // 3. 按代码块边界分割
    const blocks = splitIntoBlocks(content);

    // 4. 将 blocks 合并/拆分为满足 token 范围的 chunks
    const rawChunks = this.buildRawChunks(blocks);

    // 5. 构建 ChunkRecord 数组
    return rawChunks.map((raw, index) => {
      const chunkMeta: ChunkMetadata = {
        ...metadata,
        codeLanguage: language,
        functionSignature: raw.signature,
        imports: raw.isImportBlock
          ? this.extractImportsFromBlock(raw.text)
          : imports,
      };

      return {
        chunkId: `chunk:${index}`,
        sourceType: "code_snippet" as SourceType,
        sourceId: "",
        projectId: "",
        chunkIndex: index,
        content: raw.text,
        tokenCount: raw.tokenCount,
        metadata: chunkMeta,
      };
    });
  }

  // -----------------------------------------------------------------------
  // 内部方法
  // -----------------------------------------------------------------------

  /**
   * 将 CodeBlock 数组合并/拆分为满足 [minTokens, maxTokens] 的 raw chunks。
   *
   * 策略：
   * - 小块（< minTokens）与相邻块合并
   * - 大块（> maxTokens）按行拆分
   */
  private buildRawChunks(blocks: CodeBlock[]): RawCodeChunk[] {
    const result: RawCodeChunk[] = [];
    let accumulator: AccumulatedBlock = {
      lines: [],
      tokenCount: 0,
      signature: undefined,
      isImportBlock: false,
    };

    for (const block of blocks) {
      const blockTokens = estimateTokenCount(block.content);

      // If block alone exceeds maxTokens, flush accumulator then split the block
      if (blockTokens > this.maxTokens) {
        this.flushAccumulator(accumulator, result);
        accumulator = {
          lines: [],
          tokenCount: 0,
          signature: undefined,
          isImportBlock: false,
        };
        this.splitLargeBlock(block, result);
        continue;
      }

      // If adding this block would exceed maxTokens, flush first
      if (
        accumulator.tokenCount + blockTokens > this.maxTokens &&
        accumulator.tokenCount > 0
      ) {
        this.flushAccumulator(accumulator, result);
        accumulator = {
          lines: [],
          tokenCount: 0,
          signature: undefined,
          isImportBlock: false,
        };
      }

      // Accumulate
      accumulator.lines.push(block.content);
      accumulator.tokenCount += blockTokens;
      if (block.signature && !accumulator.signature) {
        accumulator.signature = block.signature;
      }
      if (block.type === "import") {
        accumulator.isImportBlock = true;
      }
    }

    // Flush remaining
    this.flushAccumulator(accumulator, result);

    // Final pass: merge any chunks below minTokens
    return this.mergeSmallChunks(result);
  }

  /** Flush accumulated lines into a raw chunk */
  private flushAccumulator(
    acc: AccumulatedBlock,
    result: RawCodeChunk[]
  ): void {
    if (acc.lines.length === 0 || acc.tokenCount === 0) return;
    const text = acc.lines.join("\n");
    if (!text.trim()) return;
    result.push({
      text,
      tokenCount: acc.tokenCount,
      signature: acc.signature,
      isImportBlock: acc.isImportBlock,
    });
  }

  /** Split a block that exceeds maxTokens by lines, then by words if needed */
  private splitLargeBlock(block: CodeBlock, result: RawCodeChunk[]): void {
    const lines = block.content.split("\n");
    let currentLines: string[] = [];
    let currentTokens = 0;

    for (const line of lines) {
      const lineTokens = estimateTokenCount(line);

      // If a single line exceeds maxTokens, split it by words
      if (lineTokens > this.maxTokens) {
        // Flush accumulated lines first
        if (currentLines.length > 0 && currentTokens > 0) {
          result.push({
            text: currentLines.join("\n"),
            tokenCount: currentTokens,
            signature: block.signature,
            isImportBlock: block.type === "import",
          });
          currentLines = [];
          currentTokens = 0;
        }
        // Split the long line by words
        this.splitLongLine(line, block, result);
        continue;
      }

      if (
        currentTokens + lineTokens > this.maxTokens &&
        currentLines.length > 0
      ) {
        const text = currentLines.join("\n");
        result.push({
          text,
          tokenCount: currentTokens,
          signature: block.signature,
          isImportBlock: block.type === "import",
        });
        currentLines = [];
        currentTokens = 0;
      }

      currentLines.push(line);
      currentTokens += lineTokens;
    }

    if (currentLines.length > 0 && currentTokens > 0) {
      const text = currentLines.join("\n");
      result.push({
        text,
        tokenCount: currentTokens,
        signature: block.signature,
        isImportBlock: block.type === "import",
      });
    }
  }

  /** Split a single long line into word-based chunks */
  private splitLongLine(
    line: string,
    block: CodeBlock,
    result: RawCodeChunk[]
  ): void {
    const words = line.split(/\s+/).filter(Boolean);
    let pos = 0;
    while (pos < words.length) {
      const end = Math.min(pos + this.maxTokens, words.length);
      const slice = words.slice(pos, end);
      result.push({
        text: slice.join(" "),
        tokenCount: slice.length,
        signature: block.signature,
        isImportBlock: block.type === "import",
      });
      pos = end;
    }
  }

  /** Merge chunks below minTokens with neighbors */
  private mergeSmallChunks(chunks: RawCodeChunk[]): RawCodeChunk[] {
    if (chunks.length <= 1) return chunks;

    const result: RawCodeChunk[] = [];

    for (const chunk of chunks) {
      if (chunk.tokenCount < this.minTokens && result.length > 0) {
        const prev = result[result.length - 1];
        // Merge if combined doesn't exceed maxTokens
        if (prev.tokenCount + chunk.tokenCount <= this.maxTokens) {
          prev.text = prev.text + "\n" + chunk.text;
          prev.tokenCount = estimateTokenCount(prev.text);
          if (chunk.signature && !prev.signature) {
            prev.signature = chunk.signature;
          }
          continue;
        }
      }
      result.push({ ...chunk });
    }

    return result;
  }

  /** Extract import lines from a block's text */
  private extractImportsFromBlock(text: string): string[] {
    return extractImports(text);
  }
}

// ---------------------------------------------------------------------------
// 内部类型
// ---------------------------------------------------------------------------

interface RawCodeChunk {
  text: string;
  tokenCount: number;
  signature?: string;
  isImportBlock: boolean;
}

interface AccumulatedBlock {
  lines: string[];
  tokenCount: number;
  signature?: string;
  isImportBlock: boolean;
}
