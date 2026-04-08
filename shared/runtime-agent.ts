import type {
  AgentHandle,
  LLMCallOptions,
  LLMMessage,
  MemoryRepository,
  RuntimeEventEmitter,
  LLMProvider,
} from "./workflow-runtime.js";

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
    options.visionContexts ??
    options.multimodalContext?.visionContexts;
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
    const result = await this.deps.llmProvider.callJson<T>(messages, llmOptions);

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
