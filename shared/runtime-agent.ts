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
}

export interface VisionContext {
  imageName: string;
  visualDescription: string;
}

export interface AgentInvokeOptions {
  workflowId?: string;
  stage?: string;
  visionContexts?: VisionContext[];
}

export interface RuntimeAgentDependencies {
  memoryRepo: MemoryRepository;
  llmProvider: LLMProvider;
  eventEmitter: RuntimeEventEmitter;
}

export function buildAgentSystemPrompt(
  config: RuntimeAgentConfig,
  memoryRepo: MemoryRepository
): string {
  const soulText = memoryRepo.getSoulText(config.id, config.soulMd);
  return `${soulText}

---
Current identity: ${config.name}
Role: ${config.role}
Department: ${config.department}`;
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

  if (options.visionContexts?.length) {
    for (const vc of options.visionContexts) {
      messages.push({
        role: "user",
        content: `[Vision Analysis] ${vc.imageName}\n${vc.visualDescription}`,
      });
    }
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
