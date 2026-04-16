/**
 * SkillCard — 展示单个 Skill 的信息卡片
 *
 * 显示 name、summary、category、version、enabled 状态。
 * 点击展开详细信息（prompt、MCP 依赖）。
 */
import { useState } from "react";
import { ChevronDown, ChevronUp, Zap, ZapOff } from "lucide-react";

export interface SkillCardData {
  id: string;
  name: string;
  summary: string;
  category?: string;
  version?: string;
  enabled?: boolean;
  prompt?: string;
  requiredMcp?: string[];
}

interface SkillCardProps {
  skill: SkillCardData;
}

export function SkillCard({ skill }: SkillCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-lg border border-border/50 bg-card/50 p-3 text-sm"
      role="article"
      aria-label={`Skill: ${skill.name}`}
    >
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 min-w-0">
          {skill.enabled !== false ? (
            <Zap className="h-3.5 w-3.5 shrink-0 text-green-500" />
          ) : (
            <ZapOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="font-medium truncate">{skill.name}</span>
          {skill.version && (
            <span className="text-xs text-muted-foreground">
              v{skill.version}
            </span>
          )}
          {skill.category && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {skill.category}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>

      <p className="mt-1 text-xs text-muted-foreground">{skill.summary}</p>

      {expanded && (
        <div className="mt-2 space-y-2 border-t border-border/30 pt-2">
          {skill.prompt && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                Prompt:
              </span>
              <pre className="mt-0.5 whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">
                {skill.prompt}
              </pre>
            </div>
          )}
          {skill.requiredMcp && skill.requiredMcp.length > 0 && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                MCP Tools:
              </span>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {skill.requiredMcp.map(mcp => (
                  <span
                    key={mcp}
                    className="rounded bg-muted px-1.5 py-0.5 text-xs"
                  >
                    {mcp}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
