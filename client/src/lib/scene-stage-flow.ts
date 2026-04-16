import type { AppLocale } from "@/lib/locale";
import type { WorkflowInfo } from "@/lib/runtime/types";
import type { MissionTaskSummary } from "@/lib/tasks-store";

export type SceneFlowZoneId =
  | "mission"
  | "leadDesk"
  | "podA"
  | "podB"
  | "podC"
  | "podD"
  | "lounge";

export type SceneStageSemanticKey =
  | "direction"
  | "planning"
  | "execution"
  | "review"
  | "meta_audit"
  | "revision"
  | "verify"
  | "summary"
  | "feedback"
  | "evolution";

export interface SceneFlowZone {
  id: SceneFlowZoneId;
  position: [number, number, number];
  floorPosition: [number, number, number];
  title: Record<AppLocale, string>;
}

export interface SceneStageRoute {
  stageKey: string;
  semantic: SceneStageSemanticKey;
  zones: SceneFlowZoneId[];
  title: Record<AppLocale, string>;
}

export interface SceneStageSignal {
  source: "mission" | "workflow";
  stageKey: string;
  stageLabel: string;
  semantic: SceneStageSemanticKey;
  color: string;
  zones: SceneFlowZoneId[];
  statusLabel: string;
  summary: string | null;
  progress: number | null;
  taskId: string | null;
}

const FALLBACK_STAGE_COLOR = "#C98257";

function t(locale: AppLocale, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function normalizeStageKey(stageKey: string | null | undefined) {
  return (stageKey || "").trim().toLowerCase();
}

function toNullableText(value: string | null | undefined) {
  const text = (value || "").trim();
  return text ? text : null;
}

function capitalizeWords(value: string) {
  return value.replace(/\b\w/g, char => char.toUpperCase());
}

function isActiveMissionStatus(status: MissionTaskSummary["status"]) {
  return status === "running" || status === "waiting";
}

function isActiveWorkflowStatus(status: WorkflowInfo["status"]) {
  return status === "running" || status === "pending";
}

function pickSceneMission(
  tasks: MissionTaskSummary[],
  selectedTaskId: string | null
) {
  const selectedTask = selectedTaskId
    ? tasks.find(task => task.id === selectedTaskId) || null
    : null;

  if (selectedTask && isActiveMissionStatus(selectedTask.status)) {
    return selectedTask;
  }

  return tasks.find(task => isActiveMissionStatus(task.status)) || null;
}

export const SCENE_STAGE_SEMANTIC_COLORS: Record<
  SceneStageSemanticKey,
  string
> = {
  direction: "#F59E0B",
  planning: "#F97316",
  execution: "#3B82F6",
  review: "#8B5CF6",
  meta_audit: "#7C3AED",
  revision: "#EF4444",
  verify: "#14B8A6",
  summary: "#EAB308",
  feedback: "#22C55E",
  evolution: "#EC4899",
};

export const SCENE_FLOW_ZONES: Record<SceneFlowZoneId, SceneFlowZone> = {
  mission: {
    id: "mission",
    position: [0, 0.5, -2.45],
    floorPosition: [0, 0, -2.45],
    title: {
      "zh-CN": "Mission \u5165\u53e3",
      "en-US": "Mission Entry",
    },
  },
  leadDesk: {
    id: "leadDesk",
    position: [0, 0.48, -3.15],
    floorPosition: [0, 0, -3.15],
    title: {
      "zh-CN": "\u603b\u63a7\u53f0",
      "en-US": "Lead Desk",
    },
  },
  podA: {
    id: "podA",
    position: [-3.5, 0.42, -1.8],
    floorPosition: [-3.5, 0, -1.8],
    title: {
      "zh-CN": "A \u533a",
      "en-US": "Pod A",
    },
  },
  podB: {
    id: "podB",
    position: [3.35, 0.42, -1.72],
    floorPosition: [3.35, 0, -1.72],
    title: {
      "zh-CN": "B \u533a",
      "en-US": "Pod B",
    },
  },
  podC: {
    id: "podC",
    position: [-3.08, 0.42, 2.45],
    floorPosition: [-3.08, 0, 2.45],
    title: {
      "zh-CN": "C \u533a",
      "en-US": "Pod C",
    },
  },
  podD: {
    id: "podD",
    position: [3.25, 0.42, 2.45],
    floorPosition: [3.25, 0, 2.45],
    title: {
      "zh-CN": "D \u533a",
      "en-US": "Pod D",
    },
  },
  lounge: {
    id: "lounge",
    position: [0.2, 0.46, 4.1],
    floorPosition: [0.2, 0, 4.1],
    title: {
      "zh-CN": "\u4ea4\u4ed8\u533a",
      "en-US": "Delivery Lounge",
    },
  },
};

export const SCENE_STAGE_TO_ZONE_MAP: Record<string, SceneStageRoute> = {
  receive: {
    stageKey: "receive",
    semantic: "direction",
    zones: ["mission", "leadDesk"],
    title: {
      "zh-CN": "\u63a5\u6536\u4efb\u52a1",
      "en-US": "Receive Task",
    },
  },
  understand: {
    stageKey: "understand",
    semantic: "planning",
    zones: ["leadDesk", "podA"],
    title: {
      "zh-CN": "\u7406\u89e3\u9700\u6c42",
      "en-US": "Understand Request",
    },
  },
  direction: {
    stageKey: "direction",
    semantic: "direction",
    zones: ["leadDesk", "podA"],
    title: {
      "zh-CN": "\u65b9\u5411\u4e0b\u53d1",
      "en-US": "Direction",
    },
  },
  planning: {
    stageKey: "planning",
    semantic: "planning",
    zones: ["leadDesk", "podA", "podB"],
    title: {
      "zh-CN": "\u4efb\u52a1\u89c4\u5212",
      "en-US": "Planning",
    },
  },
  plan: {
    stageKey: "plan",
    semantic: "planning",
    zones: ["leadDesk", "podA", "podB"],
    title: {
      "zh-CN": "\u751f\u6210\u8ba1\u5212",
      "en-US": "Build Plan",
    },
  },
  provision: {
    stageKey: "provision",
    semantic: "execution",
    zones: ["podA", "podB"],
    title: {
      "zh-CN": "\u51c6\u5907\u73af\u5883",
      "en-US": "Provision Runtime",
    },
  },
  execution: {
    stageKey: "execution",
    semantic: "execution",
    zones: ["podA", "podB", "podC"],
    title: {
      "zh-CN": "\u6267\u884c\u5904\u7406",
      "en-US": "Execution",
    },
  },
  execute: {
    stageKey: "execute",
    semantic: "execution",
    zones: ["podA", "podB", "podC"],
    title: {
      "zh-CN": "\u8fd0\u884c\u6267\u884c",
      "en-US": "Run Execution",
    },
  },
  review: {
    stageKey: "review",
    semantic: "review",
    zones: ["podC", "podD"],
    title: {
      "zh-CN": "\u8bc4\u5ba1",
      "en-US": "Review",
    },
  },
  meta_audit: {
    stageKey: "meta_audit",
    semantic: "meta_audit",
    zones: ["podD", "leadDesk"],
    title: {
      "zh-CN": "\u5143\u5ba1\u8ba1",
      "en-US": "Meta Audit",
    },
  },
  revision: {
    stageKey: "revision",
    semantic: "revision",
    zones: ["podD", "podB", "podC"],
    title: {
      "zh-CN": "\u4fee\u8ba2",
      "en-US": "Revision",
    },
  },
  verify: {
    stageKey: "verify",
    semantic: "verify",
    zones: ["podC", "podD", "mission"],
    title: {
      "zh-CN": "\u9a8c\u8bc1",
      "en-US": "Verify",
    },
  },
  summary: {
    stageKey: "summary",
    semantic: "summary",
    zones: ["podD", "mission"],
    title: {
      "zh-CN": "\u6c47\u603b\u4ea4\u4ed8",
      "en-US": "Summary",
    },
  },
  finalize: {
    stageKey: "finalize",
    semantic: "summary",
    zones: ["podD", "mission"],
    title: {
      "zh-CN": "\u6536\u5c3e\u5b8c\u6210",
      "en-US": "Finalize",
    },
  },
  feedback: {
    stageKey: "feedback",
    semantic: "feedback",
    zones: ["mission", "leadDesk"],
    title: {
      "zh-CN": "\u53cd\u9988\u56de\u8def",
      "en-US": "Feedback",
    },
  },
  evolution: {
    stageKey: "evolution",
    semantic: "evolution",
    zones: ["leadDesk", "lounge"],
    title: {
      "zh-CN": "\u8fdb\u5316\u6c89\u6dc0",
      "en-US": "Evolution",
    },
  },
};

export function getSceneStageRoute(stageKey: string | null | undefined) {
  const normalized = normalizeStageKey(stageKey);
  return normalized ? SCENE_STAGE_TO_ZONE_MAP[normalized] || null : null;
}

export function getSceneStageColor(stageKey: string | null | undefined) {
  const route = getSceneStageRoute(stageKey);
  return route
    ? SCENE_STAGE_SEMANTIC_COLORS[route.semantic]
    : FALLBACK_STAGE_COLOR;
}

export function getSceneStageSignal(params: {
  locale: AppLocale;
  tasks: MissionTaskSummary[];
  selectedTaskId: string | null;
  currentWorkflow: WorkflowInfo | null;
}) {
  const { locale, tasks, selectedTaskId, currentWorkflow } = params;
  const activeMission = pickSceneMission(tasks, selectedTaskId);

  if (activeMission?.currentStageKey) {
    const route = getSceneStageRoute(activeMission.currentStageKey);
    if (route) {
      return {
        source: "mission",
        stageKey: activeMission.currentStageKey,
        stageLabel:
          toNullableText(activeMission.currentStageLabel) ||
          route.title[locale],
        semantic: route.semantic,
        color: SCENE_STAGE_SEMANTIC_COLORS[route.semantic],
        zones: route.zones,
        statusLabel:
          activeMission.status === "waiting"
            ? t(locale, "\u7b49\u5f85\u7ee7\u7eed", "Waiting")
            : t(locale, "\u4efb\u52a1\u8fdb\u884c\u4e2d", "Mission Running"),
        summary: toNullableText(activeMission.summary),
        progress:
          typeof activeMission.progress === "number"
            ? activeMission.progress
            : null,
        taskId: activeMission.id,
      } satisfies SceneStageSignal;
    }
  }

  if (
    currentWorkflow &&
    isActiveWorkflowStatus(currentWorkflow.status) &&
    currentWorkflow.current_stage
  ) {
    const route = getSceneStageRoute(currentWorkflow.current_stage);
    if (route) {
      return {
        source: "workflow",
        stageKey: currentWorkflow.current_stage,
        stageLabel: route.title[locale],
        semantic: route.semantic,
        color: SCENE_STAGE_SEMANTIC_COLORS[route.semantic],
        zones: route.zones,
        statusLabel:
          currentWorkflow.status === "pending"
            ? t(locale, "\u7b49\u5f85\u542f\u52a8", "Pending")
            : t(
                locale,
                "\u5de5\u4f5c\u6d41\u8fdb\u884c\u4e2d",
                "Workflow Running"
              ),
        summary: toNullableText(currentWorkflow.directive),
        progress: null,
        taskId: null,
      } satisfies SceneStageSignal;
    }
  }

  return null;
}

export function getSceneZoneLabel(zoneId: SceneFlowZoneId, locale: AppLocale) {
  return SCENE_FLOW_ZONES[zoneId].title[locale];
}

export function getSceneStageLabel(
  stageKey: string | null | undefined,
  locale: AppLocale
) {
  const route = getSceneStageRoute(stageKey);
  if (route) return route.title[locale];

  const normalized = normalizeStageKey(stageKey);
  if (!normalized)
    return t(locale, "\u6682\u65e0\u9636\u6bb5", "No active stage");

  return capitalizeWords(normalized.replace(/[_-]+/g, " "));
}
