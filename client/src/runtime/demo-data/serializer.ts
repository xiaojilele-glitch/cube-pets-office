import type { DemoDataBundle } from "./schema";

/**
 * 将 DemoDataBundle 序列化为格式化 JSON 字符串
 */
export function serializeDemoData(bundle: DemoDataBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/**
 * 将 JSON 字符串反序列化为 DemoDataBundle，包含结构验证
 */
export function deserializeDemoData(json: string): DemoDataBundle {
  const parsed = JSON.parse(json);
  validateDemoDataBundle(parsed);
  return parsed as DemoDataBundle;
}

/**
 * 验证解析后的对象是否符合 DemoDataBundle 结构
 */
export function validateDemoDataBundle(data: unknown): asserts data is DemoDataBundle {
  if (data === null || typeof data !== "object") {
    throw new Error("Invalid DemoDataBundle: expected an object");
  }

  const obj = data as Record<string, unknown>;

  // version
  if (!("version" in obj)) {
    throw new Error("Invalid DemoDataBundle: missing field 'version'");
  }
  if (obj.version !== 1) {
    throw new Error(
      `Invalid DemoDataBundle: unsupported version ${obj.version}, expected 1`
    );
  }

  // organization
  requireField(obj, "organization", "object");
  const org = obj.organization as Record<string, unknown>;
  if (org.kind !== "workflow_organization") {
    throw new Error(
      `Invalid DemoDataBundle: field 'organization.kind' expected "workflow_organization", got ${JSON.stringify(org.kind)}`
    );
  }

  // workflow
  requireField(obj, "workflow", "object");
  const wf = obj.workflow as Record<string, unknown>;
  requireField(wf, "id", "string", "workflow");
  requireField(wf, "directive", "string", "workflow");
  requireField(wf, "status", "string", "workflow");

  // agents — non-empty array
  requireField(obj, "agents", "array");
  const agents = obj.agents as unknown[];
  if (agents.length === 0) {
    throw new Error(
      "Invalid DemoDataBundle: field 'agents' expected non-empty array"
    );
  }

  // messages — array
  requireField(obj, "messages", "array");

  // tasks — array
  requireField(obj, "tasks", "array");

  // memoryEntries — array with element validation
  requireField(obj, "memoryEntries", "array");
  const memoryEntries = obj.memoryEntries as unknown[];
  for (let i = 0; i < memoryEntries.length; i++) {
    const entry = memoryEntries[i] as Record<string, unknown>;
    const prefix = `memoryEntries[${i}]`;
    requireField(entry, "agentId", "string", prefix);
    requireField(entry, "kind", "string", prefix);
    requireField(entry, "stage", "string", prefix);
    requireField(entry, "content", "string", prefix);
    requireField(entry, "timestampOffset", "number", prefix);
  }

  // evolutionLogs — array with element validation
  requireField(obj, "evolutionLogs", "array");
  const evolutionLogs = obj.evolutionLogs as unknown[];
  for (let i = 0; i < evolutionLogs.length; i++) {
    const log = evolutionLogs[i] as Record<string, unknown>;
    const prefix = `evolutionLogs[${i}]`;
    requireField(log, "agentId", "string", prefix);
    requireField(log, "dimension", "string", prefix);
    requireField(log, "oldScore", "number", prefix);
    requireField(log, "newScore", "number", prefix);
  }

  // events — array with element validation
  requireField(obj, "events", "array");
  const events = obj.events as unknown[];
  for (let i = 0; i < events.length; i++) {
    const evt = events[i] as Record<string, unknown>;
    const prefix = `events[${i}]`;
    requireField(evt, "timestampOffset", "number", prefix);
    requireField(evt, "event", "object", prefix);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ExpectedType = "string" | "number" | "object" | "array";

function requireField(
  obj: Record<string, unknown>,
  field: string,
  expected: ExpectedType,
  parentPath?: string,
): void {
  const fieldPath = parentPath ? `${parentPath}.${field}` : field;

  if (!(field in obj) || obj[field] === undefined) {
    throw new Error(
      `Invalid DemoDataBundle: missing field '${fieldPath}'`
    );
  }

  const value = obj[field];

  if (expected === "array") {
    if (!Array.isArray(value)) {
      throw new Error(
        `Invalid DemoDataBundle: field '${fieldPath}' expected array, got ${typeof value}`
      );
    }
    return;
  }

  if (typeof value !== expected) {
    throw new Error(
      `Invalid DemoDataBundle: field '${fieldPath}' expected ${expected}, got ${typeof value}`
    );
  }
}
