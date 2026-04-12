/**
 * RAGDebugPanel — 检索调试面板
 *
 * 展示完整检索流程耗时分解、候选数量、最终注入数量。
 *
 * Requirements: 9.3
 */

import type { RAGAugmentationLog } from "../../lib/rag-store";
import { useI18n } from "@/i18n";

interface RAGDebugPanelProps {
  logs: RAGAugmentationLog[];
}

export function RAGDebugPanel({ logs }: RAGDebugPanelProps) {
  const { locale } = useI18n();
  const isZh = locale === "zh-CN";
  if (!logs || logs.length === 0) {
    return null;
  }

  const latest = logs[logs.length - 1];

  return (
    <details className="text-xs border rounded p-2">
      <summary className="cursor-pointer font-medium text-gray-600">
        {isZh ? "RAG 调试信息" : "RAG Debug Info"}
      </summary>
      <div className="mt-2 space-y-2">
        <div className="grid grid-cols-2 gap-1">
          <div>{isZh ? "模式：" : "Mode:"}</div>
          <div className="font-mono">{latest.mode}</div>
          <div>{isZh ? "总耗时：" : "Total Latency:"}</div>
          <div className="font-mono">{latest.latencyMs}ms</div>
          <div>{isZh ? "检索 Chunk：" : "Retrieved Chunks:"}</div>
          <div className="font-mono">{latest.retrievedChunkIds.length}</div>
          <div>{isZh ? "注入 Chunk：" : "Injected Chunks:"}</div>
          <div className="font-mono">{latest.injectedChunkIds.length}</div>
          <div>{isZh ? "裁剪 Chunk：" : "Pruned Chunks:"}</div>
          <div className="font-mono">{latest.prunedChunkIds.length}</div>
          <div>{isZh ? "Token 用量：" : "Token Usage:"}</div>
          <div className="font-mono">{latest.tokenUsage}</div>
          <div>{isZh ? "Agent：" : "Agent:"}</div>
          <div className="font-mono">{latest.agentId}</div>
          <div>{isZh ? "时间戳：" : "Timestamp:"}</div>
          <div className="font-mono">
            {new Date(latest.timestamp).toLocaleString(locale)}
          </div>
        </div>

        {logs.length > 1 && (
          <div className="text-gray-400 mt-1">
            {isZh
              ? `当前任务共记录 ${logs.length} 条增强日志`
              : `${logs.length} total augmentation logs for this task`}
          </div>
        )}
      </div>
    </details>
  );
}
