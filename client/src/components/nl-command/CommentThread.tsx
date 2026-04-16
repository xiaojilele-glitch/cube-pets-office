import { useState } from "react";

import { GlowButton } from "@/components/ui/GlowButton";
import type { Comment } from "@shared/nl-command/contracts";

/**
 * Comment thread component with @mention support and version history.
 *
 * @see Requirements 12.1, 12.2, 12.3
 */
export interface CommentThreadProps {
  comments: Comment[];
  onAdd?: (content: string) => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CommentThread({ comments, onAdd }: CommentThreadProps) {
  const [text, setText] = useState("");
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(
    new Set()
  );

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAdd?.(trimmed);
    setText("");
  };

  const toggleVersions = (id: string) => {
    setExpandedVersions(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {comments.length === 0 && (
        <div className="py-4 text-center text-sm text-stone-400">
          No comments yet.
        </div>
      )}

      {comments.map(c => (
        <div
          key={c.commentId}
          className="rounded-lg border border-stone-200 px-3 py-2"
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-stone-700">{c.authorId}</span>
            <span className="text-stone-400">{formatDate(c.createdAt)}</span>
          </div>
          <div className="mt-1 text-xs text-stone-600 whitespace-pre-wrap">
            {c.content}
          </div>
          {c.mentions.length > 0 && (
            <div className="mt-1 text-[10px] text-indigo-500">
              @{c.mentions.join(" @")}
            </div>
          )}
          {c.versions.length > 1 && (
            <button
              onClick={() => toggleVersions(c.commentId)}
              className="mt-1 text-[10px] text-stone-400 hover:text-stone-600"
            >
              {expandedVersions.has(c.commentId) ? "Hide" : "Show"}{" "}
              {c.versions.length - 1} edit(s)
            </button>
          )}
          {expandedVersions.has(c.commentId) &&
            c.versions.slice(0, -1).map((v, i) => (
              <div
                key={i}
                className="mt-1 border-l-2 border-stone-200 pl-2 text-[10px] text-stone-400"
              >
                <span>{formatDate(v.editedAt)}</span>: {v.content}
              </div>
            ))}
        </div>
      ))}

      {onAdd && (
        <div className="flex gap-2">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSubmit()}
            placeholder="Add a comment… (use @userId to mention)"
            className="flex-1 rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-700 placeholder:text-stone-400 focus:border-indigo-300 focus:outline-none"
          />
          <GlowButton
            onClick={handleSubmit}
            disabled={!text.trim()}
            className="rounded-md"
          >
            Send
          </GlowButton>
        </div>
      )}
    </div>
  );
}
