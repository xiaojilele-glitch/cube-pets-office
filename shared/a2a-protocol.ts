/** 支持的外部框架类型 */
export type A2AFrameworkType = "crewai" | "langgraph" | "claude" | "custom";

/** 支持的 A2A 方法 */
export type A2AMethod = "a2a.invoke" | "a2a.stream" | "a2a.cancel";

/** A2A 协议信封（基于 JSON-RPC 2.0） */
export interface A2AEnvelope {
  jsonrpc: "2.0";
  method: A2AMethod;
  id: string;
  params: A2AInvokeParams;
  auth?: string;
}

/** 调用参数 */
export interface A2AInvokeParams {
  targetAgent: string;
  task: string;
  context: string; // 最大 2000 字符
  capabilities: string[];
  streamMode: boolean;
}

/** 调用响应 */
export interface A2AResponse {
  jsonrpc: "2.0";
  id: string;
  result?: A2AResult;
  error?: A2AError;
}

/** 成功结果 */
export interface A2AResult {
  output: string;
  artifacts: A2AArtifact[];
  metadata: Record<string, string>;
}

/** 产物 */
export interface A2AArtifact {
  name: string;
  type: string; // MIME type
  content: string; // base64 或文本
}

/** 错误信息 */
export interface A2AError {
  code: number;
  message: string;
  data?: unknown;
}

/** 流式响应块 */
export interface A2AStreamChunk {
  jsonrpc: "2.0";
  id: string;
  chunk: string;
  done: boolean;
}

/** A2A 会话状态 */
export type A2ASessionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** A2A 会话 */
export interface A2ASession {
  sessionId: string;
  requestEnvelope: A2AEnvelope;
  status: A2ASessionStatus;
  frameworkType: A2AFrameworkType;
  startedAt: number;
  completedAt?: number;
  response?: A2AResponse;
  streamChunks: A2AStreamChunk[];
}

/** 外部 Agent 注册信息 */
export interface ExternalAgentRegistration {
  id: string;
  name: string;
  frameworkType: A2AFrameworkType;
  endpoint: string;
  auth?: string;
  capabilities: string[];
  description: string;
}

/** A2A 标准错误码 */
export const A2A_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  AUTH_FAILED: -32001,
  AGENT_NOT_FOUND: -32002,
  RATE_LIMITED: -32003,
  TIMEOUT: -32004,
  CANCELLED: -32005,
  FRAMEWORK_ERROR: -32006,
} as const;

// ─── Utility Functions ───────────────────────────────────────────────

/** 序列化 A2AEnvelope 为 JSON */
export function serializeEnvelope(envelope: A2AEnvelope): string {
  return JSON.stringify(envelope);
}

/** 从 JSON 反序列化 A2AEnvelope */
export function deserializeEnvelope(json: string): A2AEnvelope {
  return JSON.parse(json) as A2AEnvelope;
}

/** 序列化 A2ASession 为 JSON */
export function serializeSession(session: A2ASession): string {
  return JSON.stringify(session);
}

/** 从 JSON 反序列化 A2ASession */
export function deserializeSession(json: string): A2ASession {
  return JSON.parse(json) as A2ASession;
}

/** 验证 context 长度不超过 2000 字符 */
export function validateContext(context: string): boolean {
  return context.length <= 2000;
}

/** 构建 A2AEnvelope 的工厂函数 */
export function createEnvelope(
  method: A2AMethod,
  params: A2AInvokeParams,
  auth?: string
): A2AEnvelope {
  return {
    jsonrpc: "2.0",
    method,
    id: crypto.randomUUID(),
    params,
    ...(auth !== undefined && { auth }),
  };
}
