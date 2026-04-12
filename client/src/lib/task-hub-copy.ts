import type { ClarificationQuestion } from "@shared/nl-command/contracts";

import type { AppLocale } from "./locale";
import { useAppStore } from "./store";

export type TaskHubClarificationTopic =
  | "outcome"
  | "timeline"
  | "constraints";

interface TaskHubQuestionCopy {
  text: string;
  context: string;
}

interface TaskHubCopy {
  defaultMissionTitle: string;
  questions: Record<TaskHubClarificationTopic, TaskHubQuestionCopy>;
  constraints: {
    zeroDowntime: string;
    rollback: string;
    budget: string;
    timeline: string;
  };
  assumptions: {
    pendingOutcome: string;
    readyOutcome: string;
    pendingTimeline: string;
    readyTimeline: string;
  };
  entityDescription: string;
  risks: {
    pendingScope: string;
    alignedScope: string;
    mitigation: string;
  };
  refinedExtraContextPrefix: string;
  clarifiedTopics: Record<TaskHubClarificationTopic, string>;
  missionBrief: {
    command: string;
    objectives: string;
    constraints: string;
    clarifications: string;
  };
  plan: {
    scopeTitle: string;
    scopeDescription: string;
    executeDescription: string;
    reviewTitle: string;
    reviewDescription: string;
    reviewObjective: string;
    briefAligned: string;
    handoffReady: string;
    fallbackDescription: string;
    fallbackTrigger: string;
    fallbackAction: string;
    fallbackImpact: string;
    degradationStrategies: [string, string];
    rollbackPlan: string;
  };
  errors: {
    noActiveSession: string;
    createMissionFromCommand: string;
    createMissionFromClarification: string;
  };
}

function t(locale: AppLocale, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

const EXACT_PREVIEW_TEXT = [
  { zh: "新任务", en: "New mission" },
  { zh: "尽量保持零停机，或至少让用户无感知地完成交付。", en: "Maintain zero-downtime or user-transparent delivery." },
  { zh: "需要预留一条明确可执行的回滚路径。", en: "Keep an explicit rollback path available." },
  { zh: "执行过程需要遵守已提出的预算与成本边界。", en: "Respect the stated budget and execution-cost boundaries." },
  { zh: "交付节奏需要对齐这条指令里提到的时间要求。", en: "Keep delivery aligned with the requested timeline." },
  { zh: "成功标准需要在任务工作台里进一步确认。", en: "Success criteria should be confirmed inside the task workspace." },
  { zh: "当前目标已经足够明确，可以直接进入执行。", en: "The requested outcome is clear enough to open execution immediately." },
  { zh: "在操作人补充明确时间点之前，时间安排暂时保持弹性。", en: "Timeline is flexible until the operator adds a deadline." },
  { zh: "这条指令已经携带了明确的时间预期。", en: "Timeline expectations are already embedded in the command." },
  { zh: "这是从指令里推断出的主要执行目标。", en: "Primary execution target inferred from the command." },
  { zh: "在指令补充完整之前，范围漂移的风险会更高。", en: "Scope drift is likely until the command is clarified." },
  { zh: "执行质量取决于任务简报是否能持续对齐原始指令。", en: "Execution quality depends on keeping the task brief aligned with the command." },
  { zh: "优先在任务详情里确认范围、阻塞点和操作人决策。", en: "Use the task detail panel to confirm scope, blockers, and operator decisions." },
  { zh: "锁定范围与验收口径", en: "Lock scope and acceptance" },
  { zh: "把这条指令整理成可执行的任务简报，并确认成功标准。", en: "Translate the command into an execution-ready brief and confirm success criteria." },
  { zh: "推进主执行链路，并持续把阻塞信息同步回任务详情。", en: "Carry out the main workstream and keep the task detail panel updated with blockers." },
  { zh: "复核结果并准备操作人交接", en: "Review outcome and operator handoff" },
  { zh: "核对结果、整理剩余风险，并准备下一步操作人动作。", en: "Verify the result, summarize remaining risks, and prepare the next operator action." },
  { zh: "复核交付物，并确认下一步操作动作。", en: "Review deliverables and confirm the next operator action." },
  { zh: "简报已对齐", en: "Brief aligned" },
  { zh: "操作人交接就绪", en: "Operator handoff ready" },
  { zh: "回退到一个更小范围的交付切片。", en: "Fall back to a smaller scoped delivery slice." },
  { zh: "当时间压力或阻塞压力在执行中持续升高时触发。", en: "Timeline or blocker pressure rises during execution." },
  { zh: "裁掉非关键工作，把当前可见任务继续稳定推进。", en: "Trim non-critical work and keep the operator-visible task active." },
  { zh: "范围缩小，但恢复速度更快。", en: "Lower scope, faster recovery." },
  { zh: "让任务继续留在队列里，把次级范围延后处理。", en: "Keep the mission open in the task queue and defer secondary scope." },
  { zh: "用操作动作去暂停、重试或标记阻塞，而不是丢失上下文。", en: "Use operator actions to pause, retry, or mark blocked without losing context." },
  { zh: "如果执行质量回退，就暂停任务并从最近一个稳定的操作检查点恢复。", en: "If execution quality regresses, pause the mission and resume from the last stable operator checkpoint." },
  { zh: "补充上下文：", en: "Extra context:" },
];

const BRIEF_LABELS = [
  { zh: "指令：", en: "Command:" },
  { zh: "目标：", en: "Objectives:" },
  { zh: "约束：", en: "Constraints:" },
  { zh: "补充说明：", en: "Clarifications:" },
];

export function getCurrentTaskHubLocale(): AppLocale {
  return useAppStore.getState().locale;
}

export function getTaskHubCopy(locale: AppLocale): TaskHubCopy {
  return {
    defaultMissionTitle: t(locale, "新任务", "New mission"),
    questions: {
      outcome: {
        text: t(
          locale,
          "这条指令里，最重要的交付结果或产出物是什么？",
          "What concrete outcome or deliverable matters most for this command?"
        ),
        context: t(
          locale,
          "把成功标准补清楚之后，这条任务会更容易准确落地。",
          "Adding the success criteria makes the task landing much clearer."
        ),
      },
      timeline: {
        text: t(
          locale,
          "这项工作有没有明确的时间窗口、截止点或里程碑？",
          "Does this work have a clear time window or deadline?"
        ),
        context: t(
          locale,
          "例如：今天内、本周内、上线前，或者某个里程碑之前。",
          "For example: today, this week, before release, or before a milestone."
        ),
      },
      constraints: {
        text: t(
          locale,
          "这条任务有没有必须守住的约束、风险边界，或回滚要求？",
          "Are there constraints, risk boundaries, or rollback requirements we must keep?"
        ),
        context: t(
          locale,
          "例如：零停机、兼容性、预算、审计要求，或可回滚路径。",
          "For example: zero downtime, compatibility, budget, audit, or a rollback path."
        ),
      },
    },
    constraints: {
      zeroDowntime: t(
        locale,
        "尽量保持零停机，或至少让用户无感知地完成交付。",
        "Maintain zero-downtime or user-transparent delivery."
      ),
      rollback: t(
        locale,
        "需要预留一条明确可执行的回滚路径。",
        "Keep an explicit rollback path available."
      ),
      budget: t(
        locale,
        "执行过程需要遵守已提出的预算与成本边界。",
        "Respect the stated budget and execution-cost boundaries."
      ),
      timeline: t(
        locale,
        "交付节奏需要对齐这条指令里提到的时间要求。",
        "Keep delivery aligned with the requested timeline."
      ),
    },
    assumptions: {
      pendingOutcome: t(
        locale,
        "成功标准需要在任务工作台里进一步确认。",
        "Success criteria should be confirmed inside the task workspace."
      ),
      readyOutcome: t(
        locale,
        "当前目标已经足够明确，可以直接进入执行。",
        "The requested outcome is clear enough to open execution immediately."
      ),
      pendingTimeline: t(
        locale,
        "在操作人补充明确时间点之前，时间安排暂时保持弹性。",
        "Timeline is flexible until the operator adds a deadline."
      ),
      readyTimeline: t(
        locale,
        "这条指令已经携带了明确的时间预期。",
        "Timeline expectations are already embedded in the command."
      ),
    },
    entityDescription: t(
      locale,
      "这是从指令里推断出的主要执行目标。",
      "Primary execution target inferred from the command."
    ),
    risks: {
      pendingScope: t(
        locale,
        "在指令补充完整之前，范围漂移的风险会更高。",
        "Scope drift is likely until the command is clarified."
      ),
      alignedScope: t(
        locale,
        "执行质量取决于任务简报是否能持续对齐原始指令。",
        "Execution quality depends on keeping the task brief aligned with the command."
      ),
      mitigation: t(
        locale,
        "优先在任务详情里确认范围、阻塞点和操作人决策。",
        "Use the task detail panel to confirm scope, blockers, and operator decisions."
      ),
    },
    refinedExtraContextPrefix: t(locale, "补充上下文：", "Extra context:"),
    clarifiedTopics: {
      outcome: t(locale, "已补充交付结果", "Clarified outcome"),
      timeline: t(locale, "已补充时间要求", "Clarified timeline"),
      constraints: t(locale, "已补充约束边界", "Clarified constraints"),
    },
    missionBrief: {
      command: t(locale, "指令：", "Command:"),
      objectives: t(locale, "目标：", "Objectives:"),
      constraints: t(locale, "约束：", "Constraints:"),
      clarifications: t(locale, "补充说明：", "Clarifications:"),
    },
    plan: {
      scopeTitle: t(locale, "锁定范围与验收口径", "Lock scope and acceptance"),
      scopeDescription: t(
        locale,
        "把这条指令整理成可执行的任务简报，并确认成功标准。",
        "Translate the command into an execution-ready brief and confirm success criteria."
      ),
      executeDescription: t(
        locale,
        "推进主执行链路，并持续把阻塞信息同步回任务详情。",
        "Carry out the main workstream and keep the task detail panel updated with blockers."
      ),
      reviewTitle: t(
        locale,
        "复核结果并准备操作人交接",
        "Review outcome and operator handoff"
      ),
      reviewDescription: t(
        locale,
        "核对结果、整理剩余风险，并准备下一步操作人动作。",
        "Verify the result, summarize remaining risks, and prepare the next operator action."
      ),
      reviewObjective: t(
        locale,
        "复核交付物，并确认下一步操作动作。",
        "Review deliverables and confirm the next operator action."
      ),
      briefAligned: t(locale, "简报已对齐", "Brief aligned"),
      handoffReady: t(locale, "操作人交接就绪", "Operator handoff ready"),
      fallbackDescription: t(
        locale,
        "回退到一个更小范围的交付切片。",
        "Fall back to a smaller scoped delivery slice."
      ),
      fallbackTrigger: t(
        locale,
        "当时间压力或阻塞压力在执行中持续升高时触发。",
        "Timeline or blocker pressure rises during execution."
      ),
      fallbackAction: t(
        locale,
        "裁掉非关键工作，把当前可见任务继续稳定推进。",
        "Trim non-critical work and keep the operator-visible task active."
      ),
      fallbackImpact: t(
        locale,
        "范围缩小，但恢复速度更快。",
        "Lower scope, faster recovery."
      ),
      degradationStrategies: [
        t(
          locale,
          "让任务继续留在队列里，把次级范围延后处理。",
          "Keep the mission open in the task queue and defer secondary scope."
        ),
        t(
          locale,
          "用操作动作去暂停、重试或标记阻塞，而不是丢失上下文。",
          "Use operator actions to pause, retry, or mark blocked without losing context."
        ),
      ],
      rollbackPlan: t(
        locale,
        "如果执行质量回退，就暂停任务并从最近一个稳定的操作检查点恢复。",
        "If execution quality regresses, pause the mission and resume from the last stable operator checkpoint."
      ),
    },
    errors: {
      noActiveSession: t(
        locale,
        "当前没有可继续的任务中台补充会话。",
        "No active task-hub clarification session."
      ),
      createMissionFromCommand: t(
        locale,
        "未能根据这条指令创建任务。",
        "Failed to create a mission from the command."
      ),
      createMissionFromClarification: t(
        locale,
        "未能根据补充信息创建任务。",
        "Failed to create a mission from the clarification flow."
      ),
    },
  };
}

export function buildPreviewClarificationQuestion(
  topic: TaskHubClarificationTopic,
  locale: AppLocale
): ClarificationQuestion {
  const copy = getTaskHubCopy(locale).questions[topic];
  return {
    questionId: `${topic}:preview`,
    text: copy.text,
    type: "free_text",
    context: copy.context,
  };
}

function getQuestionTopic(
  question: Pick<ClarificationQuestion, "questionId" | "text">
): TaskHubClarificationTopic | null {
  if (question.questionId.startsWith("outcome:")) return "outcome";
  if (question.questionId.startsWith("timeline:")) return "timeline";
  if (question.questionId.startsWith("constraints:")) return "constraints";

  const lookup = question.text.trim();
  if (
    lookup ===
      "What concrete outcome or deliverable matters most for this command?" ||
    lookup === "这条指令里，最重要的交付结果或产出物是什么？"
  ) {
    return "outcome";
  }
  if (
    lookup === "Does this work have a clear time window or deadline?" ||
    lookup === "这项工作有没有明确的时间窗口、截止点或里程碑？"
  ) {
    return "timeline";
  }
  if (
    lookup ===
      "Are there constraints, risk boundaries, or rollback requirements we must keep?" ||
    lookup === "这条任务有没有必须守住的约束、风险边界，或回滚要求？"
  ) {
    return "constraints";
  }

  return null;
}

export function localizeTaskHubQuestion(
  question: ClarificationQuestion,
  locale: AppLocale
): ClarificationQuestion {
  const topic = getQuestionTopic(question);
  if (topic) {
    const localized = buildPreviewClarificationQuestion(topic, locale);
    return {
      ...question,
      text: localized.text,
      context: localized.context,
      options: question.options?.map(option =>
        localizeTaskHubText(option, locale)
      ),
    };
  }

  return {
    ...question,
    text: localizeTaskHubText(question.text, locale),
    context: question.context
      ? localizeTaskHubText(question.context, locale)
      : question.context,
    options: question.options?.map(option => localizeTaskHubText(option, locale)),
  };
}

export function localizeTaskHubText(value: string, locale: AppLocale): string {
  if (!value) return value;

  let next = value;
  const isZh = locale === "zh-CN";

  for (const item of EXACT_PREVIEW_TEXT) {
    next = next.split(isZh ? item.en : item.zh).join(isZh ? item.zh : item.en);
  }

  const forwardPatterns: Array<[RegExp, (match: string, detail: string) => string]> = [
    [/^Clarified outcome:\s*(.+)$/gm, (_match, detail) => `已补充交付结果：${detail}`],
    [/^Clarified timeline:\s*(.+)$/gm, (_match, detail) => `已补充时间要求：${detail}`],
    [/^Clarified constraints:\s*(.+)$/gm, (_match, detail) => `已补充约束边界：${detail}`],
  ];

  const reversePatterns: Array<[RegExp, (match: string, detail: string) => string]> = [
    [/^已补充交付结果：\s*(.+)$/gm, (_match, detail) => `Clarified outcome: ${detail}`],
    [/^已补充时间要求：\s*(.+)$/gm, (_match, detail) => `Clarified timeline: ${detail}`],
    [/^已补充约束边界：\s*(.+)$/gm, (_match, detail) => `Clarified constraints: ${detail}`],
  ];

  for (const [pattern, replacer] of isZh ? forwardPatterns : reversePatterns) {
    next = next.replace(pattern, replacer as never);
  }

  return next;
}

export function localizeTaskHubBriefText(
  value: string,
  locale: AppLocale
): string {
  if (!value) return value;

  let next = localizeTaskHubText(value, locale);
  const isZh = locale === "zh-CN";

  for (const item of BRIEF_LABELS) {
    next = next.replace(
      new RegExp(`^${escapeRegExp(isZh ? item.en : item.zh)}`, "gm"),
      isZh ? item.zh : item.en
    );
  }

  return next;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
