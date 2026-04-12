/**
 * NL Command Center Zustand store.
 *
 * Manages command list, current command, execution plan, alerts, comments,
 * and dashboard state. Wraps REST API calls via nl-command-client and
 * subscribes to Socket.IO nl_command_* events for real-time updates.
 *
 * @see Requirements 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { nanoid } from "nanoid";
import { create } from "zustand";
import type { Socket } from "socket.io-client";

import type {
  StrategicCommand,
  CommandAnalysis,
  CommandConstraint,
  NLExecutionPlan,
  Alert,
  Comment,
  ClarificationDialog,
  ClarificationAnswer,
  ClarificationQuestion,
  MissionDecomposition,
  FinalizedCommand,
  PlanApprovalRequest,
  PlanAdjustment,
} from "@shared/nl-command/contracts";

import type {
  DashboardResponse,
  SubmitCommandRequest,
  ApprovePlanRequest,
  AdjustPlanRequest,
  SubmitClarificationRequest,
  AddCommentRequest,
  ListCommandsRequest,
  ListAlertsRequest,
  ListCommentsRequest,
  GenerateReportRequest,
  CreateAlertRuleRequest,
  SaveTemplateRequest,
} from "@shared/nl-command/api";

import { NL_COMMAND_SOCKET_EVENTS } from "@shared/nl-command/socket";
import type {
  NLCommandCreatedEvent,
  NLCommandAnalysisEvent,
  NLClarificationQuestionEvent,
  NLDecompositionCompleteEvent,
  NLPlanGeneratedEvent,
  NLPlanApprovedEvent,
  NLPlanAdjustedEvent,
  NLAlertEvent,
  NLProgressUpdateEvent,
} from "@shared/nl-command/socket";

import * as api from "./nl-command-client";
import {
  buildPreviewClarificationQuestion,
  getCurrentTaskHubLocale,
  getTaskHubCopy,
  type TaskHubClarificationTopic,
} from "./task-hub-copy";

export interface TaskHubCreateMissionInput {
  kind?: string;
  title?: string;
  sourceText?: string;
  topicId?: string;
  autoDispatch?: boolean;
}

export type TaskHubCreateMission = (
  input: TaskHubCreateMissionInput
) => Promise<string | null>;

export interface TaskHubCommandSubmissionResult {
  commandId: string;
  commandText: string;
  missionId: string | null;
  relatedMissionIds: string[];
  autoSelectedMissionId: string | null;
  status: "needs_clarification" | "created";
  createdAt: number;
}

export interface SubmitTaskHubCommandRequest extends SubmitCommandRequest {
  createMission: TaskHubCreateMission;
}

interface SubmitTaskHubClarificationOptions {
  createMission: TaskHubCreateMission;
}

function normalizeCommandText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compactCommandText(value: string, maxLength = 72): string {
  const normalized = normalizeCommandText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function deriveMissionTitle(commandText: string): string {
  const normalized = normalizeCommandText(commandText);
  if (!normalized) {
    return getTaskHubCopy(getCurrentTaskHubLocale()).defaultMissionTitle;
  }

  const sentence =
    normalized.split(/[。！？.!?]/).find(part => part.trim().length > 0) ||
    normalized;

  return compactCommandText(sentence, 54);
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(
      values
        .map(value => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
}

function hasTimelineSignal(text: string): boolean {
  return /今天|明天|本周|下周|月底|本月|本季度|截止|deadline|launch|release|ship|before|by\s+\w+/i.test(
    text
  );
}

function hasConstraintSignal(text: string): boolean {
  return /零停机|zero downtime|回滚|rollback|预算|budget|风险|risk|约束|constraint|兼容|compliance|sla|测试|test/i.test(
    text
  );
}

function hasOutcomeSignal(text: string): boolean {
  return /交付|deliverable|结果|outcome|验收|acceptance|完成标准|metric|指标|目标|success/i.test(
    text
  );
}

function inferRequiredSkills(text: string): string[] {
  const skills = ["planning"];

  if (/重构|refactor|模块|module|api|service|code|代码/i.test(text)) {
    skills.push("implementation");
  }
  if (/部署|release|ship|上线|rollout|launch/i.test(text)) {
    skills.push("release");
  }
  if (/测试|test|qa|验证|verify/i.test(text)) {
    skills.push("qa");
  }
  if (/文档|report|summary|复盘|handoff/i.test(text)) {
    skills.push("documentation");
  }

  return uniqueStrings(skills);
}

function buildTaskHubObjectives(text: string): string[] {
  const sentences = text
    .split(/[。！？.!?\n]/)
    .map(part => normalizeCommandText(part))
    .filter(Boolean);

  const objectives = sentences.slice(0, 3);
  if (objectives.length > 0) {
    return objectives;
  }

  return [compactCommandText(text, 80)];
}

function buildTaskHubConstraints(text: string): CommandConstraint[] {
  const copy = getTaskHubCopy(getCurrentTaskHubLocale());
  const constraints: CommandConstraint[] = [];

  if (/零停机|zero downtime/i.test(text)) {
    constraints.push({
      type: "quality",
      description: copy.constraints.zeroDowntime,
    });
  }

  if (/回滚|rollback/i.test(text)) {
    constraints.push({
      type: "quality",
      description: copy.constraints.rollback,
    });
  }

  if (/预算|budget|成本/i.test(text)) {
    constraints.push({
      type: "budget",
      description: copy.constraints.budget,
    });
  }

  if (/今天|明天|本周|下周|月底|本月|deadline|before|by\s+\w+/i.test(text)) {
    constraints.push({
      type: "time",
      description: copy.constraints.timeline,
    });
  }

  return constraints;
}

function buildTaskHubAnalysis(req: SubmitCommandRequest): {
  analysis: CommandAnalysis;
  questions: ClarificationQuestion[];
} {
  const locale = getCurrentTaskHubLocale();
  const copy = getTaskHubCopy(locale);
  const commandText = normalizeCommandText(req.commandText);
  const missingTopics = [
    !hasOutcomeSignal(commandText) ? "outcome" : null,
    !hasTimelineSignal(commandText) ? "timeline" : null,
    !hasConstraintSignal(commandText) ? "constraints" : null,
  ].filter((topic): topic is string => Boolean(topic));

  const needsClarification =
    commandText.length < 36 || missingTopics.length >= 2;
  const questions = needsClarification
    ? missingTopics.slice(0, 2).map(topic => ({
        ...buildPreviewClarificationQuestion(
          topic as TaskHubClarificationTopic,
          locale
        ),
        questionId: `${topic}:${nanoid(8)}`,
      }))
    : [];

  const constraints = buildTaskHubConstraints(commandText);
  const objectives = uniqueStrings([
    ...buildTaskHubObjectives(commandText),
    ...(req.objectives || []),
  ]);
  const assumptions = uniqueStrings([
    missingTopics.includes("outcome")
      ? copy.assumptions.pendingOutcome
      : copy.assumptions.readyOutcome,
    missingTopics.includes("timeline")
      ? copy.assumptions.pendingTimeline
      : copy.assumptions.readyTimeline,
  ]);

  return {
    analysis: {
      intent: deriveMissionTitle(commandText),
      entities: [
        {
          name: deriveMissionTitle(commandText),
          type: "concept",
          description: copy.entityDescription,
        },
      ],
      constraints,
      objectives,
      risks: [
        {
          id: `risk-${nanoid(8)}`,
          description: needsClarification
            ? copy.risks.pendingScope
            : copy.risks.alignedScope,
          level: needsClarification ? "medium" : "low",
          probability: needsClarification ? 0.58 : 0.26,
          impact: needsClarification ? 0.72 : 0.34,
          mitigation: copy.risks.mitigation,
        },
      ],
      assumptions,
      confidence: needsClarification ? 0.64 : 0.86,
      needsClarification,
      clarificationTopics: needsClarification ? missingTopics : undefined,
    },
    questions,
  };
}

function buildRefinedCommandText(
  commandText: string,
  answers: ClarificationAnswer[]
): string {
  const normalized = normalizeCommandText(commandText);
  const clarificationSummary = buildTaskHubClarificationSummary(answers);

  if (!clarificationSummary) {
    return normalized;
  }

  const copy = getTaskHubCopy(getCurrentTaskHubLocale());
  return `${normalized} | ${copy.refinedExtraContextPrefix} ${clarificationSummary}`;
}

function buildTaskHubClarificationSummary(
  answers: ClarificationAnswer[]
): string | undefined {
  if (answers.length === 0) {
    return undefined;
  }

  const locale = getCurrentTaskHubLocale();
  return answers
    .map(answer => normalizeCommandText(answer.text))
    .filter(Boolean)
    .join(locale === "zh-CN" ? "；" : "; ");
}

function buildTaskHubFinalizedCommand(
  command: StrategicCommand,
  analysis: CommandAnalysis,
  answers: ClarificationAnswer[]
): FinalizedCommand {
  return {
    commandId: command.commandId,
    originalText: command.commandText,
    refinedText: buildRefinedCommandText(command.commandText, answers),
    analysis,
    clarificationSummary: buildTaskHubClarificationSummary(answers),
    finalizedAt: Date.now(),
  };
}

function applyClarificationToAnalysis(
  analysis: CommandAnalysis,
  answer: ClarificationAnswer
): CommandAnalysis {
  const copy = getTaskHubCopy(getCurrentTaskHubLocale());
  const topic = answer.questionId.split(":")[0];
  const answerText = normalizeCommandText(answer.text);

  const nextObjectives =
    topic === "outcome"
      ? uniqueStrings([answerText, ...analysis.objectives])
      : analysis.objectives;
  const nextConstraints =
    topic === "timeline"
      ? [
          ...analysis.constraints,
          {
            type: "time" as const,
            description: answerText,
          },
        ]
      : topic === "constraints"
        ? [
            ...analysis.constraints,
            {
              type: "custom" as const,
              description: answerText,
            },
          ]
        : analysis.constraints;

  return {
    ...analysis,
    objectives: nextObjectives,
    constraints: nextConstraints,
    assumptions: uniqueStrings([
      ...analysis.assumptions,
      `${
        copy.clarifiedTopics[topic as TaskHubClarificationTopic] ?? topic
      }: ${answerText}`,
    ]),
    confidence: Math.min(0.96, analysis.confidence + 0.12),
  };
}

function buildTaskHubMissionInput(
  command: StrategicCommand,
  analysis: CommandAnalysis,
  answers: ClarificationAnswer[]
): TaskHubCreateMissionInput {
  const copy = getTaskHubCopy(getCurrentTaskHubLocale());
  const sections = [
    `${copy.missionBrief.command} ${command.commandText}`,
    analysis.objectives.length > 0
      ? `${copy.missionBrief.objectives}\n- ${analysis.objectives.join("\n- ")}`
      : null,
    analysis.constraints.length > 0
      ? `${copy.missionBrief.constraints}\n- ${analysis.constraints
          .map(item => item.description)
          .join("\n- ")}`
      : null,
    answers.length > 0
      ? `${copy.missionBrief.clarifications}\n- ${answers
          .map(answer => normalizeCommandText(answer.text))
          .join("\n- ")}`
      : null,
  ].filter(Boolean);

  return {
    kind: "nl-command",
    title: deriveMissionTitle(command.commandText),
    sourceText: sections.join("\n\n"),
    autoDispatch: true,
  };
}

function buildTaskHubPlan(params: {
  command: StrategicCommand;
  analysis: CommandAnalysis;
  answers: ClarificationAnswer[];
  missionId?: string | null;
  status: NLExecutionPlan["status"];
}): NLExecutionPlan {
  const copy = getTaskHubCopy(getCurrentTaskHubLocale());
  const { command, analysis, answers, missionId = null, status } = params;
  const now = Date.now();
  const missionKey = missionId || `draft-${command.commandId}`;
  const skills = inferRequiredSkills(command.commandText);
  const objectives = analysis.objectives.length
    ? analysis.objectives
    : [command.commandText];
  const mission = {
    missionId: missionKey,
    title: deriveMissionTitle(command.commandText),
    description: buildRefinedCommandText(command.commandText, answers),
    objectives,
    constraints: analysis.constraints,
    estimatedDuration: 150,
    estimatedCost: 180,
    priority: command.priority,
  };
  const tasks = [
    {
      taskId: `${missionKey}:scope`,
      title: copy.plan.scopeTitle,
      description: copy.plan.scopeDescription,
      objectives: [objectives[0]],
      constraints: analysis.constraints,
      estimatedDuration: 35,
      estimatedCost: 40,
      requiredSkills: uniqueStrings(["planning", "coordination"]),
      priority: command.priority,
    },
    {
      taskId: `${missionKey}:execute`,
      title: mission.title,
      description: copy.plan.executeDescription,
      objectives,
      constraints: analysis.constraints,
      estimatedDuration: 80,
      estimatedCost: 95,
      requiredSkills: skills,
      priority: command.priority,
    },
    {
      taskId: `${missionKey}:review`,
      title: copy.plan.reviewTitle,
      description: copy.plan.reviewDescription,
      objectives: [copy.plan.reviewObjective],
      constraints: [],
      estimatedDuration: 35,
      estimatedCost: 45,
      requiredSkills: uniqueStrings(["review", "documentation"]),
      priority: "medium" as const,
    },
  ];
  const totalBudget = tasks.reduce(
    (sum, item) => sum + item.estimatedCost,
    mission.estimatedCost
  );
  const startDate = new Date(now).toISOString();
  const endDate = new Date(now + 150 * 60_000).toISOString();

  return {
    planId: `task-hub-plan-${missionKey}`,
    commandId: command.commandId,
    status,
    missions: [mission],
    tasks,
    timeline: {
      startDate,
      endDate,
      criticalPath: [mission.missionId, ...tasks.map(task => task.taskId)],
      milestones: [
        {
          id: `${missionKey}:brief`,
          label: copy.plan.briefAligned,
          date: startDate,
          entityId: tasks[0].taskId,
        },
        {
          id: `${missionKey}:handoff`,
          label: copy.plan.handoffReady,
          date: endDate,
          entityId: tasks[2].taskId,
        },
      ],
      entries: tasks.map((task, index) => ({
        entityId: task.taskId,
        entityType: "task" as const,
        startTime: now + index * 45 * 60_000,
        endTime: now + (index + 1) * 45 * 60_000,
        duration: task.estimatedDuration,
        isCriticalPath: index !== 0,
        parallelGroup: index === 1 ? 1 : undefined,
      })),
    },
    resourceAllocation: {
      entries: tasks.map(task => ({
        taskId: task.taskId,
        agentType: task.requiredSkills[0] || "operator",
        agentCount: 1,
        requiredSkills: task.requiredSkills,
        startTime: now,
        endTime: now + task.estimatedDuration * 60_000,
      })),
      totalAgents: 3,
      peakConcurrency: 2,
    },
    riskAssessment: {
      risks: analysis.risks,
      overallRiskLevel: analysis.needsClarification ? "medium" : "low",
    },
    costBudget: {
      totalBudget,
      missionCosts: { [mission.missionId]: mission.estimatedCost },
      taskCosts: Object.fromEntries(
        tasks.map(task => [task.taskId, task.estimatedCost])
      ),
      agentCosts: {
        operator: 65,
        specialist: 70,
        reviewer: 45,
      },
      modelCosts: {
        "task-hub-preview": 12,
      },
      currency: "USD",
    },
    contingencyPlan: {
      alternatives: [
        {
          id: `${missionKey}:fallback`,
          description: copy.plan.fallbackDescription,
          trigger: copy.plan.fallbackTrigger,
          action: copy.plan.fallbackAction,
          estimatedImpact: copy.plan.fallbackImpact,
        },
      ],
      degradationStrategies: [...copy.plan.degradationStrategies],
      rollbackPlan: copy.plan.rollbackPlan,
    },
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

interface NLCommandState {
  // Data
  commands: StrategicCommand[];
  currentCommand: StrategicCommand | null;
  currentAnalysis: CommandAnalysis | null;
  currentDialog: ClarificationDialog | null;
  currentFinalized: FinalizedCommand | null;
  currentDecomposition: MissionDecomposition | null;
  currentPlan: NLExecutionPlan | null;
  currentApproval: PlanApprovalRequest | null;
  currentAdjustments: PlanAdjustment[];
  alerts: Alert[];
  comments: Comment[];
  dashboard: DashboardResponse | null;
  draftText: string;
  lastSubmission: TaskHubCommandSubmissionResult | null;

  // UI state
  loading: boolean;
  error: string | null;

  // Actions - task hub
  setDraftText: (value: string) => void;
  submitTaskHubCommand: (
    req: SubmitTaskHubCommandRequest
  ) => Promise<TaskHubCommandSubmissionResult>;
  submitTaskHubClarification: (
    commandId: string,
    req: SubmitClarificationRequest,
    options: SubmitTaskHubClarificationOptions
  ) => Promise<TaskHubCommandSubmissionResult | null>;
  clearTaskHubSession: () => void;

  // Actions — commands
  submitCommand: (req: SubmitCommandRequest) => Promise<void>;
  loadCommands: (params?: ListCommandsRequest) => Promise<void>;
  loadCommand: (id: string) => Promise<void>;

  // Actions — clarification
  submitClarification: (
    commandId: string,
    req: SubmitClarificationRequest
  ) => Promise<void>;
  loadDialog: (commandId: string) => Promise<void>;

  // Actions — plans
  loadPlan: (planId: string) => Promise<void>;
  approvePlan: (planId: string, req: ApprovePlanRequest) => Promise<void>;
  adjustPlan: (planId: string, req: AdjustPlanRequest) => Promise<void>;

  // Actions — monitoring
  loadDashboard: () => Promise<void>;
  loadAlerts: (params?: ListAlertsRequest) => Promise<void>;
  createAlertRule: (req: CreateAlertRuleRequest) => Promise<void>;

  // Actions — collaboration
  addComment: (req: AddCommentRequest) => Promise<void>;
  loadComments: (params: ListCommentsRequest) => Promise<void>;

  // Actions — reports & templates
  generateReport: (req: GenerateReportRequest) => Promise<void>;
  saveTemplate: (req: SaveTemplateRequest) => Promise<void>;

  // Socket.IO
  initSocket: (socket: Socket) => void;

  // Utility
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useNLCommandStore = create<NLCommandState>((set, get) => ({
  // Initial state
  commands: [],
  currentCommand: null,
  currentAnalysis: null,
  currentDialog: null,
  currentFinalized: null,
  currentDecomposition: null,
  currentPlan: null,
  currentApproval: null,
  currentAdjustments: [],
  alerts: [],
  comments: [],
  dashboard: null,
  draftText: "",
  lastSubmission: null,
  loading: false,
  error: null,

  setDraftText: value => {
    set({ draftText: value });
  },

  submitTaskHubCommand: async req => {
    const { createMission, ...commandRequest } = req;
    const normalizedText = normalizeCommandText(commandRequest.commandText);
    const commandId = `task-hub-${nanoid(10)}`;
    const { analysis, questions } = buildTaskHubAnalysis(commandRequest);
    const command: StrategicCommand = {
      commandId,
      commandText: normalizedText,
      userId: commandRequest.userId,
      timestamp: Date.now(),
      status: questions.length > 0 ? "clarifying" : "executing",
      parsedIntent: analysis.intent,
      constraints: analysis.constraints,
      objectives: analysis.objectives,
      priority: commandRequest.priority ?? "medium",
      timeframe: commandRequest.timeframe,
    };
    const dialog =
      questions.length > 0
        ? {
            dialogId: `dialog-${commandId}`,
            commandId,
            questions,
            answers: [],
            clarificationRounds: 0,
            status: "active" as const,
          }
        : null;
    const previewPlan = buildTaskHubPlan({
      command,
      analysis,
      answers: [],
      status: questions.length > 0 ? "draft" : "executing",
    });

    set(state => ({
      loading: true,
      error: null,
      currentCommand: command,
      currentAnalysis: analysis,
      currentDialog: dialog,
      currentFinalized: questions.length
        ? null
        : buildTaskHubFinalizedCommand(command, analysis, []),
      currentPlan: previewPlan,
      draftText: "",
      lastSubmission: null,
      commands: [
        command,
        ...state.commands.filter(item => item.commandId !== command.commandId),
      ],
    }));

    if (questions.length > 0) {
      const result: TaskHubCommandSubmissionResult = {
        commandId,
        commandText: normalizedText,
        missionId: null,
        relatedMissionIds: [],
        autoSelectedMissionId: null,
        status: "needs_clarification",
        createdAt: Date.now(),
      };

      set({ loading: false, lastSubmission: result });
      return result;
    }

    try {
      const missionId = await createMission(
        buildTaskHubMissionInput(command, analysis, [])
      );
      const result: TaskHubCommandSubmissionResult = {
        commandId,
        commandText: normalizedText,
        missionId,
        relatedMissionIds: missionId ? [missionId] : [],
        autoSelectedMissionId: missionId,
        status: "created",
        createdAt: Date.now(),
      };

      set(state => ({
        loading: false,
        currentPlan: buildTaskHubPlan({
          command,
          analysis,
          answers: [],
          missionId,
          status: missionId ? "executing" : "approved",
        }),
        currentFinalized: buildTaskHubFinalizedCommand(command, analysis, []),
        lastSubmission: result,
        commands: state.commands.map(item =>
          item.commandId === commandId
            ? {
                ...item,
                status: missionId ? "executing" : "finalized",
              }
            : item
        ),
      }));

      return result;
    } catch (error) {
      set({
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : getTaskHubCopy(getCurrentTaskHubLocale()).errors
                .createMissionFromCommand,
      });
      throw error;
    }
  },

  submitTaskHubClarification: async (commandId, req, options) => {
    const currentCommand = get().currentCommand;
    const currentDialog = get().currentDialog;
    const currentAnalysis = get().currentAnalysis;

    if (
      !currentCommand ||
      currentCommand.commandId !== commandId ||
      !currentDialog ||
      !currentAnalysis
    ) {
      set({
        error: getTaskHubCopy(getCurrentTaskHubLocale()).errors.noActiveSession,
      });
      return null;
    }

    const nextAnswer: ClarificationAnswer = {
      ...req.answer,
      text: normalizeCommandText(req.answer.text),
      timestamp: req.answer.timestamp || Date.now(),
    };
    const nextAnswers = [
      ...currentDialog.answers.filter(
        answer => answer.questionId !== nextAnswer.questionId
      ),
      nextAnswer,
    ];
    const nextAnalysis = applyClarificationToAnalysis(
      currentAnalysis,
      nextAnswer
    );
    const unansweredQuestions = currentDialog.questions.filter(
      question =>
        !nextAnswers.some(answer => answer.questionId === question.questionId)
    );
    const nextDialog: ClarificationDialog = {
      ...currentDialog,
      answers: nextAnswers,
      clarificationRounds: nextAnswers.length,
      status: unansweredQuestions.length === 0 ? "completed" : "active",
    };
    const finalizedAnalysis = {
      ...nextAnalysis,
      needsClarification: unansweredQuestions.length > 0,
      clarificationTopics:
        unansweredQuestions.length > 0
          ? unansweredQuestions.map(
              question => question.questionId.split(":")[0]
            )
          : undefined,
    };

    set({
      loading: true,
      error: null,
      currentDialog: nextDialog,
      currentAnalysis: finalizedAnalysis,
      currentPlan: buildTaskHubPlan({
        command: currentCommand,
        analysis: finalizedAnalysis,
        answers: nextAnswers,
        status: unansweredQuestions.length > 0 ? "draft" : "approved",
      }),
      lastSubmission:
        unansweredQuestions.length > 0
          ? {
              commandId,
              commandText: currentCommand.commandText,
              missionId: null,
              relatedMissionIds: [],
              autoSelectedMissionId: null,
              status: "needs_clarification",
              createdAt: Date.now(),
            }
          : get().lastSubmission,
    });

    if (unansweredQuestions.length > 0) {
      set({ loading: false });
      return {
        commandId,
        commandText: currentCommand.commandText,
        missionId: null,
        relatedMissionIds: [],
        autoSelectedMissionId: null,
        status: "needs_clarification",
        createdAt: Date.now(),
      };
    }

    try {
      const missionId = await options.createMission(
        buildTaskHubMissionInput(currentCommand, finalizedAnalysis, nextAnswers)
      );
      const result: TaskHubCommandSubmissionResult = {
        commandId,
        commandText: currentCommand.commandText,
        missionId,
        relatedMissionIds: missionId ? [missionId] : [],
        autoSelectedMissionId: missionId,
        status: "created",
        createdAt: Date.now(),
      };

      set(state => ({
        loading: false,
        currentFinalized: buildTaskHubFinalizedCommand(
          currentCommand,
          finalizedAnalysis,
          nextAnswers
        ),
        currentPlan: buildTaskHubPlan({
          command: currentCommand,
          analysis: finalizedAnalysis,
          answers: nextAnswers,
          missionId,
          status: missionId ? "executing" : "approved",
        }),
        lastSubmission: result,
        commands: state.commands.map(item =>
          item.commandId === commandId
            ? {
                ...item,
                status: missionId ? "executing" : "finalized",
                constraints: finalizedAnalysis.constraints,
                objectives: finalizedAnalysis.objectives,
              }
            : item
        ),
      }));

      return result;
    } catch (error) {
      set({
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : getTaskHubCopy(getCurrentTaskHubLocale()).errors
                .createMissionFromClarification,
      });
      throw error;
    }
  },

  clearTaskHubSession: () => {
    set({
      draftText: "",
      currentCommand: null,
      currentAnalysis: null,
      currentDialog: null,
      currentFinalized: null,
      currentDecomposition: null,
      currentPlan: null,
      lastSubmission: null,
      error: null,
      loading: false,
    });
  },

  // ── Commands ──────────────────────────────────────────────────────────

  submitCommand: async req => {
    set({ loading: true, error: null });
    try {
      const res = await api.submitCommand(req);
      set(s => ({
        commands: [res.command, ...s.commands],
        currentCommand: res.command,
        currentAnalysis: res.analysis,
        loading: false,
      }));
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  loadCommands: async params => {
    set({ loading: true, error: null });
    try {
      const res = await api.listCommands(params);
      set({ commands: res.commands, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  loadCommand: async id => {
    set({ loading: true, error: null });
    try {
      const res = await api.getCommand(id);
      set({
        currentCommand: res.command,
        currentAnalysis: res.analysis ?? null,
        currentFinalized: res.finalized ?? null,
        currentDecomposition: res.decomposition ?? null,
        currentPlan: res.plan ?? null,
        loading: false,
      });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  // ── Clarification ────────────────────────────────────────────────────

  submitClarification: async (commandId, req) => {
    set({ loading: true, error: null });
    try {
      const res = await api.submitClarification(commandId, req);
      set({
        currentDialog: res.dialog,
        currentAnalysis: res.updatedAnalysis,
        currentFinalized: res.finalized ?? get().currentFinalized,
        loading: false,
      });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  loadDialog: async commandId => {
    set({ loading: true, error: null });
    try {
      const res = await api.getDialog(commandId);
      set({ currentDialog: res.dialog, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  // ── Plans ────────────────────────────────────────────────────────────

  loadPlan: async planId => {
    set({ loading: true, error: null });
    try {
      const res = await api.getPlan(planId);
      set({
        currentPlan: res.plan,
        currentApproval: res.approval ?? null,
        currentAdjustments: res.adjustments ?? [],
        loading: false,
      });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  approvePlan: async (planId, req) => {
    set({ loading: true, error: null });
    try {
      const res = await api.approvePlan(planId, req);
      set({
        currentPlan: res.plan,
        currentApproval: res.approval,
        loading: false,
      });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  adjustPlan: async (planId, req) => {
    set({ loading: true, error: null });
    try {
      const res = await api.adjustPlan(planId, req);
      set(s => ({
        currentPlan: res.updatedPlan,
        currentAdjustments: [...s.currentAdjustments, res.adjustment],
        loading: false,
      }));
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  // ── Monitoring ───────────────────────────────────────────────────────

  loadDashboard: async () => {
    set({ loading: true, error: null });
    try {
      const res = await api.getDashboard();
      set({ dashboard: res, alerts: res.recentAlerts, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  loadAlerts: async params => {
    set({ loading: true, error: null });
    try {
      const res = await api.listAlerts(params);
      set({ alerts: res.alerts, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  createAlertRule: async req => {
    set({ loading: true, error: null });
    try {
      await api.createAlertRule(req);
      set({ loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  // ── Collaboration ───────────────────────────────────────────────────

  addComment: async req => {
    set({ loading: true, error: null });
    try {
      const res = await api.addComment(req);
      set(s => ({
        comments: [...s.comments, res.comment],
        loading: false,
      }));
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  loadComments: async params => {
    set({ loading: true, error: null });
    try {
      const res = await api.listComments(params);
      set({ comments: res.comments, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  // ── Reports & Templates ─────────────────────────────────────────────

  generateReport: async req => {
    set({ loading: true, error: null });
    try {
      await api.generateReport(req);
      set({ loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  saveTemplate: async req => {
    set({ loading: true, error: null });
    try {
      await api.saveTemplate(req);
      set({ loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  // ── Socket.IO ───────────────────────────────────────────────────────

  initSocket: (socket: Socket) => {
    socket.on(
      NL_COMMAND_SOCKET_EVENTS.commandCreated,
      (event: NLCommandCreatedEvent) => {
        set(s => ({
          commands: [
            event.command,
            ...s.commands.filter(c => c.commandId !== event.command.commandId),
          ],
        }));
      }
    );

    socket.on(
      NL_COMMAND_SOCKET_EVENTS.commandAnalysis,
      (event: NLCommandAnalysisEvent) => {
        const cur = get().currentCommand;
        if (cur && cur.commandId === event.commandId) {
          set({ currentAnalysis: event.analysis });
        }
      }
    );

    socket.on(
      NL_COMMAND_SOCKET_EVENTS.clarificationQuestion,
      (event: NLClarificationQuestionEvent) => {
        const cur = get().currentCommand;
        if (cur && cur.commandId === event.commandId) {
          set(s => {
            const dialog = s.currentDialog ?? {
              dialogId: `dialog-${event.commandId}`,
              commandId: event.commandId,
              questions: [],
              answers: [],
              clarificationRounds: 0,
              status: "active" as const,
            };
            return {
              currentDialog: {
                ...dialog,
                questions: [...dialog.questions, ...event.questions],
              },
            };
          });
        }
      }
    );

    socket.on(
      NL_COMMAND_SOCKET_EVENTS.decompositionComplete,
      (event: NLDecompositionCompleteEvent) => {
        const cur = get().currentCommand;
        if (cur && cur.commandId === event.commandId) {
          set({ currentDecomposition: event.decomposition });
        }
      }
    );

    socket.on(
      NL_COMMAND_SOCKET_EVENTS.planGenerated,
      (event: NLPlanGeneratedEvent) => {
        const cur = get().currentCommand;
        if (cur && cur.commandId === event.commandId) {
          set({ currentPlan: event.plan });
        }
      }
    );

    socket.on(
      NL_COMMAND_SOCKET_EVENTS.planApproved,
      (event: NLPlanApprovedEvent) => {
        const plan = get().currentPlan;
        if (plan && plan.planId === event.planId) {
          set({ currentPlan: { ...plan, status: "approved" } });
        }
      }
    );

    socket.on(
      NL_COMMAND_SOCKET_EVENTS.planAdjusted,
      (event: NLPlanAdjustedEvent) => {
        const plan = get().currentPlan;
        if (plan && plan.planId === event.planId) {
          set(s => ({
            currentAdjustments: [...s.currentAdjustments, event.adjustment],
          }));
        }
      }
    );

    socket.on(NL_COMMAND_SOCKET_EVENTS.alert, (event: NLAlertEvent) => {
      set(s => ({
        alerts: [
          event.alert,
          ...s.alerts.filter(a => a.alertId !== event.alert.alertId),
        ],
      }));
    });

    socket.on(
      NL_COMMAND_SOCKET_EVENTS.progressUpdate,
      (event: NLProgressUpdateEvent) => {
        // Update the command status in the commands list
        set(s => ({
          commands: s.commands.map(c =>
            c.commandId === event.commandId
              ? { ...c, status: event.status as StrategicCommand["status"] }
              : c
          ),
        }));
      }
    );
  },

  // ── Utility ─────────────────────────────────────────────────────────

  clearError: () => set({ error: null }),
}));
