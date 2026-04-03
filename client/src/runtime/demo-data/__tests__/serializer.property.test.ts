import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import { serializeDemoData, deserializeDemoData } from "../serializer";
import type { DemoDataBundle, DemoMemoryEntry, DemoEvolutionLog, DemoTimedEvent } from "../schema";
import type {
  AgentRecord,
  WorkflowRecord,
  MessageRecord,
  TaskRecord,
  AgentEvent,
  AgentRole,
  WorkflowStatus,
} from "@shared/workflow-runtime";
import type {
  WorkflowOrganizationSnapshot,
  WorkflowOrganizationNode,
  WorkflowOrganizationDepartment,
  WorkflowSkillBinding,
  WorkflowMcpBinding,
  WorkflowNodeModelConfig,
  WorkflowNodeExecutionConfig,
} from "@shared/organization-schema";

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

/** Non-empty alphanumeric string that survives JSON round-trip */
const arbId = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);
const arbStr = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);
const arbIsoDate = fc
  .integer({ min: new Date("2020-01-01").getTime(), max: new Date("2030-01-01").getTime() })
  .map((ts) => new Date(ts).toISOString());

const arbRole: fc.Arbitrary<AgentRole> = fc.constantFrom("ceo", "manager", "worker");
const arbWorkflowStatus: fc.Arbitrary<WorkflowStatus> = fc.constantFrom(
  "pending", "running", "completed", "completed_with_errors", "failed",
);

const arbSkillBinding: fc.Arbitrary<WorkflowSkillBinding> = fc.record({
  id: arbId,
  name: arbStr,
  summary: arbStr,
  prompt: arbStr,
});

const arbMcpBinding: fc.Arbitrary<WorkflowMcpBinding> = fc.record({
  id: arbId,
  name: arbStr,
  server: arbStr,
  description: arbStr,
  connection: fc.record({
    transport: arbStr,
    endpoint: arbStr,
  }),
  tools: fc.array(arbStr, { minLength: 0, maxLength: 3 }),
});

/** Positive double that avoids -0 (which doesn't survive JSON round-trip) */
const arbPositiveDouble = (max: number) =>
  fc.double({ min: 0, max, noNaN: true, noDefaultInfinity: true }).map((v) =>
    Object.is(v, -0) ? 0 : v,
  );

const arbModelConfig: fc.Arbitrary<WorkflowNodeModelConfig> = fc.record({
  model: arbStr,
  temperature: arbPositiveDouble(2),
  maxTokens: fc.integer({ min: 1, max: 100000 }),
});

const arbExecutionMode = fc.constantFrom(
  "orchestrate" as const, "plan" as const, "execute" as const,
  "review" as const, "audit" as const, "summary" as const,
);
const arbStrategy = fc.constantFrom("parallel" as const, "sequential" as const, "batched" as const);

const arbExecutionConfig: fc.Arbitrary<WorkflowNodeExecutionConfig> = fc.record({
  mode: arbExecutionMode,
  strategy: arbStrategy,
  maxConcurrency: fc.integer({ min: 1, max: 10 }),
});

const arbOrgNode: fc.Arbitrary<WorkflowOrganizationNode> = fc.record({
  id: arbId,
  agentId: arbId,
  parentId: fc.option(arbId, { nil: null }),
  departmentId: arbId,
  departmentLabel: arbStr,
  name: arbStr,
  title: arbStr,
  role: arbRole,
  responsibility: arbStr,
  responsibilities: fc.array(arbStr, { minLength: 0, maxLength: 3 }),
  goals: fc.array(arbStr, { minLength: 0, maxLength: 3 }),
  summaryFocus: fc.array(arbStr, { minLength: 0, maxLength: 3 }),
  skills: fc.array(arbSkillBinding, { minLength: 0, maxLength: 2 }),
  mcp: fc.array(arbMcpBinding, { minLength: 0, maxLength: 2 }),
  model: arbModelConfig,
  execution: arbExecutionConfig,
});

const arbDepartment: fc.Arbitrary<WorkflowOrganizationDepartment> = fc.record({
  id: arbId,
  label: arbStr,
  managerNodeId: arbId,
  direction: arbStr,
  strategy: arbStrategy,
  maxConcurrency: fc.integer({ min: 1, max: 10 }),
});

const arbOrganization: fc.Arbitrary<WorkflowOrganizationSnapshot> = fc.record({
  kind: fc.constant("workflow_organization" as const),
  version: fc.constant(1 as const),
  workflowId: arbId,
  directive: arbStr,
  generatedAt: arbIsoDate,
  source: fc.constantFrom("generated" as const, "fallback" as const),
  taskProfile: arbStr,
  reasoning: arbStr,
  rootNodeId: arbId,
  rootAgentId: arbId,
  departments: fc.array(arbDepartment, { minLength: 1, maxLength: 3 }),
  nodes: fc.array(arbOrgNode, { minLength: 1, maxLength: 5 }),
});

const arbWorkflow: fc.Arbitrary<WorkflowRecord> = fc.record({
  id: arbId,
  directive: arbStr,
  status: arbWorkflowStatus,
  current_stage: fc.option(arbStr, { nil: null }),
  departments_involved: fc.array(arbStr, { minLength: 0, maxLength: 3 }),
  started_at: fc.option(arbIsoDate, { nil: null }),
  completed_at: fc.option(arbIsoDate, { nil: null }),
  results: fc.jsonValue(),
  created_at: arbIsoDate,
});

const arbAgent: fc.Arbitrary<AgentRecord> = fc.record({
  id: arbId,
  name: arbStr,
  department: arbStr,
  role: arbRole,
  manager_id: fc.option(arbId, { nil: null }),
  model: arbStr,
  soul_md: fc.option(arbStr, { nil: null }),
  heartbeat_config: fc.jsonValue(),
  is_active: fc.constantFrom(0, 1),
  created_at: arbIsoDate,
  updated_at: arbIsoDate,
});

const arbMessage: fc.Arbitrary<MessageRecord> = fc.record({
  id: fc.integer({ min: 1, max: 100000 }),
  workflow_id: arbId,
  from_agent: arbId,
  to_agent: arbId,
  stage: arbStr,
  content: arbStr,
  metadata: fc.jsonValue(),
  created_at: arbIsoDate,
});

const arbTask: fc.Arbitrary<TaskRecord> = fc.record({
  id: fc.integer({ min: 1, max: 100000 }),
  workflow_id: arbId,
  worker_id: arbId,
  manager_id: arbId,
  department: arbStr,
  description: arbStr,
  deliverable: fc.option(arbStr, { nil: null }),
  deliverable_v2: fc.option(arbStr, { nil: null }),
  deliverable_v3: fc.option(arbStr, { nil: null }),
  score_accuracy: fc.option(arbPositiveDouble(10), { nil: null }),
  score_completeness: fc.option(arbPositiveDouble(10), { nil: null }),
  score_actionability: fc.option(arbPositiveDouble(10), { nil: null }),
  score_format: fc.option(arbPositiveDouble(10), { nil: null }),
  total_score: fc.option(arbPositiveDouble(10), { nil: null }),
  manager_feedback: fc.option(arbStr, { nil: null }),
  meta_audit_feedback: fc.option(arbStr, { nil: null }),
  verify_result: fc.jsonValue(),
  version: fc.integer({ min: 1, max: 100 }),
  status: arbStr,
  created_at: arbIsoDate,
  updated_at: arbIsoDate,
});

const arbMemoryEntry: fc.Arbitrary<DemoMemoryEntry> = fc.record({
  agentId: arbId,
  kind: fc.constantFrom("short_term" as const, "medium_term" as const, "long_term" as const),
  stage: arbStr,
  content: arbStr,
  timestampOffset: fc.integer({ min: 0, max: 100000 }),
});

const arbEvolutionLog: fc.Arbitrary<DemoEvolutionLog> = fc.record({
  agentId: arbId,
  dimension: arbStr,
  oldScore: arbPositiveDouble(100),
  newScore: arbPositiveDouble(100),
  patchContent: arbStr,
  applied: fc.boolean(),
});

// AgentEvent discriminated union — generate one variant at a time
const arbAgentEvent: fc.Arbitrary<AgentEvent> = fc.oneof(
  fc.record({
    type: fc.constant("stage_change" as const),
    workflowId: arbId,
    stage: arbStr,
  }),
  fc.record({
    type: fc.constant("stage_complete" as const),
    workflowId: arbId,
    stage: arbStr,
  }),
  fc.record({
    type: fc.constant("agent_active" as const),
    agentId: arbId,
    action: arbStr,
    workflowId: fc.option(arbId, { nil: undefined }),
  }).map((e) => {
    // Remove undefined workflowId so JSON round-trip is clean
    if (e.workflowId === undefined) {
      const { workflowId: _, ...rest } = e;
      return rest as AgentEvent;
    }
    return e as AgentEvent;
  }),
  fc.record({
    type: fc.constant("message_sent" as const),
    workflowId: arbId,
    from: arbId,
    to: arbId,
    stage: arbStr,
    preview: arbStr,
    timestamp: arbIsoDate,
  }),
  fc.record({
    type: fc.constant("score_assigned" as const),
    workflowId: arbId,
    taskId: fc.integer({ min: 1, max: 100000 }),
    workerId: arbId,
    score: arbPositiveDouble(10),
  }),
  fc.record({
    type: fc.constant("task_update" as const),
    workflowId: arbId,
    taskId: fc.integer({ min: 1, max: 100000 }),
    workerId: arbId,
    status: arbStr,
  }),
  fc.record({
    type: fc.constant("workflow_complete" as const),
    workflowId: arbId,
    status: arbStr,
    summary: arbStr,
  }),
  fc.record({
    type: fc.constant("workflow_error" as const),
    workflowId: arbId,
    error: arbStr,
  }),
  fc.record({
    type: fc.constant("heartbeat_status" as const),
    status: fc.jsonValue(),
  }),
  fc.record({
    type: fc.constant("heartbeat_report_saved" as const),
    agentId: arbId,
    reportId: arbId,
    title: arbStr,
    generatedAt: arbIsoDate,
    summary: arbStr,
    jsonPath: arbStr,
    markdownPath: arbStr,
  }),
  fc.record({
    type: fc.constant("agent.roleChanged" as const),
    agentId: arbId,
    fromRoleId: fc.option(arbId, { nil: null }),
    toRoleId: fc.option(arbId, { nil: null }),
    timestamp: arbIsoDate,
  }),
);

const arbTimedEvent: fc.Arbitrary<DemoTimedEvent> = fc.record({
  timestampOffset: fc.integer({ min: 0, max: 100000 }),
  event: arbAgentEvent,
});

const arbDemoDataBundle: fc.Arbitrary<DemoDataBundle> = fc.record({
  version: fc.constant(1 as const),
  scenarioName: arbStr,
  scenarioDescription: arbStr,
  organization: arbOrganization,
  workflow: arbWorkflow,
  agents: fc.array(arbAgent, { minLength: 1, maxLength: 5 }),
  messages: fc.array(arbMessage, { minLength: 0, maxLength: 5 }),
  tasks: fc.array(arbTask, { minLength: 0, maxLength: 5 }),
  memoryEntries: fc.array(arbMemoryEntry, { minLength: 0, maxLength: 5 }),
  evolutionLogs: fc.array(arbEvolutionLog, { minLength: 0, maxLength: 5 }),
  events: fc.array(arbTimedEvent, { minLength: 0, maxLength: 5 }),
});

// ---------------------------------------------------------------------------
// Property 1: 序列化 Round-Trip 一致性
// **Validates: Requirements 2.2, 2.3, 2.4**
// ---------------------------------------------------------------------------

describe("serializer property tests", () => {
  it("Property 1: serialize → deserialize round-trip produces deeply equal object", () => {
    fc.assert(
      fc.property(arbDemoDataBundle, (bundle) => {
        const json = serializeDemoData(bundle);
        const restored = deserializeDemoData(json);
        expect(restored).toEqual(bundle);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: 事件序列时间戳单调递增
// **Validates: Requirements 1.3**
// ---------------------------------------------------------------------------

/** Bundle with events sorted by timestampOffset (ascending) */
const arbSortedEventsBundle: fc.Arbitrary<DemoDataBundle> = arbDemoDataBundle.map((bundle) => ({
  ...bundle,
  events: [...bundle.events].sort((a, b) => a.timestampOffset - b.timestampOffset),
}));

describe("event sequence timestamp property tests", () => {
  it("Property 2: events timestampOffset is monotonically non-decreasing after round-trip", () => {
    fc.assert(
      fc.property(arbSortedEventsBundle, (bundle) => {
        const json = serializeDemoData(bundle);
        const restored = deserializeDemoData(json);

        const events = restored.events;
        for (let i = 1; i < events.length; i++) {
          expect(events[i].timestampOffset).toBeGreaterThanOrEqual(
            events[i - 1].timestampOffset,
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 3: 序列化输出为格式化 JSON
// **Validates: Requirements 2.5**
// ---------------------------------------------------------------------------

describe("serialized output format property tests", () => {
  it("Property 3: serializeDemoData output is formatted JSON with newlines and indentation", () => {
    fc.assert(
      fc.property(arbDemoDataBundle, (bundle) => {
        const output = serializeDemoData(bundle);

        // 1. Output contains newline characters
        expect(output).toContain("\n");

        // 2. Output contains indentation (spaces at the start of lines)
        const lines = output.split("\n");
        const indentedLines = lines.filter((line) => /^\s{2,}/.test(line));
        expect(indentedLines.length).toBeGreaterThan(0);

        // 3. JSON.parse does not throw
        expect(() => JSON.parse(output)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 4: 反序列化无效输入产生描述性错误
// **Validates: Requirements 2.6**
// ---------------------------------------------------------------------------

const requiredTopLevelFields = [
  "organization",
  "workflow",
  "agents",
  "messages",
  "tasks",
  "memoryEntries",
  "evolutionLogs",
  "events",
  "version",
] as const;

describe("deserialization error handling property tests", () => {
  it("Property 4: deserializeDemoData throws descriptive error when a required field is deleted", () => {
    fc.assert(
      fc.property(
        arbDemoDataBundle,
        fc.constantFrom(...requiredTopLevelFields),
        (bundle, fieldToDelete) => {
          const json = serializeDemoData(bundle);
          const parsed = JSON.parse(json);
          delete parsed[fieldToDelete];
          const corrupted = JSON.stringify(parsed);

          expect(() => deserializeDemoData(corrupted)).toThrowError(/Invalid DemoDataBundle/);
        },
      ),
      { numRuns: 100 },
    );
  });
});
