import { Router, type Response } from "express";

import {
  callLLMJson,
  isLLMTemporarilyUnavailableError,
} from "../core/llm-client.js";

import type {
  SubmitCommandRequest,
  SubmitClarificationRequest,
  ApprovePlanRequest,
  AdjustPlanRequest,
  CreateAlertRuleRequest,
  AddCommentRequest,
  GenerateReportRequest,
  SaveTemplateRequest,
  ExportAuditRequest,
  ClarificationPreviewRequest,
  ClarificationPreviewResponse,
} from "../../shared/nl-command/api.js";
import type { ClarificationQuestion } from "../../shared/nl-command/contracts.js";

type PreviewGenerationMode = "judge" | "questions" | "repair";

export interface NLCommandRouterDeps {
  orchestrator?: unknown;
  previewClarificationQuestions?: (
    request: ClarificationPreviewRequest,
  ) => Promise<ClarificationPreviewResponse>;
}

function notImplemented(res: Response, endpoint: string) {
  res.status(501).json({
    error: "Not implemented",
    endpoint,
    message: "Orchestrator not yet integrated",
  });
}

function normalizePreviewOption(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!value || typeof value !== "object") {
    return "";
  }

  const option = value as {
    text?: unknown;
    label?: unknown;
    value?: unknown;
  };

  if (typeof option.text === "string" && option.text.trim()) {
    return option.text.trim();
  }
  if (typeof option.label === "string" && option.label.trim()) {
    return option.label.trim();
  }
  if (typeof option.value === "string" && option.value.trim()) {
    return option.value.trim();
  }

  return "";
}

function normalizePreviewQuestion(
  value: unknown,
  index: number,
): ClarificationQuestion | null {
  if (!value || typeof value !== "object") return null;

  const question = value as Partial<ClarificationQuestion> & {
    id?: unknown;
  };
  const text = typeof question.text === "string" ? question.text.trim() : "";
  if (!text) return null;

  const options = Array.isArray(question.options)
    ? Array.from(
        new Set(
          question.options.map(option => normalizePreviewOption(option)).filter(Boolean),
        ),
      ).slice(0, 4)
    : undefined;
  const hasChoiceOptions = Boolean(options && options.length >= 2);
  const rawType =
    question.type === "single_choice" || question.type === "multi_choice"
      ? question.type
      : "free_text";

  return {
    questionId:
      typeof question.questionId === "string" && question.questionId.trim()
        ? question.questionId.trim()
        : typeof question.id === "string" && question.id.trim()
          ? question.id.trim()
        : `generated:${index + 1}`,
    text,
    type: hasChoiceOptions
      ? rawType === "free_text"
        ? "single_choice"
        : rawType
      : "free_text",
    options: hasChoiceOptions ? options : undefined,
    context:
      typeof question.context === "string" && question.context.trim()
        ? question.context.trim()
        : undefined,
  };
}

function normalizePreviewResponse(value: unknown): ClarificationPreviewResponse {
  const payload =
    value && typeof value === "object"
      ? (value as Partial<ClarificationPreviewResponse>)
      : {};
  const questions = Array.isArray(payload.questions)
    ? payload.questions
        .map((question, index) => normalizePreviewQuestion(question, index))
        .filter(
          (question): question is ClarificationQuestion => Boolean(question),
        )
        .slice(0, 3)
    : [];
  const needsClarification =
    typeof payload.needsClarification === "boolean"
      ? payload.needsClarification
      : questions.length > 0;

  return {
    needsClarification,
    questions: needsClarification ? questions : [],
  };
}

function hasChoiceOptions(question: ClarificationQuestion): boolean {
  return (
    (question.type === "single_choice" || question.type === "multi_choice") &&
    Array.isArray(question.options) &&
    question.options.length >= 2
  );
}

function needsChoiceRepair(response: ClarificationPreviewResponse): boolean {
  return (
    response.needsClarification &&
    (!Array.isArray(response.questions) ||
      response.questions.length === 0 ||
      response.questions.some(question => !hasChoiceOptions(question)))
  );
}

function buildPreviewPrompts(
  request: ClarificationPreviewRequest,
  mode: PreviewGenerationMode,
  questionsToRepair: ClarificationQuestion[] = [],
): { systemPrompt: string; userPrompt: string } {
  const locale = request.locale === "en-US" ? "en-US" : "zh-CN";
  const localeInstruction =
    locale === "zh-CN"
      ? "Write every question text, option, and context in Simplified Chinese."
      : "Write every question text, option, and context in English.";

  const systemPrompt =
    mode === "judge"
      ? [
          "You are a clarification assistant for launch requests.",
          "Decide whether the command still needs more information before a mission can be created safely.",
          'Return json only in the shape {"needsClarification": boolean, "questions": ClarificationQuestion[] }.',
          "If clarification is needed, questions must contain 1 to 3 items and must not be empty.",
          "Focus on outcome, time window, and constraints.",
          "Prefer clickable questions: single_choice or multi_choice with 2 to 4 options.",
          "Use free_text only when preset choices would clearly be misleading.",
          localeInstruction,
          "Do not output markdown.",
        ].join("\n")
      : mode === "questions"
        ? [
            "You are a clarification assistant for launch requests.",
            "It is already confirmed that this request needs clarification.",
            'Return json only in the shape {"needsClarification": true, "questions": ClarificationQuestion[] }.',
            "questions must contain 1 to 3 items and must not be empty.",
            "At least one question must be single_choice or multi_choice with 2 to 4 options.",
            "Make the questions easy for the user to answer by clicking choices.",
            "Focus on outcome, delivery window, and constraints.",
            localeInstruction,
            "Do not output markdown.",
          ].join("\n")
        : [
            "You are repairing a clarification question set for a launch request.",
            'Return json only in the shape {"needsClarification": true, "questions": ClarificationQuestion[] }.',
            "Rewrite the draft into 1 to 3 clearer questions that are easier to answer by clicking choices.",
            "Every question should be single_choice or multi_choice with 2 to 4 concise options unless it is genuinely impossible.",
            "If a draft question is weak, missing options, or free_text-only, replace it with a better choice-based question.",
            "Keep the repaired questions aligned with the original command intent.",
            localeInstruction,
            "Do not output markdown.",
          ].join("\n");

  const userPrompt = JSON.stringify(
    {
      responseFormat: "json",
      mode,
      commandText: request.commandText,
      userId: request.userId,
      priority: request.priority ?? "medium",
      timeframe: request.timeframe ?? null,
      locale,
      draftQuestions:
        mode === "repair"
          ? questionsToRepair.map(question => ({
              questionId: question.questionId,
              text: question.text,
              type: question.type,
              options: question.options ?? [],
              context: question.context ?? null,
            }))
          : undefined,
    },
    null,
    2,
  );

  return { systemPrompt, userPrompt };
}

async function generatePreviewResponse(
  request: ClarificationPreviewRequest,
  mode: PreviewGenerationMode,
  questionsToRepair: ClarificationQuestion[] = [],
): Promise<ClarificationPreviewResponse> {
  const { systemPrompt, userPrompt } = buildPreviewPrompts(
    request,
    mode,
    questionsToRepair,
  );
  const response = await callLLMJson<ClarificationPreviewResponse>(
    [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `${userPrompt}\n\nRespond with json only.`,
      },
    ],
    {
      model: process.env.LLM_MODEL,
      temperature: mode === "judge" ? 0.2 : 0.1,
      maxTokens: mode === "judge" ? 800 : 1200,
    },
  );

  return normalizePreviewResponse(response);
}

function buildFallbackClarificationQuestions(
  request: ClarificationPreviewRequest,
): ClarificationQuestion[] {
  const locale = request.locale === "en-US" ? "en-US" : "zh-CN";
  const text = request.commandText.trim();
  const hasTimeline =
    /今天|明天|本周|下周|月底|本月|截止|deadline|launch|release|ship|before|by\s+\w+/i.test(
      text,
    );
  const hasConstraint =
    /零停机|zero downtime|回滚|rollback|预算|budget|风险|constraint|兼容|compliance|sla|测试|test/i.test(
      text,
    );

  const questions: ClarificationQuestion[] = [
    {
      questionId: "fallback:outcome",
      text:
        locale === "zh-CN"
          ? "这次最重要的交付结果是什么？"
          : "What is the most important deliverable for this request?",
      type: "single_choice",
      options:
        locale === "zh-CN"
          ? ["直接产出结果", "先给方案再执行", "先分析评估后再决定"]
          : [
              "Deliver the result directly",
              "Provide a plan first",
              "Assess first and decide later",
            ],
      context:
        locale === "zh-CN"
          ? "用于避免系统误判你更看重执行、方案还是分析。"
          : "Helps avoid guessing whether execution, planning, or assessment matters most.",
    },
  ];

  if (!hasTimeline) {
    questions.push({
      questionId: "fallback:timeline",
      text:
        locale === "zh-CN"
          ? "希望按哪个时间窗口推进？"
          : "Which delivery window should we target?",
      type: "single_choice",
      options:
        locale === "zh-CN"
          ? ["今天内", "本周内", "时间灵活"]
          : ["Today", "This week", "Flexible"],
      context:
        locale === "zh-CN"
          ? "用于锁定期望节奏，避免系统自行猜测截止时间。"
          : "Used to lock the expected pace instead of guessing a deadline.",
    });
  }

  if (!hasConstraint && questions.length < 3) {
    questions.push({
      questionId: "fallback:constraints",
      text:
        locale === "zh-CN"
          ? "这次执行最需要守住哪类约束？"
          : "Which constraint matters most for this execution?",
      type: "single_choice",
      options:
        locale === "zh-CN"
          ? ["尽量快交付", "可回滚更重要", "兼容稳定更重要"]
          : [
              "Ship as fast as possible",
              "Rollback safety matters most",
              "Compatibility and stability matter most",
            ],
      context:
        locale === "zh-CN"
          ? "用于避免在速度、回滚和稳定性之间做错取舍。"
          : "Prevents the system from making the wrong tradeoff between speed, rollback, and stability.",
    });
  }

  return questions.slice(0, 3);
}

async function defaultPreviewClarificationQuestions(
  request: ClarificationPreviewRequest,
): Promise<ClarificationPreviewResponse> {
  const firstPass = await generatePreviewResponse(request, "judge");
  if (!firstPass.needsClarification) {
    return firstPass;
  }
  if (!needsChoiceRepair(firstPass)) {
    return firstPass;
  }

  const secondPass =
    firstPass.questions.length === 0
      ? await generatePreviewResponse(request, "questions")
      : await generatePreviewResponse(request, "repair", firstPass.questions);
  if (!needsChoiceRepair(secondPass)) {
    return secondPass;
  }

  const repairSource =
    secondPass.questions.length > 0 ? secondPass.questions : firstPass.questions;
  if (repairSource.length > 0) {
    const thirdPass = await generatePreviewResponse(
      request,
      "repair",
      repairSource,
    );
    if (!needsChoiceRepair(thirdPass)) {
      return thirdPass;
    }
  }

  return {
    needsClarification: true,
    questions: buildFallbackClarificationQuestions(request),
  };
}

export function createNLCommandRouter(
  deps: NLCommandRouterDeps = {},
): Router {
  const router = Router();

  router.post("/clarification-preview", async (req, res) => {
    try {
      const body = req.body as ClarificationPreviewRequest;
      if (!body?.commandText || !body?.userId) {
        res.status(400).json({
          error: "Bad request",
          message: "commandText and userId are required",
        });
        return;
      }

      const generator =
        deps.previewClarificationQuestions ??
        defaultPreviewClarificationQuestions;
      const response = await generator(body);
      res.json(normalizePreviewResponse(response));
    } catch (error) {
      res.status(isLLMTemporarilyUnavailableError(error) ? 503 : 500).json({
        error: "Failed to generate clarification preview",
        message:
          error instanceof Error ? error.message : "Unknown server error",
      });
    }
  });

  router.post("/commands", (req, res) => {
    try {
      const body = req.body as SubmitCommandRequest;
      if (!body?.commandText || !body?.userId) {
        res.status(400).json({
          error: "Bad request",
          message: "commandText and userId are required",
        });
        return;
      }
      notImplemented(res, "POST /commands");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/commands", (_req, res) => {
    try {
      notImplemented(res, "GET /commands");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/commands/:id", (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({
          error: "Bad request",
          message: "Command ID is required",
        });
        return;
      }
      notImplemented(res, "GET /commands/:id");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/commands/:id/clarify", (req, res) => {
    try {
      const { id } = req.params;
      const body = req.body as SubmitClarificationRequest;
      if (!id) {
        res.status(400).json({
          error: "Bad request",
          message: "Command ID is required",
        });
        return;
      }
      if (!body?.answer?.questionId) {
        res.status(400).json({
          error: "Bad request",
          message: "answer with questionId is required",
        });
        return;
      }
      notImplemented(res, "POST /commands/:id/clarify");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/commands/:id/dialog", (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({
          error: "Bad request",
          message: "Command ID is required",
        });
        return;
      }
      notImplemented(res, "GET /commands/:id/dialog");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/plans/:id", (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({
          error: "Bad request",
          message: "Plan ID is required",
        });
        return;
      }
      notImplemented(res, "GET /plans/:id");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/plans/:id/approve", (req, res) => {
    try {
      const { id } = req.params;
      const body = req.body as ApprovePlanRequest;
      if (!id) {
        res.status(400).json({
          error: "Bad request",
          message: "Plan ID is required",
        });
        return;
      }
      if (!body?.approverId || !body?.decision) {
        res.status(400).json({
          error: "Bad request",
          message: "approverId and decision are required",
        });
        return;
      }
      notImplemented(res, "POST /plans/:id/approve");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/plans/:id/adjust", (req, res) => {
    try {
      const { id } = req.params;
      const body = req.body as AdjustPlanRequest;
      if (!id) {
        res.status(400).json({
          error: "Bad request",
          message: "Plan ID is required",
        });
        return;
      }
      if (!body?.reason || !Array.isArray(body?.changes)) {
        res.status(400).json({
          error: "Bad request",
          message: "reason and changes array are required",
        });
        return;
      }
      notImplemented(res, "POST /plans/:id/adjust");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/dashboard", (_req, res) => {
    try {
      notImplemented(res, "GET /dashboard");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/alerts", (_req, res) => {
    try {
      notImplemented(res, "GET /alerts");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/alerts/rules", (req, res) => {
    try {
      const body = req.body as CreateAlertRuleRequest;
      if (!body?.type || !body?.condition || !body?.priority) {
        res.status(400).json({
          error: "Bad request",
          message: "type, condition, and priority are required",
        });
        return;
      }
      notImplemented(res, "POST /alerts/rules");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/plans/:id/risks", (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({
          error: "Bad request",
          message: "Plan ID is required",
        });
        return;
      }
      notImplemented(res, "GET /plans/:id/risks");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/plans/:id/suggestions", (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({
          error: "Bad request",
          message: "Plan ID is required",
        });
        return;
      }
      notImplemented(res, "GET /plans/:id/suggestions");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/plans/:id/apply-suggestion", (req, res) => {
    try {
      const { id } = req.params;
      const body = req.body as { suggestionId?: string };
      if (!id) {
        res.status(400).json({
          error: "Bad request",
          message: "Plan ID is required",
        });
        return;
      }
      if (!body?.suggestionId) {
        res.status(400).json({
          error: "Bad request",
          message: "suggestionId is required",
        });
        return;
      }
      notImplemented(res, "POST /plans/:id/apply-suggestion");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/comments", (req, res) => {
    try {
      const body = req.body as AddCommentRequest;
      if (
        !body?.entityId ||
        !body?.entityType ||
        !body?.authorId ||
        !body?.content
      ) {
        res.status(400).json({
          error: "Bad request",
          message: "entityId, entityType, authorId, and content are required",
        });
        return;
      }
      notImplemented(res, "POST /comments");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/comments", (req, res) => {
    try {
      const entityId = req.query.entityId as string | undefined;
      if (!entityId) {
        res.status(400).json({
          error: "Bad request",
          message: "entityId query parameter is required",
        });
        return;
      }
      notImplemented(res, "GET /comments");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/reports/:id", (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({
          error: "Bad request",
          message: "Report ID is required",
        });
        return;
      }
      notImplemented(res, "GET /reports/:id");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/reports/generate", (req, res) => {
    try {
      const body = req.body as GenerateReportRequest;
      if (!body?.planId) {
        res.status(400).json({
          error: "Bad request",
          message: "planId is required",
        });
        return;
      }
      notImplemented(res, "POST /reports/generate");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/history", (_req, res) => {
    try {
      notImplemented(res, "GET /history");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/templates", (_req, res) => {
    try {
      notImplemented(res, "GET /templates");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/templates", (req, res) => {
    try {
      const body = req.body as SaveTemplateRequest;
      if (
        !body?.planId ||
        !body?.name ||
        !body?.description ||
        !body?.createdBy
      ) {
        res.status(400).json({
          error: "Bad request",
          message: "planId, name, description, and createdBy are required",
        });
        return;
      }
      notImplemented(res, "POST /templates");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/audit", (_req, res) => {
    try {
      notImplemented(res, "GET /audit");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/audit/export", (req, res) => {
    try {
      const body = req.body as ExportAuditRequest;
      if (!body?.filter || !body?.format) {
        res.status(400).json({
          error: "Bad request",
          message: "filter and format are required",
        });
        return;
      }
      notImplemented(res, "POST /audit/export");
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}

export default createNLCommandRouter();
