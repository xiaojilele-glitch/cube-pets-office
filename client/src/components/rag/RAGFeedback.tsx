/**
 * RAGFeedback — 反馈提交组件
 *
 * helpful/irrelevant 标记按钮 + 缺失上下文描述输入框。
 *
 * Requirements: 9.5
 */

import { useState } from "react";
import { useRAGStore } from "../../lib/rag-store";

interface RAGFeedbackProps {
  taskId: string;
  agentId: string;
  projectId?: string;
  chunkIds: string[];
}

export function RAGFeedback({ taskId, agentId, projectId, chunkIds }: RAGFeedbackProps) {
  const { submitFeedback, feedbackSubmitting } = useRAGStore();
  const [helpful, setHelpful] = useState<Set<string>>(new Set());
  const [irrelevant, setIrrelevant] = useState<Set<string>>(new Set());
  const [missingContext, setMissingContext] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const toggleHelpful = (id: string) => {
    const next = new Set(helpful);
    if (next.has(id)) next.delete(id); else next.add(id);
    irrelevant.delete(id);
    setHelpful(next);
    setIrrelevant(new Set(irrelevant));
  };

  const toggleIrrelevant = (id: string) => {
    const next = new Set(irrelevant);
    if (next.has(id)) next.delete(id); else next.add(id);
    helpful.delete(id);
    setIrrelevant(next);
    setHelpful(new Set(helpful));
  };

  const handleSubmit = async () => {
    await submitFeedback({
      taskId,
      agentId,
      projectId,
      helpfulChunkIds: Array.from(helpful),
      irrelevantChunkIds: Array.from(irrelevant),
      missingContext: missingContext.trim() || undefined,
    });
    setSubmitted(true);
  };

  if (submitted) {
    return <div className="text-xs text-green-600 p-2">Feedback submitted. Thanks!</div>;
  }

  if (chunkIds.length === 0) return null;

  return (
    <div className="space-y-2 p-2 border rounded text-xs">
      <div className="font-medium text-gray-600">Rate retrieved chunks</div>
      {chunkIds.map((id) => (
        <div key={id} className="flex items-center gap-1">
          <span className="font-mono truncate flex-1">{id}</span>
          <button
            type="button"
            onClick={() => toggleHelpful(id)}
            className={`px-1.5 py-0.5 rounded ${helpful.has(id) ? "bg-green-200" : "bg-gray-100"}`}
            aria-label={`Mark ${id} as helpful`}
          >
            👍
          </button>
          <button
            type="button"
            onClick={() => toggleIrrelevant(id)}
            className={`px-1.5 py-0.5 rounded ${irrelevant.has(id) ? "bg-red-200" : "bg-gray-100"}`}
            aria-label={`Mark ${id} as irrelevant`}
          >
            👎
          </button>
        </div>
      ))}
      <label className="block">
        <span className="text-gray-500">Missing context?</span>
        <input
          type="text"
          value={missingContext}
          onChange={(e) => setMissingContext(e.target.value)}
          className="mt-1 block w-full border rounded px-2 py-1 text-xs"
          placeholder="Describe what was missing..."
        />
      </label>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={feedbackSubmitting}
        className="px-3 py-1 bg-blue-500 text-white rounded text-xs disabled:opacity-50"
      >
        {feedbackSubmitting ? "Submitting..." : "Submit Feedback"}
      </button>
    </div>
  );
}
