import type {
  AgentHandle,
  LLMCallOptions,
  LLMMessage,
  MemoryRepository,
  RuntimeEventEmitter,
  LLMProvider,
} from "./workflow-runtime.js";
import type {
  LineageOperation,
  RecordTransformationInput,
  RecordSourceInput,
  RecordDecisionInput,
} from "./lineage/contracts.js";

// ─── Lineage Collector Integration (module-level, shared/server bridge) ────

/** Minimal interface so shared code doesn't depend on server-only LineageCollector */
export interface LineageCollectorLike {
  recordTransformation(input: RecordTransformationInput): string;
  recordSource?(input: RecordSourceInput): string;
  recordDecision?(input: RecordDecisionInput): string;
}

let _lineageCollector: LineageCollectorLike | null = null;

export function setLineageCollector(
  collector: LineageCollectorLike | null
): void {
  _lineageCollector = collector;
}

export function getLineageCollector(): LineageCollectorLike | null {
  return _lineageCollector;
}

// ─── Lineage Track Options ────────────────────────────────────────────────

export interface LineageTrackOptions {
  operation?: LineageOperation;
  metadata?: Record<string, unknown>;
}

export interface RuntimeAgentConfig {
  id: string;
  name: string;
  department: string;
  role: "ceo" | "manager" | "worker";
  managerId: string | null;
  model: string;
  soulMd: string;
  currentRoleId?: string | null;
  isGuest?: boolean;
}

export interface VisionContext {
  imageName: string;
  visualDescription: string;
}

export interface MultimodalContext {
  visionContexts?: VisionContext[];
  voiceTranscript?: string;
  voiceLanguage?: string;
}

export interface AgentInvokeOptions {
  workflowId?: string;
  stage?: string;
  visionContexts?: VisionContext[];
  multimodalContext?: MultimodalContext;
}

export interface RuntimeAgentDependencies {
  memoryRepo: MemoryRepository;
  llmProvider: LLMProvider;
  eventEmitter: RuntimeEventEmitter;
}

export function buildAgentSystemPrompt(
  config: RuntimeAgentConfig,
  memoryRepo: MemoryRepository,
  skillPromptSection?: string
): string {
  const soulText = memoryRepo.getSoulText(config.id, config.soulMd);
  const skillSection = skillPromptSection ? `\n${skillPromptSection}` : "";
  return `${soulText}

---
Current identity: ${config.name}
Role: ${config.role}
Department: ${config.department}${skillSection}`;
}

export function composeAgentMessages(
  config: RuntimeAgentConfig,
  prompt: string,
  memoryRepo: MemoryRepository,
  context: string[] = [],
  options: AgentInvokeOptions = {},
  jsonMode: boolean = false
): LLMMessage[] {
  const systemPrompt = buildAgentSystemPrompt(config, memoryRepo);
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: jsonMode
        ? `${systemPrompt}

Important JSON requirements:
- Return valid JSON only
- Do not wrap the JSON in Markdown code fences
- Do not include any explanation outside the JSON payload`
        : systemPrompt,
    },
  ];

  const memoryContext = memoryRepo.buildPromptContext(
    config.id,
    prompt,
    options.workflowId
  );
  for (const item of memoryContext) {
    messages.push({ role: "user", content: item });
  }

  for (const item of context) {
    messages.push({ role: "user", content: item });
  }

  // Inject vision contexts (legacy field or from multimodalContext)
  const visionContexts =
    options.visionContexts ?? options.multimodalContext?.visionContexts;
  if (visionContexts?.length) {
    for (const vc of visionContexts) {
      messages.push({
        role: "user",
        content: `[Vision Analysis] ${vc.imageName}\n${vc.visualDescription}`,
      });
    }
  }

  // Inject voice transcript from multimodalContext (Req 5.2, 5.3)
  if (options.multimodalContext?.voiceTranscript) {
    messages.push({
      role: "user",
      content: `[Voice Input] ${options.multimodalContext.voiceTranscript}`,
    });
  }

  messages.push({ role: "user", content: prompt });
  return messages;
}

export class RuntimeAgent implements AgentHandle {
  config: RuntimeAgentConfig;
  private readonly deps: RuntimeAgentDependencies;

  constructor(config: RuntimeAgentConfig, deps: RuntimeAgentDependencies) {
    this.config = config;
    this.deps = deps;
  }

  /**
   * AC-9.1 ~ AC-9.3: 血缘追踪包装方法
   *
   * Wraps an async function with lineage tracking. Records a transformation
   * node before execution, updates it with execution time after completion.
   * If no collector is set, acts as a transparent pass-through (no-op).
   * AC-9.4: Never throws due to lineage collection failures.
   */
  async lineageTracked<T>(
    fn: () => Promise<T>,
    options?: LineageTrackOptions
  ): Promise<T> {
    const collector = _lineageCollector;

    // No collector → transparent pass-through
    if (!collector) {
      return fn();
    }

    const startTime = Date.now();
    let lineageId: string | undefined;

    // Record transformation BEFORE execution (AC-9.1)
    try {
      lineageId = collector.recordTransformation({
        agentId: this.config.id,
        operation: options?.operation ?? "transform",
        inputLineageIds: [],
        parameters: options?.metadata,
        metadata: {
          agentName: this.config.name,
          department: this.config.department,
          role: this.config.role,
          ...options?.metadata,
        },
      });
    } catch {
      // AC-9.4: lineage failure must not affect execution
    }

    try {
      const result = await fn();

      // Update with execution time on success (AC-9.2)
      try {
        if (lineageId) {
          collector.recordTransformation({
            agentId: this.config.id,
            operation: options?.operation ?? "transform",
            inputLineageIds: lineageId ? [lineageId] : [],
            executionTimeMs: Date.now() - startTime,
            dataChanged: true,
            metadata: {
              status: "success",
              ...options?.metadata,
            },
          });
        }
      } catch {
        // AC-9.4: graceful degradation
      }

      return result;
    } catch (err) {
      // Record failure info (AC-9.2)
      try {
        if (lineageId) {
          collector.recordTransformation({
            agentId: this.config.id,
            operation: options?.operation ?? "transform",
            inputLineageIds: lineageId ? [lineageId] : [],
            executionTimeMs: Date.now() - startTime,
            dataChanged: false,
            metadata: {
              status: "error",
              error: err instanceof Error ? err.message : String(err),
              ...options?.metadata,
            },
          });
        }
      } catch {
        // AC-9.4: graceful degradation
      }

      throw err;
    }
  }

  async invoke(
    prompt: string,
    context?: string[],
    options: AgentInvokeOptions = {}
  ): Promise<string> {
    // Emit "listening" when processing voice input (Req 4.1)
    if (options.multimodalContext?.voiceTranscript) {
      this.deps.eventEmitter.emit({
        type: "agent_active",
        agentId: this.config.id,
        action: "listening",
        workflowId: options.workflowId,
      });
    }

    if (options.visionContexts?.length) {
      this.deps.eventEmitter.emit({
        type: "agent_active",
        agentId: this.config.id,
        action: "analyzing_image",
        workflowId: options.workflowId,
      });
    }

    this.deps.eventEmitter.emit({
      type: "agent_active",
      agentId: this.config.id,
      action: "thinking",
      workflowId: options.workflowId,
    });

    const messages = composeAgentMessages(
      this.config,
      prompt,
      this.deps.memoryRepo,
      context,
      options,
      false
    );
    const llmOptions: LLMCallOptions = {
      model: this.config.model,
      temperature: 0.7,
      maxTokens: 3000,
    };
    if (options.visionContexts?.length) {
      llmOptions.maxTokens = (llmOptions.maxTokens || 3000) + 1000;
    }
    const response = await this.deps.llmProvider.call(messages, llmOptions);

    // Emit "speaking" when voice context was provided (Req 4.3)
    if (options.multimodalContext?.voiceTranscript) {
      this.deps.eventEmitter.emit({
        type: "agent_active",
        agentId: this.config.id,
        action: "speaking",
        workflowId: options.workflowId,
      });
    }

    this.deps.eventEmitter.emit({
      type: "agent_active",
      agentId: this.config.id,
      action: "idle",
      workflowId: options.workflowId,
    });
    this.deps.memoryRepo.appendLLMExchange(this.config.id, {
      workflowId: options.workflowId,
      stage: options.stage,
      prompt,
      response: response.content,
    });

    return response.content;
  }

  async invokeJson<T = unknown>(
    prompt: string,
    context?: string[],
    options: AgentInvokeOptions = {}
  ): Promise<T> {
    // Emit "listening" when processing voice input (Req 4.1)
    if (options.multimodalContext?.voiceTranscript) {
      this.deps.eventEmitter.emit({
        type: "agent_active",
        agentId: this.config.id,
        action: "listening",
        workflowId: options.workflowId,
      });
    }

    if (options.visionContexts?.length) {
      this.deps.eventEmitter.emit({
        type: "agent_active",
        agentId: this.config.id,
        action: "analyzing_image",
        workflowId: options.workflowId,
      });
    }

    this.deps.eventEmitter.emit({
      type: "agent_active",
      agentId: this.config.id,
      action: "thinking",
      workflowId: options.workflowId,
    });

    const messages = composeAgentMessages(
      this.config,
      prompt,
      this.deps.memoryRepo,
      context,
      options,
      true
    );
    const llmOptions: LLMCallOptions = {
      model: this.config.model,
      temperature: 0.5,
      maxTokens: 3000,
    };
    if (options.visionContexts?.length) {
      llmOptions.maxTokens = (llmOptions.maxTokens || 3000) + 1000;
    }
    const result = await this.deps.llmProvider.callJson<T>(
      messages,
      llmOptions
    );

    // Emit "speaking" when voice context was provided (Req 4.3)
    if (options.multimodalContext?.voiceTranscript) {
      this.deps.eventEmitter.emit({
        type: "agent_active",
        agentId: this.config.id,
        action: "speaking",
        workflowId: options.workflowId,
      });
    }

    this.deps.eventEmitter.emit({
      type: "agent_active",
      agentId: this.config.id,
      action: "idle",
      workflowId: options.workflowId,
    });
    this.deps.memoryRepo.appendLLMExchange(this.config.id, {
      workflowId: options.workflowId,
      stage: options.stage,
      prompt,
      response: JSON.stringify(result, null, 2),
    });

    return result;
  }
}
