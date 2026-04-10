import type {
  InteriorAgentStatus,
  InteriorStageStatus,
  MissionTaskDetail,
  MissionTaskStatus,
  TaskInteriorAgent,
  TaskArtifact,
  TimelineLevel,
} from "@/lib/tasks-store";
import type {
  MissionOperatorActionType,
  MissionOperatorState,
} from "@shared/mission/contracts";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

type TaskHelperCopy = {
  times: {
    notYet: string;
    notAvailable: string;
    minuteAgo: (minutes: number) => string;
    hourAgo: (hours: number) => string;
    dayAgo: (days: number) => string;
  };
  statuses: {
    mission: Record<MissionTaskStatus, string>;
    operator: Record<MissionOperatorState, string>;
    action: Record<MissionOperatorActionType, string>;
    agent: Record<InteriorAgentStatus, string>;
  };
  actionDescriptions: {
    pauseQueued: string;
    pause: string;
    resume: string;
    retry: (attempt: number) => string;
    markBlocked: string;
    terminate: string;
  };
  summaryLabels: {
    currentOwner: string;
    blockerWaiting: string;
    nextStep: string;
  };
  passive: {
    pendingDecision: string;
    terminating: string;
    completed: string;
    running: string;
    generic: string;
  };
  primaryActions: {
    submitDecision: string;
    submitDecisionFallback: string;
  };
  owner: {
    humanOperator: string;
    userDecisionRequired: string;
    decisionWaitingFallback: string;
    waitingMeta: string;
    activeAgentFallback: (role: string, stage: string) => string;
    blockedDetail: string;
    pausedDetail: string;
    executorRuntime: string;
    executorFallback: (status: string) => string;
    humanFollowUp: string;
    humanFollowUpDetail: string;
    missionComplete: string;
    missionCompleteDetail: string;
    missionCoordination: string;
    missionCoordinationDetail: string;
    completedMeta: (relative: string) => string;
  };
  blocker: {
    blocked: string;
    blockedFallback: string;
    addedBy: (name: string) => string;
    addedAt: (relative: string) => string;
    resolveBeforeResume: string;
    waitingForDecision: string;
    waitingFallback: string;
    decisionRequired: string;
    paused: string;
    pausedFallback: string;
    requestedBy: (name: string) => string;
    noActiveBlocker: string;
    clearToContinue: string;
    completedWithoutBlocker: string;
    clearToContinueDetail: string;
  };
  nextStep: {
    waitForTerminationTitle: string;
    waitForTerminationDetail: string;
    submitDecisionTitle: string;
    submitDecisionFallback: string;
    decisionRequired: string;
    resolveBlockerTitle: string;
    resolveBlockerWithReason: (reason: string) => string;
    resolveBlockerFallback: string;
    attempt: (attempt: number) => string;
    resumeWhenReadyTitle: string;
    resumeWhenReadyDetail: string;
    waitExecutionTitle: string;
    queuedAccepted: string;
    queuedFallback: string;
    runningExecutorTitle: string;
    runningStageTitle: string;
    runningExecutorFallback: string;
    runningStageFallback: string;
    reviewFailureTitle: string;
    failureFallback: string;
    cancelledTitle: string;
    cancelledDetail: string;
    reviewDeliverablesTitle: string;
    deliverablesCount: (count: number) => string;
    completedFallback: string;
    completedMeta: (relative: string) => string;
  };
  role: {
    ceo: string;
    manager: string;
    worker: string;
  };
  artifact: {
    downloadAttachment: string;
    openLink: string;
    openArtifact: string;
    viewMetadata: string;
    downloadMarkdown: string;
    downloadReport: string;
  };
};

const TASK_HELPER_COPY: Record<AppLocale, TaskHelperCopy> = {
  "zh-CN": {
    times: {
      notYet: "尚未记录",
      notAvailable: "暂无",
      minuteAgo: minutes => `${minutes} 分钟前`,
      hourAgo: hours => `${hours} 小时前`,
      dayAgo: days => `${days} 天前`,
    },
    statuses: {
      mission: {
        queued: "排队中",
        running: "执行中",
        waiting: "等待中",
        done: "已完成",
        failed: "失败",
        cancelled: "已取消",
      },
      operator: {
        active: "进行中",
        paused: "已暂停",
        blocked: "已阻塞",
        terminating: "终止中",
      },
      action: {
        pause: "暂停",
        resume: "恢复",
        retry: "重试",
        "mark-blocked": "标记阻塞",
        terminate: "终止",
      },
      agent: {
        idle: "空闲",
        working: "执行中",
        thinking: "思考中",
        done: "完成",
        error: "异常",
      },
    },
    actionDescriptions: {
      pauseQueued: "在执行开始前先暂停这个任务。",
      pause: "暂停当前任务，但保留执行上下文。",
      resume: "让任务回到活跃执行路径。",
      retry: attempt =>
        `保留交付物、时间线和操作历史，排队开始新一轮尝试。当前为第 ${attempt} 次。`,
      markBlocked: "将任务标记为阻塞，但不结束它，让团队知道需要先处理什么依赖。",
      terminate: "复用取消链路停止任务。这是一个终态操作。",
    },
    summaryLabels: {
      currentOwner: "当前负责人",
      blockerWaiting: "阻塞 / 等待",
      nextStep: "下一步动作",
    },
    passive: {
      pendingDecision: "首屏有一个待处理决策，需要优先关注。",
      terminating: "终止流程已在进行中，当前不需要额外人工操作。",
      completed: "当前不需要手动操作，可以直接审阅完成结果。",
      running: "任务正在执行中，当前无需人工介入。",
      generic: "当前状态暂时不需要人工介入。",
    },
    primaryActions: {
      submitDecision: "提交决策",
      submitDecisionFallback: "审阅待处理决策后继续推进任务。",
    },
    owner: {
      humanOperator: "人工协调人",
      userDecisionRequired: "需要用户决策",
      decisionWaitingFallback: "任务在继续之前需要人工输入。",
      waitingMeta: "等待处理",
      activeAgentFallback: (role, stage) => `${role} 正在处理 ${stage}。`,
      blockedDetail: "当前需要人工跟进才能继续推进任务。",
      pausedDetail: "任务已被人工暂停。",
      executorRuntime: "执行器运行时",
      executorFallback: status => `执行器 ${status} 正在处理当前尝试。`,
      humanFollowUp: "需要人工跟进",
      humanFollowUpDetail: "建议先审阅失败原因，再决定是否重试。",
      missionComplete: "任务已完成",
      missionCompleteDetail: "当前不再需要活跃负责人。",
      missionCoordination: "任务协同中",
      missionCoordinationDetail: "任务正在等待下一条执行更新。",
      completedMeta: relative => `完成于 ${relative}`,
    },
    blocker: {
      blocked: "已阻塞",
      blockedFallback: "任务当前被阻塞，等待后续处理。",
      addedBy: name => `添加者：${name}`,
      addedAt: relative => `添加于 ${relative}`,
      resolveBeforeResume: "先解决阻塞，再恢复执行。",
      waitingForDecision: "等待决策",
      waitingFallback: "任务正在等待人工输入。",
      decisionRequired: "需要决策后继续",
      paused: "已暂停",
      pausedFallback: "任务已暂停，可以随时恢复。",
      requestedBy: name => `发起者：${name}`,
      noActiveBlocker: "当前无阻塞",
      clearToContinue: "可继续推进",
      completedWithoutBlocker: "任务已完成，且没有活跃阻塞。",
      clearToContinueDetail: "当前没有记录阻塞项或等待条件。",
    },
    nextStep: {
      waitForTerminationTitle: "等待终止完成",
      waitForTerminationDetail: "该任务的取消流程已经在进行中。",
      submitDecisionTitle: "提交待处理决策",
      submitDecisionFallback: "使用下方决策控件继续推进执行。",
      decisionRequired: "需要决策",
      resolveBlockerTitle: "解决阻塞后恢复任务",
      resolveBlockerWithReason: reason => `先处理“${reason}”，再恢复或重试这次尝试。`,
      resolveBlockerFallback: "先解决阻塞，再恢复或重试这次尝试。",
      attempt: attempt => `第 ${attempt} 次尝试`,
      resumeWhenReadyTitle: "准备好后恢复任务",
      resumeWhenReadyDetail: "执行上下文已保留，恢复后会从当前节点继续。",
      waitExecutionTitle: "等待执行开始",
      queuedAccepted: "执行器已经接收任务，预计很快开始。",
      queuedFallback: "任务正在排队等待下一个可用运行时。",
      runningExecutorTitle: "等待下一条执行器更新",
      runningStageTitle: "让当前阶段继续推进",
      runningExecutorFallback: "运行时仍在工作，会继续产出下一条信号或交付物。",
      runningStageFallback: "任务会沿当前阶段自动继续推进。",
      reviewFailureTitle: "审阅失败原因并决定是否重试",
      failureFallback: "任务在完成前提前中断。",
      cancelledTitle: "决定是否重试这个任务",
      cancelledDetail: "该任务已取消；如果需要继续，可在准备好后重新排队。",
      reviewDeliverablesTitle: "审阅交付并完成交接",
      deliverablesCount: count => `当前有 ${count} 个关联交付物可供审阅。`,
      completedFallback: "任务已成功完成，可以进入交接。",
      completedMeta: relative => `完成于 ${relative}`,
    },
    role: {
      ceo: "总负责人",
      manager: "负责人",
      worker: "执行者",
    },
    artifact: {
      downloadAttachment: "下载附件",
      openLink: "打开链接",
      openArtifact: "打开交付物",
      viewMetadata: "查看元数据",
      downloadMarkdown: "下载 Markdown",
      downloadReport: "下载报告",
    },
  },
  "en-US": {
    times: {
      notYet: "Not yet",
      notAvailable: "n/a",
      minuteAgo: minutes => `${minutes} min ago`,
      hourAgo: hours => `${hours}h ago`,
      dayAgo: days => `${days}d ago`,
    },
    statuses: {
      mission: {
        queued: "Queued",
        running: "Running",
        waiting: "Waiting",
        done: "Done",
        failed: "Failed",
        cancelled: "Cancelled",
      },
      operator: {
        active: "Active",
        paused: "Paused",
        blocked: "Blocked",
        terminating: "Terminating",
      },
      action: {
        pause: "Pause",
        resume: "Resume",
        retry: "Retry",
        "mark-blocked": "Mark Blocked",
        terminate: "Terminate",
      },
      agent: {
        idle: "Idle",
        working: "Working",
        thinking: "Thinking",
        done: "Done",
        error: "Error",
      },
    },
    actionDescriptions: {
      pauseQueued: "Hold this mission before executor work starts.",
      pause: "Pause the current mission without losing execution context.",
      resume: "Return this mission to the active execution path.",
      retry: attempt =>
        `Queue a fresh attempt while keeping deliverables, timeline, and action history. Current attempt: ${attempt}.`,
      markBlocked: "Flag the mission as blocked without ending it, so the team can see what follow-up is needed.",
      terminate: "Stop the mission by reusing the cancel flow. This is a terminal action.",
    },
    summaryLabels: {
      currentOwner: "Current owner",
      blockerWaiting: "Blocker / waiting",
      nextStep: "Next step",
    },
    passive: {
      pendingDecision: "A pending decision needs attention in the first screen below.",
      terminating: "Termination is already in progress. No further manual action is needed right now.",
      completed: "No manual action is needed right now. Review the completed outcome below.",
      running: "The mission is currently running without a manual action requirement.",
      generic: "The current state does not require manual intervention.",
    },
    primaryActions: {
      submitDecision: "Submit decision",
      submitDecisionFallback: "Review the pending decision and continue the mission.",
    },
    owner: {
      humanOperator: "Human operator",
      userDecisionRequired: "User decision required",
      decisionWaitingFallback: "Mission is waiting for manual input before it can continue.",
      waitingMeta: "Waiting",
      activeAgentFallback: (role, stage) => `${role} is handling ${stage}.`,
      blockedDetail: "Manual follow-up is currently holding this mission.",
      pausedDetail: "Execution is paused under manual control.",
      executorRuntime: "Executor runtime",
      executorFallback: status => `Executor ${status} is handling the current attempt.`,
      humanFollowUp: "Human follow-up",
      humanFollowUpDetail: "A human should review the failure before retrying.",
      missionComplete: "Mission complete",
      missionCompleteDetail: "No active owner is required right now.",
      missionCoordination: "Mission coordination",
      missionCoordinationDetail: "The mission is waiting for the next runtime update.",
      completedMeta: relative => `Completed ${relative}`,
    },
    blocker: {
      blocked: "Blocked",
      blockedFallback: "Mission is blocked pending follow-up.",
      addedBy: name => `Added by ${name}`,
      addedAt: relative => `Added ${relative}`,
      resolveBeforeResume: "Resolve the blocker before resuming execution.",
      waitingForDecision: "Waiting for decision",
      waitingFallback: "Mission is waiting for manual input.",
      decisionRequired: "Decision required to continue",
      paused: "Paused",
      pausedFallback: "Mission is paused and can be resumed at any time.",
      requestedBy: name => `Requested by ${name}`,
      noActiveBlocker: "No active blocker",
      clearToContinue: "Clear to continue",
      completedWithoutBlocker: "This mission has completed without an active blocker.",
      clearToContinueDetail: "No blocker or waiting condition is recorded right now.",
    },
    nextStep: {
      waitForTerminationTitle: "Wait for termination to finish",
      waitForTerminationDetail: "The cancel flow is already in progress for this mission.",
      submitDecisionTitle: "Submit the pending decision",
      submitDecisionFallback: "Use the decision controls below to continue execution.",
      decisionRequired: "Decision required",
      resolveBlockerTitle: "Resolve the blocker and resume mission",
      resolveBlockerWithReason: reason => `Clear "${reason}" and then resume or retry this attempt.`,
      resolveBlockerFallback: "Resolve the blocker and then resume or retry this attempt.",
      attempt: attempt => `Attempt ${attempt}`,
      resumeWhenReadyTitle: "Resume the mission when ready",
      resumeWhenReadyDetail: "Execution context is preserved. Resume to continue from the current point.",
      waitExecutionTitle: "Wait for execution to start",
      queuedAccepted: "The executor has already accepted the job and should start soon.",
      queuedFallback: "The mission is queued for the next available runtime.",
      runningExecutorTitle: "Wait for the next executor update",
      runningStageTitle: "Let the current stage continue",
      runningExecutorFallback: "The runtime is still working and will publish the next artifact or signal.",
      runningStageFallback: "The mission is progressing automatically through the current stage.",
      reviewFailureTitle: "Review failure details and retry if appropriate",
      failureFallback: "The mission stopped before it could complete.",
      cancelledTitle: "Decide whether to retry this mission",
      cancelledDetail: "The mission was cancelled. Retry to queue a new attempt when you're ready.",
      reviewDeliverablesTitle: "Review deliverables and share the outcome",
      deliverablesCount: count => `There are ${count} linked deliverables ready for review.`,
      completedFallback: "The mission completed successfully and is ready for handoff.",
      completedMeta: relative => `Completed ${relative}`,
    },
    role: {
      ceo: "CEO",
      manager: "Manager",
      worker: "Worker",
    },
    artifact: {
      downloadAttachment: "Download attachment",
      openLink: "Open link",
      openArtifact: "Open deliverable",
      viewMetadata: "View metadata",
      downloadMarkdown: "Download markdown",
      downloadReport: "Download report",
    },
  },
};

function getTaskHelperCopy(locale: AppLocale): TaskHelperCopy {
  return TASK_HELPER_COPY[locale] || TASK_HELPER_COPY["en-US"];
}

export function formatTaskDate(
  value: number | null,
  locale: AppLocale = "en-US"
): string {
  if (!value) return getTaskHelperCopy(locale).times.notYet;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatTaskRelative(
  value: number | null,
  locale: AppLocale = "en-US"
): string {
  const copy = getTaskHelperCopy(locale);
  if (!value) return copy.times.notAvailable;
  const diff = Date.now() - value;
  const minutes = Math.max(1, Math.round(diff / 60000));
  if (minutes < 60) return copy.times.minuteAgo(minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 48) return copy.times.hourAgo(hours);
  const days = Math.round(hours / 24);
  return copy.times.dayAgo(days);
}

export function compactText(
  value: string | null | undefined,
  maxLength = 120
): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}...`
    : normalized;
}

export function missionStatusLabel(
  status: MissionTaskStatus,
  locale: AppLocale = "en-US"
): string {
  return getTaskHelperCopy(locale).statuses.mission[status];
}

export function missionStatusTone(status: MissionTaskStatus): string {
  return cn(
    "border",
    status === "done" && "border-emerald-200 bg-emerald-50 text-emerald-700",
    status === "running" && "border-amber-200 bg-amber-50 text-amber-700",
    status === "waiting" && "border-sky-200 bg-sky-50 text-sky-700",
    status === "queued" && "border-stone-200 bg-stone-50 text-stone-700",
    status === "failed" && "border-rose-200 bg-rose-50 text-rose-700",
    status === "cancelled" && "border-slate-200 bg-slate-50 text-slate-700"
  );
}

export function isMissionTerminal(status: MissionTaskStatus): boolean {
  return status === "done" || status === "failed" || status === "cancelled";
}

export function isMissionCancellable(status: MissionTaskStatus): boolean {
  return status === "queued" || status === "running" || status === "waiting";
}

export function missionOperatorStateLabel(
  state: MissionOperatorState,
  locale: AppLocale = "en-US"
): string {
  return getTaskHelperCopy(locale).statuses.operator[state];
}

export function missionOperatorStateTone(state: MissionOperatorState): string {
  return cn(
    "border",
    state === "active" && "border-stone-200 bg-stone-50 text-stone-700",
    state === "paused" && "border-sky-200 bg-sky-50 text-sky-700",
    state === "blocked" && "border-amber-200 bg-amber-50 text-amber-700",
    state === "terminating" && "border-rose-200 bg-rose-50 text-rose-700"
  );
}

export type TaskInsightTone =
  | "neutral"
  | "info"
  | "warning"
  | "danger"
  | "success";

export interface TaskInsightSummary {
  label: string;
  title: string;
  detail: string;
  meta?: string;
  tone: TaskInsightTone;
}

export interface TaskPrimaryActionChip {
  key: "submit-decision" | MissionOperatorActionType;
  label: string;
  description: string;
  tone: "primary" | "secondary" | "danger";
}

export interface DerivedPrimaryActions {
  recommended: TaskPrimaryActionChip[];
  normalActions: MissionOperatorActionType[];
  dangerousActions: MissionOperatorActionType[];
  passiveMessage: string | null;
  decisionRequired: boolean;
}

export function taskInsightToneClasses(tone: TaskInsightTone): string {
  return cn(
    "border",
    tone === "neutral" && "border-stone-200 bg-stone-50/80 text-stone-700",
    tone === "info" && "border-sky-200 bg-sky-50/85 text-sky-800",
    tone === "warning" && "border-amber-200 bg-amber-50/90 text-amber-900",
    tone === "danger" && "border-rose-200 bg-rose-50/90 text-rose-900",
    tone === "success" && "border-emerald-200 bg-emerald-50/85 text-emerald-800"
  );
}

export function missionOperatorActionLabel(
  action: MissionOperatorActionType,
  locale: AppLocale = "en-US"
): string {
  return getTaskHelperCopy(locale).statuses.action[action];
}

export function missionOperatorActionDescription(
  action: MissionOperatorActionType,
  detail: Pick<MissionTaskDetail, "status" | "attempt">,
  locale: AppLocale = "en-US"
): string {
  const copy = getTaskHelperCopy(locale);
  switch (action) {
    case "pause":
      return detail.status === "queued"
        ? copy.actionDescriptions.pauseQueued
        : copy.actionDescriptions.pause;
    case "resume":
      return copy.actionDescriptions.resume;
    case "retry":
      return copy.actionDescriptions.retry(detail.attempt);
    case "mark-blocked":
      return copy.actionDescriptions.markBlocked;
    case "terminate":
      return copy.actionDescriptions.terminate;
  }
}

function hasPendingDecision(detail: MissionTaskDetail): boolean {
  return (
    detail.status === "waiting" &&
    (detail.decision !== null || detail.decisionPresets.length > 0)
  );
}

function activeMissionAgent(
  agents: TaskInteriorAgent[]
): TaskInteriorAgent | undefined {
  return (
    agents.find(agent => agent.status === "working") ||
    agents.find(agent => agent.status === "thinking")
  );
}

function humanOperatorLabel(detail: MissionTaskDetail): string {
  return (
    detail.latestOperatorAction?.requestedBy ||
    detail.blocker?.createdBy ||
    getTaskHelperCopy("en-US").owner.humanOperator
  );
}

export function availableMissionOperatorActions(
  status: MissionTaskStatus,
  operatorState: MissionOperatorState
): MissionOperatorActionType[] {
  if (status === "failed" || status === "cancelled") {
    return ["retry"];
  }

  if (operatorState === "terminating") {
    return [];
  }

  if (operatorState === "paused") {
    return ["resume", "terminate"];
  }

  if (operatorState === "blocked") {
    return ["resume", "retry", "terminate"];
  }

  if (status === "queued" || status === "running") {
    return ["pause", "mark-blocked", "terminate"];
  }

  if (status === "waiting") {
    return ["mark-blocked", "terminate"];
  }

  return [];
}

export function derivePrimaryActions(
  detail: MissionTaskDetail,
  locale: AppLocale = "en-US"
): DerivedPrimaryActions {
  const copy = getTaskHelperCopy(locale);
  const operatorActions = availableMissionOperatorActions(
    detail.status,
    detail.operatorState
  );
  const decisionRequired = hasPendingDecision(detail);
  const normalActions = operatorActions.filter(
    action => action !== "terminate"
  );
  const dangerousActions = operatorActions.filter(
    action => action === "terminate"
  );

  const recommended: TaskPrimaryActionChip[] = [];

  if (decisionRequired) {
    recommended.push({
      key: "submit-decision",
      label: copy.primaryActions.submitDecision,
      description:
        compactText(
          detail.waitingFor ||
            detail.decisionPrompt ||
            detail.decision?.prompt ||
            copy.primaryActions.submitDecisionFallback,
          120
        ) || copy.primaryActions.submitDecisionFallback,
      tone: "primary",
    });
  }

  const recommendedOperatorAction =
    detail.operatorState === "blocked" && normalActions.includes("resume")
      ? "resume"
      : detail.operatorState === "paused" && normalActions.includes("resume")
        ? "resume"
        : (detail.status === "failed" || detail.status === "cancelled") &&
            normalActions.includes("retry")
          ? "retry"
          : detail.status === "running" && normalActions.includes("pause")
            ? "pause"
            : detail.status === "queued" && normalActions.includes("pause")
              ? "pause"
              : undefined;

  if (recommendedOperatorAction) {
    recommended.push({
      key: recommendedOperatorAction,
      label: missionOperatorActionLabel(recommendedOperatorAction, locale),
      description: missionOperatorActionDescription(
        recommendedOperatorAction,
        detail,
        locale
      ),
      tone: "secondary",
    });
  }

  const passiveMessage = decisionRequired
    ? copy.passive.pendingDecision
    : operatorActions.length === 0
      ? detail.operatorState === "terminating"
        ? copy.passive.terminating
        : detail.status === "done"
          ? copy.passive.completed
          : detail.status === "running"
            ? copy.passive.running
            : copy.passive.generic
      : null;

  return {
    recommended,
    normalActions,
    dangerousActions,
    passiveMessage,
    decisionRequired,
  };
}

export function deriveCurrentOwner(
  detail: MissionTaskDetail,
  locale: AppLocale = "en-US"
): TaskInsightSummary {
  const copy = getTaskHelperCopy(locale);
  const activeAgent = activeMissionAgent(detail.agents);

  if (hasPendingDecision(detail)) {
    return {
      label: copy.summaryLabels.currentOwner,
      title: copy.owner.userDecisionRequired,
      detail:
        compactText(
          detail.waitingFor ||
            detail.decisionPrompt ||
            detail.decision?.prompt ||
            copy.owner.decisionWaitingFallback,
          140
        ) || copy.owner.decisionWaitingFallback,
      meta: detail.currentStageLabel || copy.owner.waitingMeta,
      tone: "info",
    };
  }

  if (activeAgent) {
    const role = roleLabel(activeAgent.role, locale);
    return {
      label: copy.summaryLabels.currentOwner,
      title: activeAgent.name || role,
      detail:
        compactText(
          activeAgent.currentAction ||
            copy.owner.activeAgentFallback(role, activeAgent.stageLabel),
          140
        ) ||
        copy.owner.activeAgentFallback(role, activeAgent.stageLabel),
      meta: [activeAgent.department, activeAgent.stageLabel]
        .filter(Boolean)
        .join(" / "),
      tone: activeAgent.status === "thinking" ? "info" : "neutral",
    };
  }

  if (detail.operatorState === "blocked" || detail.operatorState === "paused") {
    return {
      label: copy.summaryLabels.currentOwner,
      title:
        detail.latestOperatorAction?.requestedBy ||
        detail.blocker?.createdBy ||
        copy.owner.humanOperator,
      detail:
        detail.operatorState === "blocked"
          ? copy.owner.blockedDetail
          : copy.owner.pausedDetail,
      meta:
        compactText(
          detail.latestOperatorAction?.detail ||
            detail.latestOperatorAction?.reason,
          120
        ) || undefined,
      tone: detail.operatorState === "blocked" ? "warning" : "info",
    };
  }

  if (
    detail.executor &&
    (detail.status === "queued" || detail.status === "running")
  ) {
    return {
      label: copy.summaryLabels.currentOwner,
      title: copy.owner.executorRuntime,
      detail:
        compactText(
          detail.lastSignal ||
            copy.owner.executorFallback(detail.executor.status || "runtime"),
          140
        ) ||
        copy.owner.executorFallback(detail.executor.status || "runtime"),
      meta: [detail.executor.status, detail.currentStageLabel]
        .filter(Boolean)
        .join(" / "),
      tone: "neutral",
    };
  }

  if (detail.status === "failed") {
    return {
      label: copy.summaryLabels.currentOwner,
      title: copy.owner.humanFollowUp,
      detail: copy.owner.humanFollowUpDetail,
      meta: detail.currentStageLabel || undefined,
      tone: "danger",
    };
  }

  if (detail.status === "done") {
    return {
      label: copy.summaryLabels.currentOwner,
      title: copy.owner.missionComplete,
      detail: copy.owner.missionCompleteDetail,
      meta:
        detail.completedAt !== null
          ? copy.owner.completedMeta(
              formatTaskRelative(detail.completedAt, locale)
            )
          : undefined,
      tone: "success",
    };
  }

  return {
    label: copy.summaryLabels.currentOwner,
    title: detail.currentStageLabel || copy.owner.missionCoordination,
    detail: copy.owner.missionCoordinationDetail,
    meta: compactText(detail.lastSignal, 120) || undefined,
    tone: "neutral",
  };
}

export function deriveTaskBlocker(
  detail: MissionTaskDetail,
  locale: AppLocale = "en-US"
): TaskInsightSummary {
  const copy = getTaskHelperCopy(locale);
  if (detail.blocker || detail.operatorState === "blocked") {
    return {
      label: copy.summaryLabels.blockerWaiting,
      title: copy.blocker.blocked,
      detail:
        compactText(
          detail.blocker?.reason ||
            detail.latestOperatorAction?.reason ||
            detail.latestOperatorAction?.detail ||
            copy.blocker.blockedFallback,
          160
        ) || copy.blocker.blockedFallback,
      meta: detail.blocker?.createdBy
        ? copy.blocker.addedBy(detail.blocker.createdBy)
        : detail.blocker?.createdAt
          ? copy.blocker.addedAt(
              formatTaskRelative(detail.blocker.createdAt, locale)
            )
          : copy.blocker.resolveBeforeResume,
      tone: "warning",
    };
  }

  if (hasPendingDecision(detail) || detail.status === "waiting") {
    return {
      label: copy.summaryLabels.blockerWaiting,
      title: copy.blocker.waitingForDecision,
      detail:
        compactText(
          detail.waitingFor ||
            detail.decisionPrompt ||
            detail.decision?.prompt ||
            copy.blocker.waitingFallback,
          160
        ) || copy.blocker.waitingFallback,
      meta: hasPendingDecision(detail)
        ? copy.blocker.decisionRequired
        : detail.currentStageLabel || undefined,
      tone: "info",
    };
  }

  if (detail.operatorState === "paused") {
    return {
      label: copy.summaryLabels.blockerWaiting,
      title: copy.blocker.paused,
      detail:
        compactText(
          detail.latestOperatorAction?.reason ||
            detail.latestOperatorAction?.detail ||
            copy.blocker.pausedFallback,
          160
        ) || copy.blocker.pausedFallback,
      meta: detail.latestOperatorAction?.requestedBy
        ? copy.blocker.requestedBy(detail.latestOperatorAction.requestedBy)
        : undefined,
      tone: "info",
    };
  }

  return {
    label: copy.summaryLabels.blockerWaiting,
    title:
      detail.status === "done"
        ? copy.blocker.noActiveBlocker
        : copy.blocker.clearToContinue,
    detail:
      detail.status === "done"
        ? copy.blocker.completedWithoutBlocker
        : copy.blocker.clearToContinueDetail,
    meta: compactText(detail.lastSignal, 120) || undefined,
    tone: detail.status === "done" ? "success" : "neutral",
  };
}

export function deriveNextStep(
  detail: MissionTaskDetail,
  locale: AppLocale = "en-US"
): TaskInsightSummary {
  const copy = getTaskHelperCopy(locale);
  if (detail.operatorState === "terminating") {
    return {
      label: copy.summaryLabels.nextStep,
      title: copy.nextStep.waitForTerminationTitle,
      detail: copy.nextStep.waitForTerminationDetail,
      meta: compactText(detail.latestOperatorAction?.reason, 120) || undefined,
      tone: "warning",
    };
  }

  if (hasPendingDecision(detail)) {
    return {
      label: copy.summaryLabels.nextStep,
      title: copy.nextStep.submitDecisionTitle,
      detail:
        compactText(
          detail.decisionPrompt ||
            detail.waitingFor ||
            detail.decision?.prompt ||
            copy.nextStep.submitDecisionFallback,
          160
        ) || copy.nextStep.submitDecisionFallback,
      meta: copy.nextStep.decisionRequired,
      tone: "info",
    };
  }

  if (detail.operatorState === "blocked") {
    return {
      label: copy.summaryLabels.nextStep,
      title: copy.nextStep.resolveBlockerTitle,
      detail: detail.blocker?.reason
        ? copy.nextStep.resolveBlockerWithReason(
            compactText(detail.blocker.reason, 80)
          )
        : copy.nextStep.resolveBlockerFallback,
      meta: copy.nextStep.attempt(detail.attempt),
      tone: "warning",
    };
  }

  if (detail.operatorState === "paused") {
    return {
      label: copy.summaryLabels.nextStep,
      title: copy.nextStep.resumeWhenReadyTitle,
      detail: copy.nextStep.resumeWhenReadyDetail,
      meta: copy.nextStep.attempt(detail.attempt),
      tone: "info",
    };
  }

  if (detail.status === "queued") {
    return {
      label: copy.summaryLabels.nextStep,
      title: copy.nextStep.waitExecutionTitle,
      detail: detail.executor?.jobId
        ? copy.nextStep.queuedAccepted
        : copy.nextStep.queuedFallback,
      meta: detail.currentStageLabel || missionStatusLabel("queued", locale),
      tone: "neutral",
    };
  }

  if (detail.status === "running") {
    return {
      label: copy.summaryLabels.nextStep,
      title: detail.executor
        ? copy.nextStep.runningExecutorTitle
        : copy.nextStep.runningStageTitle,
      detail:
        compactText(
          detail.lastSignal ||
            detail.waitingFor ||
            (detail.executor
              ? copy.nextStep.runningExecutorFallback
              : copy.nextStep.runningStageFallback),
          160
        ) ||
        (detail.executor
          ? copy.nextStep.runningExecutorFallback
          : copy.nextStep.runningStageFallback),
      meta: detail.currentStageLabel || undefined,
      tone: "neutral",
    };
  }

  if (detail.status === "failed") {
    return {
      label: copy.summaryLabels.nextStep,
      title: copy.nextStep.reviewFailureTitle,
      detail:
        compactText(
          detail.failureReasons[0] ||
            copy.nextStep.failureFallback,
          160
        ) || copy.nextStep.failureFallback,
      meta: copy.nextStep.attempt(detail.attempt),
      tone: "danger",
    };
  }

  if (detail.status === "cancelled") {
    return {
      label: copy.summaryLabels.nextStep,
      title: copy.nextStep.cancelledTitle,
      detail: copy.nextStep.cancelledDetail,
      meta: copy.nextStep.attempt(detail.attempt),
      tone: "warning",
    };
  }

  return {
    label: copy.summaryLabels.nextStep,
    title: copy.nextStep.reviewDeliverablesTitle,
    detail:
      detail.artifacts.length > 0
        ? copy.nextStep.deliverablesCount(detail.artifacts.length)
        : copy.nextStep.completedFallback,
    meta:
      detail.completedAt !== null
        ? copy.nextStep.completedMeta(
            formatTaskRelative(detail.completedAt, locale)
          )
        : undefined,
    tone: "success",
  };
}

export function timelineTone(level: TimelineLevel): string {
  return cn(
    "border",
    level === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
    level === "info" && "border-sky-200 bg-sky-50 text-sky-700",
    level === "warn" && "border-amber-200 bg-amber-50 text-amber-700",
    level === "error" && "border-rose-200 bg-rose-50 text-rose-700"
  );
}

export function stageTone(status: InteriorStageStatus): string {
  return cn(
    "border",
    status === "done" && "border-emerald-200 bg-emerald-50 text-emerald-700",
    status === "running" && "border-amber-200 bg-amber-50 text-amber-700",
    status === "pending" && "border-stone-200 bg-stone-50 text-stone-600",
    status === "failed" && "border-rose-200 bg-rose-50 text-rose-700"
  );
}

export function agentStatusLabel(
  status: InteriorAgentStatus,
  locale: AppLocale = "en-US"
): string {
  return getTaskHelperCopy(locale).statuses.agent[status];
}

export function agentStatusTone(status: InteriorAgentStatus): string {
  return cn(
    "border",
    status === "done" && "border-emerald-200 bg-emerald-50 text-emerald-700",
    status === "working" && "border-amber-200 bg-amber-50 text-amber-700",
    status === "thinking" && "border-sky-200 bg-sky-50 text-sky-700",
    status === "idle" && "border-stone-200 bg-stone-50 text-stone-600",
    status === "error" && "border-rose-200 bg-rose-50 text-rose-700"
  );
}

export function roleLabel(role: string, locale: AppLocale = "en-US"): string {
  const copy = getTaskHelperCopy(locale);
  if (role === "ceo") return copy.role.ceo;
  if (role === "manager") return copy.role.manager;
  if (role === "worker") return copy.role.worker;
  return role;
}

export function artifactActionLabel(
  artifact: TaskArtifact,
  locale: AppLocale = "en-US"
): string {
  const copy = getTaskHelperCopy(locale);
  if (artifact.kind === "attachment") return copy.artifact.downloadAttachment;
  if (artifact.downloadKind === "external") {
    return artifact.kind === "url"
      ? copy.artifact.openLink
      : copy.artifact.openArtifact;
  }
  if (
    !artifact.href &&
    artifact.downloadKind !== "workflow" &&
    artifact.downloadKind !== "department"
  )
    return copy.artifact.viewMetadata;
  if (artifact.format === "md") return copy.artifact.downloadMarkdown;
  return copy.artifact.downloadReport;
}

export function downloadAttachmentArtifact(artifact: TaskArtifact): boolean {
  if (!artifact.content || typeof window === "undefined") {
    return false;
  }

  const blob = new Blob([artifact.content], {
    type: artifact.mimeType || "text/plain;charset=utf-8",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = artifact.filename || "artifact.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  return true;
}
