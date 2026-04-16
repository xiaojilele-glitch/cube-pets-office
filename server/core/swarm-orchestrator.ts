/**
 * SwarmOrchestrator — 跨 Pod 协作引擎核心
 *
 * 负责协作发现、请求路由、子任务委派和结果汇总。
 * 仅在当前 Mission 生命周期内有效，不持久化协作关系。
 */
import type { MessageBus } from "./message-bus.js";
import type { MissionOrchestrator } from "./mission-orchestrator.js";
import type {
  CollaborationRequest,
  CollaborationResponse,
  CollaborationResult,
  CollaborationSession,
  PodCapability,
  SubTaskOutput,
  SwarmConfig,
} from "../../shared/swarm.js";

/** LLM 提供商抽象接口 */
export interface LLMProvider {
  generate(prompt: string): Promise<string>;
}

/** Agent 目录抽象接口 */
export interface AgentDirectory {
  getManagerByPod(podId: string): { id: string; role: string } | undefined;
  getAvailableWorkers(podId: string): { id: string; role: string }[];
}

/** 心跳报告类型（来自 HeartbeatScheduler） */
export interface HeartbeatReport {
  agentId: string;
  podId: string;
  actionItems: string[];
  observations: string[];
  timestamp: number;
}

export interface SwarmOrchestratorOptions {
  messageBus: MessageBus;
  config: SwarmConfig;
  llmProvider: LLMProvider;
  agentDirectory: AgentDirectory;
  missionOrchestrator?: MissionOrchestrator;
}

export class SwarmOrchestrator {
  private readonly messageBus: MessageBus;
  private readonly config: SwarmConfig;
  private readonly llmProvider: LLMProvider;
  private readonly agentDirectory: AgentDirectory;
  private readonly missionOrchestrator: MissionOrchestrator | null;
  private readonly capabilityRegistry: Map<string, PodCapability> = new Map();
  private readonly activeSessions: Map<string, CollaborationSession> =
    new Map();

  constructor(options: SwarmOrchestratorOptions) {
    this.messageBus = options.messageBus;
    this.config = options.config;
    this.llmProvider = options.llmProvider;
    this.agentDirectory = options.agentDirectory;
    this.missionOrchestrator = options.missionOrchestrator ?? null;
  }

  /** 注册 Pod 能力 */
  registerPodCapability(capability: PodCapability): void {
    this.capabilityRegistry.set(capability.podId, capability);
  }

  /** 获取 Pod 能力注册表 */
  getPodCapabilities(): PodCapability[] {
    return Array.from(this.capabilityRegistry.values());
  }

  /** 获取活跃会话列表（status === "active" 或 "pending"） */
  getActiveSessions(): CollaborationSession[] {
    return Array.from(this.activeSessions.values()).filter(
      s => s.status === "active" || s.status === "pending"
    );
  }

  /**
   * 匹配能力：返回能力集合与 required 有非空交集的 Pod，按匹配数降序排列。
   */
  matchCapabilities(required: string[]): PodCapability[] {
    const requiredSet = new Set(required);
    const scored: Array<{ pod: PodCapability; matchCount: number }> = [];

    for (const pod of Array.from(this.capabilityRegistry.values())) {
      const matchCount = pod.capabilities.filter((c: string) =>
        requiredSet.has(c)
      ).length;
      if (matchCount > 0) {
        scored.push({ pod, matchCount });
      }
    }

    scored.sort((a, b) => b.matchCount - a.matchCount);
    return scored.map(s => s.pod);
  }

  /** 分析心跳报告，发现协作机会 */
  async analyzeHeartbeat(
    report: HeartbeatReport
  ): Promise<CollaborationRequest | null> {
    const { actionItems, observations } = report;

    // 1. If both are empty, nothing to analyze
    if (actionItems.length === 0 && observations.length === 0) {
      return null;
    }

    // 2. Call LLM to analyze whether cross-Pod collaboration is needed
    let needsCollaboration = false;
    let requiredCapabilities: string[] = [];

    try {
      const prompt = [
        "Analyze the following heartbeat report and determine if cross-Pod collaboration is needed.",
        'Return a JSON object with { "needsCollaboration": boolean, "requiredCapabilities": string[] }.',
        "",
        `Action Items: ${JSON.stringify(actionItems)}`,
        `Observations: ${JSON.stringify(observations)}`,
      ].join("\n");

      const raw = await this.llmProvider.generate(prompt);

      try {
        const parsed = JSON.parse(raw) as {
          needsCollaboration: boolean;
          requiredCapabilities: string[];
        };
        needsCollaboration = parsed.needsCollaboration;
        requiredCapabilities = parsed.requiredCapabilities ?? [];
      } catch {
        // Malformed LLM response — treat as no collaboration needed
        return null;
      }
    } catch {
      // LLM call failed — log and return null per error handling spec
      return null;
    }

    // 3. If no collaboration needed or no capabilities requested, bail out
    if (!needsCollaboration || requiredCapabilities.length === 0) {
      return null;
    }

    // 4. Match target Pod capabilities (excluding the source Pod)
    const matchingPods = this.matchCapabilities(requiredCapabilities).filter(
      p => p.podId !== report.podId
    );

    // 5. No matching Pod found — log and abandon (requirement 3.4)
    if (matchingPods.length === 0) {
      return null;
    }

    // 6. Generate and return a CollaborationRequest
    const contextSummary = [...actionItems, ...observations].join("; ");

    const request: CollaborationRequest = {
      id: `collab-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      sourcePodId: report.podId,
      sourceManagerId: report.agentId,
      requiredCapabilities,
      contextSummary,
      depth: 1,
      workflowId: "",
      createdAt: Date.now(),
    };

    return request;
  }

  /** 处理收到的协作请求 */
  async handleRequest(
    request: CollaborationRequest
  ): Promise<CollaborationResponse> {
    const now = Date.now();

    // 1. Validate collaboration depth
    if (request.depth > this.config.maxDepth) {
      return {
        requestId: request.id,
        targetPodId: "",
        targetManagerId: "",
        status: "rejected",
        reason: "depth_exceeded",
        respondedAt: now,
      };
    }

    // 2. Validate concurrent session count
    if (this.getActiveSessions().length >= this.config.maxConcurrentSessions) {
      return {
        requestId: request.id,
        targetPodId: "",
        targetManagerId: "",
        status: "busy",
        reason: "swarm_capacity_exceeded",
        respondedAt: now,
      };
    }

    // 3. Validate capability legitimacy — source Pod should NOT already have all required capabilities
    const sourcePod = this.capabilityRegistry.get(request.sourcePodId);
    if (sourcePod) {
      const sourceCapSet = new Set(sourcePod.capabilities);
      const allSelfCapable = request.requiredCapabilities.every(c =>
        sourceCapSet.has(c)
      );
      if (allSelfCapable) {
        return {
          requestId: request.id,
          targetPodId: "",
          targetManagerId: "",
          status: "rejected",
          reason: "self_capability",
          respondedAt: now,
        };
      }
    }

    // 4. Match capabilities to find a target Pod
    const matchingPods = this.matchCapabilities(request.requiredCapabilities);
    // Exclude the source Pod itself from matches
    const targetPod = matchingPods.find(p => p.podId !== request.sourcePodId);

    if (!targetPod) {
      return {
        requestId: request.id,
        targetPodId: "",
        targetManagerId: "",
        status: "rejected",
        reason: "no_matching_pod",
        respondedAt: now,
      };
    }

    // 5. Create CollaborationSession and store it
    const response: CollaborationResponse = {
      requestId: request.id,
      targetPodId: targetPod.podId,
      targetManagerId: targetPod.managerId,
      status: "accepted",
      respondedAt: now,
    };

    const session: CollaborationSession = {
      id: `session-${request.id}-${now}`,
      request,
      response,
      status: "pending",
      startedAt: now,
      updatedAt: now,
    };

    this.activeSessions.set(session.id, session);

    return response;
  }

  /** 生成并分配子任务 */
  async generateSubTasks(
    session: CollaborationSession
  ): Promise<SubTaskOutput[]> {
    try {
      // 1. Extract target Pod ID from session response
      const targetPodId = session.response?.targetPodId;
      if (!targetPodId) {
        return [];
      }

      // 2. Get available workers in the target Pod
      const workers = this.agentDirectory.getAvailableWorkers(targetPodId);

      // Determine fallback assignee: target manager if no workers available
      const targetManager = this.agentDirectory.getManagerByPod(targetPodId);
      const fallbackAssigneeId =
        targetManager?.id ?? session.response!.targetManagerId;

      // 3. Call LLM to generate sub-task descriptions
      const prompt = [
        "Based on the following collaboration request, generate sub-tasks to fulfill it.",
        'Return a JSON object: { "tasks": [{ "description": string, "deliverable": string }] }',
        "",
        `Required Capabilities: ${JSON.stringify(session.request.requiredCapabilities)}`,
        `Context Summary: ${session.request.contextSummary}`,
      ].join("\n");

      const raw = await this.llmProvider.generate(prompt);

      // 4. Parse the LLM response
      let tasks: Array<{ description: string; deliverable: string }>;
      try {
        const parsed = JSON.parse(raw) as {
          tasks: Array<{ description: string; deliverable: string }>;
        };
        tasks = parsed.tasks ?? [];
      } catch {
        // Malformed LLM response — return empty array
        return [];
      }

      if (tasks.length === 0) {
        return [];
      }

      // 5. Map each generated task to a SubTaskOutput, assigning workers round-robin
      const subTasks: SubTaskOutput[] = tasks.map((task, index) => {
        // 6. If no workers available, assign to the target manager
        const assigneeId =
          workers.length > 0
            ? workers[index % workers.length].id
            : fallbackAssigneeId;

        return {
          taskId: `subtask-${session.id}-${index}`,
          workerId: assigneeId,
          description: task.description,
          deliverable: task.deliverable,
          status: "done" as const,
        };
      });

      // 7. Return the SubTaskOutput array
      return subTasks;
    } catch {
      // 8. If LLM or anything else fails, return empty array
      return [];
    }
  }

  /** 提交子任务结果 */
  async submitResult(
    sessionId: string,
    result: CollaborationResult
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Determine overall status from sub-task outputs
    const hasFailure = result.subTaskOutputs.some(o => o.status === "failed");
    result.status = hasFailure ? "failed" : "completed";

    session.result = result;
    session.status = hasFailure ? "failed" : "completed";
    session.completedAt = Date.now();
    session.updatedAt = Date.now();

    // Auto-summarize collaboration result to the associated Mission
    if (this.missionOrchestrator) {
      try {
        await this.missionOrchestrator.appendCollaborationResult(
          session.request.workflowId,
          session
        );
      } catch {
        // Don't let mission integration failures break the collaboration flow
      }
    }
  }

  /** 终止超时会话 */
  async terminateTimedOutSessions(): Promise<CollaborationSession[]> {
    const now = Date.now();
    const timedOut: CollaborationSession[] = [];

    for (const session of Array.from(this.activeSessions.values())) {
      if (
        (session.status === "active" || session.status === "pending") &&
        session.startedAt + this.config.sessionTimeoutMs < now
      ) {
        session.status = "timeout";
        session.completedAt = now;
        session.updatedAt = now;
        timedOut.push(session);
      }
    }

    return timedOut;
  }
}
