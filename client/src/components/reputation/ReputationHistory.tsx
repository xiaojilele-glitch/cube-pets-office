import { useEffect } from "react";
import { RotateCcw, Sparkles, TriangleAlert } from "lucide-react";

import { EmptyHintBlock } from "@/components/tasks/EmptyHintBlock";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { useReputationStore } from "../../lib/reputation-store";
import type { ReputationChangeEvent } from "@shared/reputation";

interface ReputationHistoryProps {
  agentId: string;
}

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function ScoreTrend({
  events,
  locale,
}: {
  events: ReputationChangeEvent[];
  locale: string;
}) {
  if (events.length < 2) {
    return (
      <p className="text-xs text-gray-500">
        {t(
          locale,
          "至少两条信誉变更后才会显示趋势。",
          "The trend appears after at least two reputation updates."
        )}
      </p>
    );
  }

  const sorted = [...events].reverse();
  const scores = sorted.map(event => event.newOverallScore);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;

  const width = 300;
  const height = 60;
  const padding = 4;

  const points = scores.map((score, index) => {
    const x = padding + ((width - padding * 2) / (scores.length - 1)) * index;
    const y =
      height - padding - ((score - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Score trend"
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

const REASON_LABELS: Record<string, { zh: string; en: string }> = {
  task_completed: { zh: "任务完成", en: "Task completed" },
  inactivity_decay: { zh: "长时间无活动", en: "Inactivity decay" },
  streak_bonus: { zh: "连续表现加成", en: "Streak bonus" },
  admin_adjust: { zh: "管理员调整", en: "Admin adjustment" },
  admin_reset: { zh: "管理员重置", en: "Admin reset" },
};

function EventRow({
  event,
  locale,
}: {
  event: ReputationChangeEvent;
  locale: string;
}) {
  const delta = event.newOverallScore - event.oldOverallScore;
  const sign = delta >= 0 ? "+" : "";
  const color = delta >= 0 ? "text-green-400" : "text-red-400";
  const label = REASON_LABELS[event.reason];
  const time = new Date(event.timestamp).toLocaleString();

  return (
    <div className="flex items-center justify-between border-b border-gray-800 py-1 text-xs">
      <span className="w-36 truncate text-gray-400" title={time}>
        {time}
      </span>
      <span className="flex-1 px-2 text-gray-300">
        {label ? t(locale, label.zh, label.en) : event.reason}
      </span>
      <span className={`font-data font-mono ${color}`}>
        {sign}
        {delta} to {event.newOverallScore}
      </span>
    </div>
  );
}

export function ReputationHistory({ agentId }: ReputationHistoryProps) {
  const locale = useAppStore(state => state.locale);
  const events = useReputationStore(state => state.events[agentId] ?? []);
  const loading = useReputationStore(
    state => state.loadingByAgent[agentId] ?? false
  );
  const loaded = useReputationStore(
    state => state.loadedByAgent[agentId] ?? false
  );
  const error = useReputationStore(
    state => state.errorsByAgent[agentId] ?? null
  );
  const fetchReputation = useReputationStore(state => state.fetchReputation);

  useEffect(() => {
    void fetchReputation(agentId);
  }, [agentId, fetchReputation]);

  if (loading && !loaded && events.length === 0) {
    return (
      <div className="space-y-2">
        <h4 className="text-xs text-gray-500">
          {t(locale, "信誉变化趋势", "Reputation trend")}
        </h4>
        <p className="text-xs text-gray-500">
          {t(
            locale,
            "正在加载最近的信誉变化…",
            "Loading recent reputation changes..."
          )}
        </p>
      </div>
    );
  }

  if (error && events.length === 0) {
    return (
      <EmptyHintBlock
        tone={error.kind === "error" ? "danger" : "warning"}
        icon={<TriangleAlert className="size-5" />}
        title={t(
          locale,
          "信誉记录暂时不可用",
          "Reputation history is unavailable"
        )}
        description={
          error.kind === "demo"
            ? t(
                locale,
                "当前仍在前端预演模式，还没有可读取的实时信誉记录。",
                "The app is still in browser preview mode, so live reputation history is not available yet."
              )
            : error.kind === "offline"
              ? t(
                  locale,
                  "后端服务暂时没有连上，信誉接口还没返回数据。",
                  "The backend is currently unreachable, so the reputation API has not returned data yet."
                )
              : t(
                  locale,
                  "信誉接口返回了异常结果，界面已经拦截了原始技术报错。",
                  "The reputation API returned an unexpected result, and the raw parser error was suppressed."
                )
        }
        hint={error.message}
        actionLabel={t(locale, "重新加载", "Retry")}
        onAction={() => void fetchReputation(agentId)}
      />
    );
  }

  return (
    <div className="space-y-3">
      {error && events.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/85 px-4 py-3 text-xs text-amber-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 font-semibold">
                <TriangleAlert className="size-4 text-amber-700" />
                {t(
                  locale,
                  "最新信誉请求失败",
                  "The latest reputation refresh failed"
                )}
              </div>
              <div className="mt-1 text-amber-800">{error.message}</div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full border-amber-200 bg-white text-amber-900 hover:bg-amber-100"
              onClick={() => void fetchReputation(agentId)}
            >
              <RotateCcw className="size-4" />
              {t(locale, "重试", "Retry")}
            </Button>
          </div>
        </div>
      ) : null}

      <div>
        <h4 className="mb-1 text-xs text-gray-500">
          {t(locale, "信誉变化趋势", "Score trend")}
        </h4>
        <ScoreTrend events={events} locale={locale} />
      </div>

      <div>
        <h4 className="mb-1 text-xs text-gray-500">
          {t(locale, "最近变更", "Recent changes")}
        </h4>
        <div className="max-h-48 overflow-y-auto">
          {events.length === 0 ? (
            <EmptyHintBlock
              tone="info"
              icon={<Sparkles className="size-5" />}
              title={t(
                locale,
                "还没有信誉变化记录",
                "No reputation changes yet"
              )}
              description={t(
                locale,
                "这个 Agent 还没有产生新的信誉分事件，所以趋势图和变更列表会先保持为空。",
                "This agent has not produced any reputation updates yet, so the trend and recent-change list are still empty."
              )}
              hint={t(
                locale,
                "等任务执行、复核或管理员调整发生后，这里会自动更新。",
                "Run a task, complete a review, or adjust the profile to populate this timeline."
              )}
            />
          ) : (
            events
              .slice(0, 50)
              .map(event => (
                <EventRow key={event.id} event={event} locale={locale} />
              ))
          )}
        </div>
      </div>
    </div>
  );
}
