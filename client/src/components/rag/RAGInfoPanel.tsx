/**
 * RAGInfoPanel — RAG 增强信息区块
 *
 * 展示检索到的 chunk 列表、来源、相关度评分、token 数量。
 * 为每个 chunk 显示状态标签（injected/pruned/below_threshold）。
 *
 * Requirements: 9.1, 9.2
 */

import type { RAGAugmentationLog } from "../../lib/rag-store";

interface RAGInfoPanelProps {
  logs: RAGAugmentationLog[];
}

const STATUS_COLORS: Record<string, string> = {
  injected: "bg-green-100 text-green-800",
  pruned: "bg-yellow-100 text-yellow-800",
  below_threshold: "bg-gray-100 text-gray-500",
};

export function RAGInfoPanel({ logs }: RAGInfoPanelProps) {
  if (!logs || logs.length === 0) {
    return (
      <div className="text-sm text-gray-400 p-3">
        No RAG augmentation data available.
      </div>
    );
  }

  const latest = logs[logs.length - 1];

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">RAG Augmentation</span>
        <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
          {latest.mode}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-gray-50 rounded p-2">
          <div className="text-gray-500">Retrieved</div>
          <div className="font-mono">{latest.retrievedChunkIds.length}</div>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <div className="text-gray-500">Injected</div>
          <div className="font-mono">{latest.injectedChunkIds.length}</div>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <div className="text-gray-500">Tokens</div>
          <div className="font-mono">{latest.tokenUsage}</div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-xs text-gray-500">Chunk IDs</div>
        {latest.injectedChunkIds.map((id) => (
          <div key={id} className="flex items-center gap-2 text-xs">
            <span className={`px-1.5 py-0.5 rounded ${STATUS_COLORS.injected}`}>
              injected
            </span>
            <span className="font-mono truncate">{id}</span>
          </div>
        ))}
        {latest.prunedChunkIds.map((id) => (
          <div key={id} className="flex items-center gap-2 text-xs">
            <span className={`px-1.5 py-0.5 rounded ${STATUS_COLORS.pruned}`}>
              pruned
            </span>
            <span className="font-mono truncate">{id}</span>
          </div>
        ))}
      </div>

      <div className="text-xs text-gray-400">
        Latency: {latest.latencyMs}ms · {new Date(latest.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}
