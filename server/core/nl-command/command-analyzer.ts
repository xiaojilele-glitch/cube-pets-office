/**
 * 指令解析器 (Command Analyzer)
 *
 * 调用 LLM 解析战略级自然语言指令，提取意图、约束、目标，
 * 检测歧义并生成澄清问题，支持基于澄清回答更新分析，
 * 最终生成 FinalizedCommand。
 *
 * @see Requirements 1.2, 1.3, 1.4, 2.2, 2.4, 2.5
 */

import type {
  CommandAnalysis,
  CommandEntity,
  CommandConstraint,
  ClarificationAnswer,
  ClarificationQuestion,
  FinalizedCommand,
  IdentifiedRisk,
  StrategicCommand,
} from '../../../shared/nl-command/contracts.js';
import type { ILLMProvider, LLMMessage } from '../../../shared/llm/contracts.js';
import { AuditTrail } from './audit-trail.js';

export interface CommandAnalyzerOptions {
  llmProvider: ILLMProvider;
  model: string;
  auditTrail: AuditTrail;
}

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

/**
 * 调用 LLM 并在临时性错误时进行指数退避重试（最多 2 次）。
 */
async function callLLMWithRetry(
  provider: ILLMProvider,
  messages: LLMMessage[],
  model: string,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await provider.generate(messages, {
        model,
        jsonMode: true,
        temperature: 0.3,
      });
      return result.content;
    } catch (err) {
      lastError = err;
      const isTemporary = provider.isTemporaryError?.(err) ?? true;
      if (!isTemporary || attempt === MAX_RETRIES) {
        break;
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

/**
 * 安全解析 JSON，失败时返回 null。
 */
function safeParseJSON<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // 尝试提取 JSON 块（LLM 有时会包裹在 markdown 代码块中）
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try {
        return JSON.parse(match[1].trim()) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ─── LLM 响应结构 ───

interface AnalysisLLMResponse {
  intent: string;
  entities: CommandEntity[];
  constraints: CommandConstraint[];
  objectives: string[];
  risks: IdentifiedRisk[];
  assumptions: string[];
  confidence: number;
  needsClarification: boolean;
  clarificationTopics?: string[];
}

interface ClarificationLLMResponse {
  questions: Array<{
    questionId: string;
    text: string;
    type: 'free_text' | 'single_choice' | 'multi_choice';
    options?: string[];
    context?: string;
  }>;
}

interface UpdatedAnalysisLLMResponse extends AnalysisLLMResponse {}

interface FinalizeLLMResponse {
  refinedText: string;
  clarificationSummary?: string;
}

export class CommandAnalyzer {
  private readonly llmProvider: ILLMProvider;
  private readonly model: string;
  private readonly auditTrail: AuditTrail;

  constructor(options: CommandAnalyzerOptions) {
    this.llmProvider = options.llmProvider;
    this.model = options.model;
    this.auditTrail = options.auditTrail;
  }

  /**
   * 解析战略指令，返回 CommandAnalysis。
   * @see Requirement 1.2, 1.3
   */
  async analyze(command: StrategicCommand): Promise<CommandAnalysis> {
    const systemPrompt = `You are a strategic command analyzer. Parse the user's strategic command and extract structured information.
Return a JSON object with these fields:
- intent (string): The primary intent of the command
- entities (array): Relevant entities, each with { name, type, description? }. type is one of: module, service, team, technology, concept, custom
- constraints (array): Constraint conditions, each with { type, description, value?, unit? }. type is one of: budget, time, quality, resource, custom
- objectives (array of strings): Primary objectives
- risks (array): Identified risks, each with { id, description, level, probability, impact, mitigation }. level is one of: low, medium, high, critical. probability and impact are numbers 0-1
- assumptions (array of strings): Assumptions made during analysis
- confidence (number 0-1): Confidence level of the analysis
- needsClarification (boolean): Whether the command needs clarification
- clarificationTopics (array of strings, optional): Topics that need clarification if needsClarification is true

Respond ONLY with valid JSON.`;

    const userPrompt = `Analyze this strategic command:
"${command.commandText}"

Command metadata:
- Priority: ${command.priority}
- User ID: ${command.userId}
${command.timeframe ? `- Timeframe: ${JSON.stringify(command.timeframe)}` : ''}
${command.constraints.length > 0 ? `- Existing constraints: ${JSON.stringify(command.constraints)}` : ''}
${command.objectives.length > 0 ? `- Existing objectives: ${JSON.stringify(command.objectives)}` : ''}`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const raw = await callLLMWithRetry(this.llmProvider, messages, this.model);
    const parsed = safeParseJSON<AnalysisLLMResponse>(raw);

    const analysis = this.buildAnalysis(parsed);

    // 记录审计
    await this.auditTrail.record({
      entryId: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operationType: 'command_analyzed',
      operator: command.userId,
      content: `Analyzed command: "${command.commandText}"`,
      timestamp: Date.now(),
      result: 'success',
      entityId: command.commandId,
      entityType: 'command',
      metadata: { confidence: analysis.confidence, needsClarification: analysis.needsClarification },
    });

    return analysis;
  }

  /**
   * 生成澄清问题。
   * @see Requirement 2.2
   */
  async generateClarificationQuestions(
    command: StrategicCommand,
    analysis: CommandAnalysis,
  ): Promise<ClarificationQuestion[]> {
    const systemPrompt = `You are a strategic command clarification assistant. Based on the command analysis, generate clarification questions to resolve ambiguities.
Return a JSON object with a "questions" array. Each question has:
- questionId (string): Unique ID like "q-1", "q-2", etc.
- text (string): The question text
- type (string): One of "free_text", "single_choice", "multi_choice"
- options (array of strings, optional): Choices for single_choice or multi_choice types
- context (string, optional): Why this question is being asked

Respond ONLY with valid JSON.`;

    const userPrompt = `Original command: "${command.commandText}"

Analysis result:
- Intent: ${analysis.intent}
- Confidence: ${analysis.confidence}
- Needs clarification: ${analysis.needsClarification}
${analysis.clarificationTopics?.length ? `- Clarification topics: ${analysis.clarificationTopics.join(', ')}` : ''}
- Assumptions: ${analysis.assumptions.join('; ')}

Generate clarification questions to resolve ambiguities and improve confidence.`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const raw = await callLLMWithRetry(this.llmProvider, messages, this.model);
    const parsed = safeParseJSON<ClarificationLLMResponse>(raw);

    const questions = this.buildClarificationQuestions(parsed);

    // 记录审计
    await this.auditTrail.record({
      entryId: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operationType: 'clarification_question',
      operator: command.userId,
      content: `Generated ${questions.length} clarification questions`,
      timestamp: Date.now(),
      result: 'success',
      entityId: command.commandId,
      entityType: 'command',
      metadata: { questionCount: questions.length },
    });

    return questions;
  }

  /**
   * 基于澄清回答更新分析结果。
   * @see Requirement 2.4
   */
  async updateAnalysis(
    command: StrategicCommand,
    analysis: CommandAnalysis,
    answer: ClarificationAnswer,
  ): Promise<CommandAnalysis> {
    const systemPrompt = `You are a strategic command analyzer. Update the existing analysis based on a new clarification answer.
Return a JSON object with the same structure as the original analysis, with updated fields reflecting the new information:
- intent, entities, constraints, objectives, risks, assumptions, confidence, needsClarification, clarificationTopics

The confidence should generally increase after clarification. Update any fields that the answer clarifies.
Respond ONLY with valid JSON.`;

    const userPrompt = `Original command: "${command.commandText}"

Current analysis:
${JSON.stringify(analysis, null, 2)}

Clarification answer:
- Question ID: ${answer.questionId}
- Answer text: ${answer.text}
${answer.selectedOptions?.length ? `- Selected options: ${answer.selectedOptions.join(', ')}` : ''}

Update the analysis to incorporate this new information.`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const raw = await callLLMWithRetry(this.llmProvider, messages, this.model);
    const parsed = safeParseJSON<UpdatedAnalysisLLMResponse>(raw);

    const updatedAnalysis = this.buildAnalysis(parsed, analysis);

    // 记录审计
    await this.auditTrail.record({
      entryId: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operationType: 'clarification_answer',
      operator: command.userId,
      content: `Updated analysis with clarification answer for question ${answer.questionId}`,
      timestamp: Date.now(),
      result: 'success',
      entityId: command.commandId,
      entityType: 'command',
      metadata: { questionId: answer.questionId, newConfidence: updatedAnalysis.confidence },
    });

    return updatedAnalysis;
  }

  /**
   * 生成最终确认指令。
   * @see Requirement 2.5
   */
  async finalize(
    command: StrategicCommand,
    analysis: CommandAnalysis,
  ): Promise<FinalizedCommand> {
    const systemPrompt = `You are a strategic command finalizer. Based on the original command and the completed analysis, produce a refined version of the command and an optional clarification summary.
Return a JSON object with:
- refinedText (string): A clear, unambiguous version of the original command incorporating all clarifications
- clarificationSummary (string, optional): A brief summary of what was clarified

Respond ONLY with valid JSON.`;

    const userPrompt = `Original command: "${command.commandText}"

Final analysis:
${JSON.stringify(analysis, null, 2)}

Produce a refined command text that incorporates all the analysis findings.`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const raw = await callLLMWithRetry(this.llmProvider, messages, this.model);
    const parsed = safeParseJSON<FinalizeLLMResponse>(raw);

    const finalized: FinalizedCommand = {
      commandId: command.commandId,
      originalText: command.commandText,
      refinedText: parsed?.refinedText ?? command.commandText,
      analysis,
      clarificationSummary: parsed?.clarificationSummary,
      finalizedAt: Date.now(),
    };

    // 记录审计
    await this.auditTrail.record({
      entryId: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operationType: 'command_finalized',
      operator: command.userId,
      content: `Finalized command: "${finalized.refinedText}"`,
      timestamp: Date.now(),
      result: 'success',
      entityId: command.commandId,
      entityType: 'command',
      metadata: { refinedText: finalized.refinedText },
    });

    return finalized;
  }

  // ─── Private helpers ───

  /**
   * 从 LLM 响应构建 CommandAnalysis，使用 fallback 默认值保证结构完整。
   */
  private buildAnalysis(
    parsed: AnalysisLLMResponse | null,
    fallback?: CommandAnalysis,
  ): CommandAnalysis {
    if (!parsed) {
      // LLM 返回格式异常，使用 fallback 或默认值
      return fallback ?? {
        intent: 'unknown',
        entities: [],
        constraints: [],
        objectives: [],
        risks: [],
        assumptions: [],
        confidence: 0,
        needsClarification: true,
        clarificationTopics: ['Unable to parse command, please rephrase'],
      };
    }

    return {
      intent: typeof parsed.intent === 'string' ? parsed.intent : (fallback?.intent ?? 'unknown'),
      entities: Array.isArray(parsed.entities) ? parsed.entities : (fallback?.entities ?? []),
      constraints: Array.isArray(parsed.constraints) ? parsed.constraints : (fallback?.constraints ?? []),
      objectives: Array.isArray(parsed.objectives) ? parsed.objectives : (fallback?.objectives ?? []),
      risks: Array.isArray(parsed.risks) ? parsed.risks : (fallback?.risks ?? []),
      assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : (fallback?.assumptions ?? []),
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : (fallback?.confidence ?? 0),
      needsClarification: typeof parsed.needsClarification === 'boolean' ? parsed.needsClarification : (fallback?.needsClarification ?? true),
      clarificationTopics: Array.isArray(parsed.clarificationTopics) ? parsed.clarificationTopics : fallback?.clarificationTopics,
    };
  }

  /**
   * 从 LLM 响应构建 ClarificationQuestion 数组。
   */
  private buildClarificationQuestions(
    parsed: ClarificationLLMResponse | null,
  ): ClarificationQuestion[] {
    if (!parsed || !Array.isArray(parsed.questions)) {
      return [];
    }

    return parsed.questions.map((q, i) => ({
      questionId: typeof q.questionId === 'string' ? q.questionId : `q-${i + 1}`,
      text: typeof q.text === 'string' ? q.text : 'Could you provide more details?',
      type: (['free_text', 'single_choice', 'multi_choice'] as const).includes(q.type as any)
        ? q.type
        : 'free_text',
      options: Array.isArray(q.options) ? q.options : undefined,
      context: typeof q.context === 'string' ? q.context : undefined,
    }));
  }
}
