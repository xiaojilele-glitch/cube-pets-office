/**
 * 跨 Pod 自主协作协议类型定义
 *
 * 所有类型使用纯数据结构（number 时间戳，string ID），确保 JSON 序列化安全。
 */

/** 跨 Pod 协作请求，由源 Pod 的 Manager 发起 */
export interface CollaborationRequest {
  id: string;
  sourcePodId: string;
  sourceManagerId: string;
  requiredCapabilities: string[];
  contextSummary: string;
  depth: number;
  workflowId: string;
  createdAt: number;
}

/** 目标 Pod 对协作请求的响应 */
export interface CollaborationResponse {
  requestId: string;
  targetPodId: string;
  targetManagerId: string;
  status: "accepted" | "rejected" | "busy";
  estimatedCompletionMs?: number;
  reason?: string;
  respondedAt: number;
}

/** 协作结果，包含子任务产出和完成状态 */
export interface CollaborationResult {
  requestId: string;
  sessionId: string;
  status: "completed" | "failed" | "timeout";
  resultSummary: string;
  subTaskOutputs: SubTaskOutput[];
  completedAt: number;
  errorReason?: string;
}

/** 单个子任务的产出 */
export interface SubTaskOutput {
  taskId: string;
  workerId: string;
  description: string;
  deliverable: string;
  status: "done" | "failed";
}

/** 一次完整的跨 Pod 协作会话 */
export interface CollaborationSession {
  id: string;
  request: CollaborationRequest;
  response?: CollaborationResponse;
  result?: CollaborationResult;
  status: "pending" | "active" | "completed" | "failed" | "timeout";
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
}

/** Pod 对外声明的能力描述 */
export interface PodCapability {
  podId: string;
  managerId: string;
  capabilities: string[];
  currentLoad: number;
  maxConcurrency: number;
}

/** SwarmOrchestrator 配置 */
export interface SwarmConfig {
  maxDepth: number;
  maxConcurrentSessions: number;
  sessionTimeoutMs: number;
  summaryMaxLength: number;
}

export const DEFAULT_SWARM_CONFIG: SwarmConfig = {
  maxDepth: 3,
  maxConcurrentSessions: 3,
  sessionTimeoutMs: 300_000,
  summaryMaxLength: 200,
};
