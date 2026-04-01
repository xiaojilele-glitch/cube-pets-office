import { describe, it, expect } from "vitest";
import {
  serializeIR,
  deserializeIR,
  type ExportIR,
} from "../../shared/export-schema.js";

/** Minimal valid IR for testing */
function makeMinimalIR(): ExportIR {
  return {
    version: 1,
    exportedAt: "2026-04-01T00:00:00.000Z",
    source: {
      workflowId: "wf-1",
      directive: "test directive",
      status: "completed",
    },
    agents: [
      {
        id: "a1",
        name: "Agent 1",
        role: "worker",
        title: "Worker",
        responsibility: "Do work",
        goals: ["goal1"],
        skillIds: ["s1"],
        toolIds: ["t1"],
        model: { name: "gpt-4", temperature: 0.7, maxTokens: 4096 },
      },
    ],
    teams: [
      {
        id: "team-1",
        label: "Team A",
        managerAgentId: "a1",
        memberAgentIds: ["a1"],
        strategy: "sequential",
        direction: "forward",
      },
    ],
    pipeline: {
      stages: [
        {
          name: "direction",
          label: "Direction",
          participantRoles: ["ceo"],
          executionStrategy: "sequential",
        },
      ],
    },
    skills: [
      { id: "s1", name: "Skill 1", summary: "A skill", prompt: "Do this" },
    ],
    tools: [
      {
        id: "t1",
        name: "Tool 1",
        server: "srv",
        description: "A tool",
        tools: ["tool-a"],
        connection: { transport: "stdio", endpoint: "localhost" },
      },
    ],
  };
}

describe("serializeIR", () => {
  it("should produce a valid JSON string", () => {
    const ir = makeMinimalIR();
    const json = serializeIR(ir);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe("deserializeIR", () => {
  it("should round-trip a valid IR", () => {
    const ir = makeMinimalIR();
    const result = deserializeIR(serializeIR(ir));
    expect(result).toEqual(ir);
  });

  it("should throw on invalid JSON", () => {
    expect(() => deserializeIR("{bad")).toThrow("Invalid JSON string");
  });

  it("should throw on non-object JSON", () => {
    expect(() => deserializeIR('"hello"')).toThrow("expected a JSON object");
    expect(() => deserializeIR("[]")).toThrow("expected a JSON object");
    expect(() => deserializeIR("null")).toThrow("expected a JSON object");
  });

  it("should throw when version is missing", () => {
    const ir = makeMinimalIR();
    const obj = JSON.parse(serializeIR(ir));
    delete obj.version;
    expect(() => deserializeIR(JSON.stringify(obj))).toThrow(
      'missing required field "version"'
    );
  });

  it("should throw when version is not 1", () => {
    const ir = makeMinimalIR();
    const obj = JSON.parse(serializeIR(ir));
    obj.version = 2;
    expect(() => deserializeIR(JSON.stringify(obj))).toThrow(
      "unsupported version 2"
    );
  });

  it("should throw when a required top-level field is missing", () => {
    const requiredFields = [
      "exportedAt",
      "source",
      "agents",
      "teams",
      "pipeline",
      "skills",
      "tools",
    ];
    for (const field of requiredFields) {
      const ir = makeMinimalIR();
      const obj = JSON.parse(serializeIR(ir));
      delete obj[field];
      expect(() => deserializeIR(JSON.stringify(obj))).toThrow(
        `missing required field "${field}"`
      );
    }
  });

  it("should throw when field types are wrong", () => {
    const ir = makeMinimalIR();

    // exportedAt not a string
    let obj = JSON.parse(serializeIR(ir));
    obj.exportedAt = 123;
    expect(() => deserializeIR(JSON.stringify(obj))).toThrow(
      '"exportedAt" must be a string'
    );

    // agents not an array
    obj = JSON.parse(serializeIR(ir));
    obj.agents = "not-array";
    expect(() => deserializeIR(JSON.stringify(obj))).toThrow(
      '"agents" must be an array'
    );

    // pipeline not an object
    obj = JSON.parse(serializeIR(ir));
    obj.pipeline = "not-object";
    expect(() => deserializeIR(JSON.stringify(obj))).toThrow(
      '"pipeline" must be an object'
    );
  });
});
