/**
 * RAGDebugPanel — 检索调试面板
 *
 * 展示完整检索流程耗时分解、候选数量、最终注入数量。
 *
 * Requirements: 9.3
 */

import type { RAGAugmentationLog } from "../../lib/rag-store";

interface RAGDebugPanelProps {
  logs: RAGAugmentationLog[];
}

export function RAGDebugPanel({ logs }: RAGDebugPanelProps) {
  if (!logs || logs.length === 0) {
    return null;
  }

  const latest = logs[logs.length - 1];

  return (
    <details className="text-xs border rounded p-2">
      <summary className="cursor-pointer font-medium text-gray-600">
        RAG Debug Info
      </summary>
      <div className="mt-2 space-y-2">
        <div className="grid grid-cols-2 gap-1">
          <div>Mode:</div>
          <div className="font-mono">{latest.mode}</div>
          <div>Total Latency:</div>
          <div className="font-mono">{latest.latencyMs}ms</div>
          <div>Retrieved Chunks:</div>
          <div className="font-mono">{latest.retrievedChunkIds.length}</div>
          <div>Injected Chunks:</div>
          <div className="font-mono">{latest.injectedChunkIds.length}</div>
          <div>Pruned Chunks:</div>
          <div className="font-mono">{latest.prunedChunkIds.length}</div>
          <div>Token Usage:</div>
          <div className="font-mono">{latest.tokenUsage}</div>
          <div>Agent:</div>
          <div className="font-mono">{latest.agentId}</div>
          <div>Timestamp:</div>
          <div className="font-mono">{new Date(latest.timestamp).toISOString()}</div>
        </div>

        {logs.length > 1 && (
          <div className="text-gray-400 mt-1">
            {logs.length} total augmentation logs for this task
          </div>
        )}
      </div>
    </details>
  );
}
