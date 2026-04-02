import { describe, expect, it, vi } from "vitest";
import {
  RuntimeAgent,
  type RuntimeAgentConfig,
  type RuntimeAgentDependencies,
  type VisionContext,
} from "../../shared/runtime-agent.js";
import type {
  AgentEvent,
  LLMProvider,
  MemoryRepository,
  RuntimeEventEmitter,
} from "../../shared/workflow-runtime.js";

const baseConfig: RuntimeAgentConfig = {
  id: "test-agent",
  name: "TestBot",
  department: "engineering",
  role: "worker",
  managerId: null,
  model: "gpt-4",
  soulMd: "You are a helpful assistant.",
};

function createMockDeps() {
  const events: AgentEvent[] = [];
  const eventEmitter: RuntimeEventEmitter = {
    emit: (event: AgentEvent) => events.push(event),
  };
  const memoryRepo: MemoryRepository = {
    getSoulText: (_id: string, soulMd: string) => soulMd,
    buildPromptContext: () => [],
    appendLLMExchange: vi.fn(),
  } as unknown as MemoryRepository;
  const llmProvider: LLMProvider = {
    call: vi.fn().mockResolvedValue({ content: "response" }),
    callJson: vi.fn().mockResolvedValue({ result: "ok" }),
  };
  const deps: RuntimeAgentDependencies = { memoryRepo, llmProvider, eventEmitter };
  return { deps, events };
}

describe("RuntimeAgent – analyzing_image event emission", () => {
  describe("invoke()", () => {
    it("emits analyzing_image then thinking when visionContexts are present", async () => {
      const { deps, events } = createMockDeps();
      const agent = new RuntimeAgent(baseConfig, deps);
      const visionContexts: VisionContext[] = [
        { imageName: "photo.png", visualDescription: "A cat" },
      ];

      await agent.invoke("Describe the image", [], { workflowId: "wf-1", visionContexts });

      const activeEvents = events.filter(e => e.type === "agent_active");
      expect(activeEvents).toHaveLength(3);
      expect(activeEvents[0]).toEqual({
        type: "agent_active",
        agentId: "test-agent",
        action: "analyzing_image",
        workflowId: "wf-1",
      });
      expect(activeEvents[1]).toEqual({
        type: "agent_active",
        agentId: "test-agent",
        action: "thinking",
        workflowId: "wf-1",
      });
      expect(activeEvents[2]).toEqual({
        type: "agent_active",
        agentId: "test-agent",
        action: "idle",
        workflowId: "wf-1",
      });
    });

    it("does NOT emit analyzing_image when visionContexts are absent", async () => {
      const { deps, events } = createMockDeps();
      const agent = new RuntimeAgent(baseConfig, deps);

      await agent.invoke("Hello", [], { workflowId: "wf-2" });

      const activeEvents = events.filter(e => e.type === "agent_active");
      expect(activeEvents).toHaveLength(2);
      expect(activeEvents[0]).toEqual({
        type: "agent_active",
        agentId: "test-agent",
        action: "thinking",
        workflowId: "wf-2",
      });
      expect(activeEvents[1]).toEqual({
        type: "agent_active",
        agentId: "test-agent",
        action: "idle",
        workflowId: "wf-2",
      });
    });

    it("does NOT emit analyzing_image when visionContexts is empty", async () => {
      const { deps, events } = createMockDeps();
      const agent = new RuntimeAgent(baseConfig, deps);

      await agent.invoke("Hello", [], { visionContexts: [] });

      const actions = events
        .filter(e => e.type === "agent_active")
        .map(e => (e as { action: string }).action);
      expect(actions).toEqual(["thinking", "idle"]);
    });
  });

  describe("invokeJson()", () => {
    it("emits analyzing_image then thinking when visionContexts are present", async () => {
      const { deps, events } = createMockDeps();
      const agent = new RuntimeAgent(baseConfig, deps);
      const visionContexts: VisionContext[] = [
        { imageName: "chart.png", visualDescription: "A bar chart" },
      ];

      await agent.invokeJson("Parse the chart", [], { workflowId: "wf-3", visionContexts });

      const activeEvents = events.filter(e => e.type === "agent_active");
      expect(activeEvents).toHaveLength(3);
      expect(activeEvents[0]).toEqual({
        type: "agent_active",
        agentId: "test-agent",
        action: "analyzing_image",
        workflowId: "wf-3",
      });
      expect(activeEvents[1]).toEqual({
        type: "agent_active",
        agentId: "test-agent",
        action: "thinking",
        workflowId: "wf-3",
      });
      expect(activeEvents[2]).toEqual({
        type: "agent_active",
        agentId: "test-agent",
        action: "idle",
        workflowId: "wf-3",
      });
    });

    it("does NOT emit analyzing_image when visionContexts are absent", async () => {
      const { deps, events } = createMockDeps();
      const agent = new RuntimeAgent(baseConfig, deps);

      await agent.invokeJson("Hello", []);

      const actions = events
        .filter(e => e.type === "agent_active")
        .map(e => (e as { action: string }).action);
      expect(actions).toEqual(["thinking", "idle"]);
    });
  });
});
