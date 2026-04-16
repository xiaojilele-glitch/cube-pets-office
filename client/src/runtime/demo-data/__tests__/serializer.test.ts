import { describe, expect, it } from "vitest";
import { deserializeDemoData } from "../serializer";

/**
 * Serializer unit tests — edge cases for deserializeDemoData
 * **Validates: Requirements 2.6**
 */

/** Minimal valid bundle used as a base for partial-field tests */
function makeValidBundleObj() {
  return {
    version: 1,
    scenarioName: "test",
    scenarioDescription: "test desc",
    organization: {
      kind: "workflow_organization",
      version: 1,
      workflowId: "w1",
      directive: "d",
      generatedAt: new Date().toISOString(),
      source: "generated",
      taskProfile: "tp",
      reasoning: "r",
      rootNodeId: "n1",
      rootAgentId: "a1",
      departments: [],
      nodes: [],
    },
    workflow: {
      id: "w1",
      directive: "d",
      status: "completed",
      current_stage: null,
      departments_involved: [],
      started_at: null,
      completed_at: null,
      results: null,
      created_at: new Date().toISOString(),
    },
    agents: [
      {
        id: "a1",
        name: "Agent1",
        department: "d1",
        role: "ceo",
        manager_id: null,
        model: "gpt-4",
        soul_md: null,
        heartbeat_config: null,
        is_active: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    messages: [],
    tasks: [],
    memoryEntries: [],
    evolutionLogs: [],
    events: [],
  };
}

describe("deserializeDemoData edge cases", () => {
  it("should throw SyntaxError on empty string input", () => {
    expect(() => deserializeDemoData("")).toThrow(SyntaxError);
  });

  it("should throw on null input", () => {
    expect(() => deserializeDemoData(null as unknown as string)).toThrow();
  });

  it("should throw with field path when organization is missing", () => {
    const obj = makeValidBundleObj();
    delete (obj as Record<string, unknown>).organization;
    expect(() => deserializeDemoData(JSON.stringify(obj))).toThrow(
      "Invalid DemoDataBundle: missing field 'organization'"
    );
  });

  it("should throw with field path when workflow is missing", () => {
    const obj = makeValidBundleObj();
    delete (obj as Record<string, unknown>).workflow;
    expect(() => deserializeDemoData(JSON.stringify(obj))).toThrow(
      "Invalid DemoDataBundle: missing field 'workflow'"
    );
  });

  it("should throw with field path when agents is missing", () => {
    const obj = makeValidBundleObj();
    delete (obj as Record<string, unknown>).agents;
    expect(() => deserializeDemoData(JSON.stringify(obj))).toThrow(
      "Invalid DemoDataBundle: missing field 'agents'"
    );
  });

  it("should throw with 'unsupported version' on version mismatch", () => {
    const obj = makeValidBundleObj();
    (obj as Record<string, unknown>).version = 2;
    expect(() => deserializeDemoData(JSON.stringify(obj))).toThrow(
      "Invalid DemoDataBundle: unsupported version 2, expected 1"
    );
  });

  it("should throw with 'non-empty array' when agents is empty array", () => {
    const obj = makeValidBundleObj();
    obj.agents = [];
    expect(() => deserializeDemoData(JSON.stringify(obj))).toThrow(
      "Invalid DemoDataBundle: field 'agents' expected non-empty array"
    );
  });

  it("should throw with type mismatch when agents is a string instead of array", () => {
    const obj = makeValidBundleObj();
    (obj as Record<string, unknown>).agents = "not-an-array";
    expect(() => deserializeDemoData(JSON.stringify(obj))).toThrow(
      "Invalid DemoDataBundle: field 'agents' expected array, got string"
    );
  });

  it("should throw when organization.kind is not 'workflow_organization'", () => {
    const obj = makeValidBundleObj();
    (obj.organization as Record<string, unknown>).kind = "other_kind";
    expect(() => deserializeDemoData(JSON.stringify(obj))).toThrow(
      /organization\.kind/
    );
  });

  it("should throw 'expected an object' when input is a JSON primitive", () => {
    expect(() => deserializeDemoData("42")).toThrow(
      "Invalid DemoDataBundle: expected an object"
    );
  });

  it("should throw 'expected an object' when input is JSON null", () => {
    expect(() => deserializeDemoData("null")).toThrow(
      "Invalid DemoDataBundle: expected an object"
    );
  });
});
