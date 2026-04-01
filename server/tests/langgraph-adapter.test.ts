import { describe, it, expect } from "vitest";
import { toLangGraph } from "../core/export-adapters/langgraph.js";
import type { ExportIR } from "../../shared/export-schema.js";

/** Minimal valid IR for testing */
function makeTestIR(): ExportIR {
  return {
    version: 1,
    exportedAt: "2026-04-01T00:00:00.000Z",
    source: {
      workflowId: "wf-1",
      directive: "Build a product",
      status: "completed",
    },
    agents: [
      {
        id: "ceo-1",
        name: "Chief Officer",
        role: "ceo",
        title: "Chief Executive Officer",
        responsibility: "Lead the organization",
        goals: ["Drive growth", "Set vision"],
        skillIds: ["s1"],
        toolIds: [],
        model: { name: "gpt-4", temperature: 0.7, maxTokens: 4096 },
      },
      {
        id: "mgr-1",
        name: "Project Manager",
        role: "manager",
        title: "Project Manager",
        responsibility: "Coordinate tasks",
        goals: ["Deliver on time"],
        skillIds: [],
        toolIds: ["t1"],
        model: { name: "gpt-4", temperature: 0.5, maxTokens: 4096 },
      },
      {
        id: "dev-1",
        name: "Developer",
        role: "worker",
        title: "Software Developer",
        responsibility: "Write code",
        goals: ["Write clean code", "Fix bugs"],
        skillIds: ["s1"],
        toolIds: ["t1"],
        model: { name: "gpt-3.5-turbo", temperature: 0.3, maxTokens: 2048 },
      },
    ],
    teams: [
      {
        id: "team-1",
        label: "Dev Team",
        managerAgentId: "mgr-1",
        memberAgentIds: ["mgr-1", "dev-1"],
        strategy: "parallel",
        direction: "Build features",
      },
    ],
    pipeline: {
      stages: [
        { name: "direction", label: "Direction", participantRoles: ["ceo"], executionStrategy: "sequential" },
        { name: "planning", label: "Planning", participantRoles: ["ceo", "manager"], executionStrategy: "sequential" },
        { name: "execution", label: "Execution", participantRoles: ["worker"], executionStrategy: "parallel" },
      ],
    },
    skills: [
      { id: "s1", name: "Strategic Thinking", summary: "Think strategically", prompt: "You are a strategic thinker who analyzes problems deeply." },
    ],
    tools: [
      {
        id: "t1",
        name: "Code Runner",
        server: "code-srv",
        description: "Runs code",
        tools: ["run"],
        connection: { transport: "stdio", endpoint: "localhost" },
      },
    ],
  };
}

describe("toLangGraph", () => {
  it("should return exactly 3 files", () => {
    const files = toLangGraph(makeTestIR());
    expect(files).toHaveLength(3);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("graph.json");
    expect(paths).toContain("main.py");
    expect(paths).toContain("requirements.txt");
  });

  describe("graph.json (Req 3.1)", () => {
    it("should contain one node per pipeline stage", () => {
      const files = toLangGraph(makeTestIR());
      const graphJson = JSON.parse(files.find((f) => f.path === "graph.json")!.content);

      expect(graphJson.nodes).toHaveLength(3);
      expect(graphJson.nodes[0]).toEqual({ name: "direction", label: "Direction" });
      expect(graphJson.nodes[1]).toEqual({ name: "planning", label: "Planning" });
      expect(graphJson.nodes[2]).toEqual({ name: "execution", label: "Execution" });
    });

    it("should contain sequential edges connecting stages in order", () => {
      const files = toLangGraph(makeTestIR());
      const graphJson = JSON.parse(files.find((f) => f.path === "graph.json")!.content);

      expect(graphJson.edges).toHaveLength(2);
      expect(graphJson.edges[0]).toEqual({ from: "direction", to: "planning" });
      expect(graphJson.edges[1]).toEqual({ from: "planning", to: "execution" });
    });

    it("should have json language", () => {
      const files = toLangGraph(makeTestIR());
      const graphFile = files.find((f) => f.path === "graph.json")!;
      expect(graphFile.language).toBe("json");
    });
  });

  describe("main.py (Req 3.2, 3.3)", () => {
    it("should contain StateGraph construction and imports", () => {
      const files = toLangGraph(makeTestIR());
      const mainPy = files.find((f) => f.path === "main.py")!.content;

      expect(mainPy).toContain("from langgraph.graph import StateGraph, END");
      expect(mainPy).toContain("from langchain_openai import ChatOpenAI");
      expect(mainPy).toContain("def build_graph()");
      expect(mainPy).toContain("StateGraph(GraphState)");
    });

    it("should generate a handler function for each agent (Req 3.3)", () => {
      const files = toLangGraph(makeTestIR());
      const mainPy = files.find((f) => f.path === "main.py")!.content;

      expect(mainPy).toContain("def chief_officer_handler(state: GraphState)");
      expect(mainPy).toContain("def project_manager_handler(state: GraphState)");
      expect(mainPy).toContain("def developer_handler(state: GraphState)");
    });

    it("should include role and responsibility as system prompt in handlers (Req 3.3)", () => {
      const files = toLangGraph(makeTestIR());
      const mainPy = files.find((f) => f.path === "main.py")!.content;

      expect(mainPy).toContain("Role: Chief Executive Officer");
      expect(mainPy).toContain("Responsibility: Lead the organization");
      expect(mainPy).toContain("Role: Software Developer");
      expect(mainPy).toContain("Responsibility: Write code");
    });

    it("should generate stage node functions that dispatch to agent handlers", () => {
      const files = toLangGraph(makeTestIR());
      const mainPy = files.find((f) => f.path === "main.py")!.content;

      expect(mainPy).toContain("def node_direction(state: GraphState)");
      expect(mainPy).toContain("def node_planning(state: GraphState)");
      expect(mainPy).toContain("def node_execution(state: GraphState)");
    });

    it("should set entry point and connect last stage to END", () => {
      const files = toLangGraph(makeTestIR());
      const mainPy = files.find((f) => f.path === "main.py")!.content;

      expect(mainPy).toContain('workflow.set_entry_point("direction")');
      expect(mainPy).toContain('workflow.add_edge("execution", END)');
    });

    it("should include graph compilation and execution in main block", () => {
      const files = toLangGraph(makeTestIR());
      const mainPy = files.find((f) => f.path === "main.py")!.content;

      expect(mainPy).toContain('if __name__ == "__main__":');
      expect(mainPy).toContain("graph.compile()");
      expect(mainPy).toContain("app.invoke(");
    });

    it("should have python language", () => {
      const files = toLangGraph(makeTestIR());
      const mainFile = files.find((f) => f.path === "main.py")!;
      expect(mainFile.language).toBe("python");
    });
  });

  describe("requirements.txt (Req 3.4)", () => {
    it("should list langgraph and langchain dependencies", () => {
      const files = toLangGraph(makeTestIR());
      const reqTxt = files.find((f) => f.path === "requirements.txt")!.content;

      expect(reqTxt).toContain("langgraph");
      expect(reqTxt).toContain("langchain");
    });
  });

  describe("edge cases", () => {
    it("should handle IR with no agents", () => {
      const ir = makeTestIR();
      ir.agents = [];
      ir.skills = [];
      const files = toLangGraph(ir);
      expect(files).toHaveLength(3);

      // graph.json should still have nodes for stages
      const graphJson = JSON.parse(files.find((f) => f.path === "graph.json")!.content);
      expect(graphJson.nodes).toHaveLength(3);

      // main.py should not have agent handler functions but should still have stage nodes
      const mainPy = files.find((f) => f.path === "main.py")!.content;
      expect(mainPy).toContain("def node_direction");
    });

    it("should handle IR with no stages", () => {
      const ir = makeTestIR();
      ir.pipeline.stages = [];
      const files = toLangGraph(ir);
      expect(files).toHaveLength(3);

      const graphJson = JSON.parse(files.find((f) => f.path === "graph.json")!.content);
      expect(graphJson.nodes).toHaveLength(0);
      expect(graphJson.edges).toHaveLength(0);
    });

    it("should handle single stage (no edges)", () => {
      const ir = makeTestIR();
      ir.pipeline.stages = [
        { name: "direction", label: "Direction", participantRoles: ["ceo"], executionStrategy: "sequential" },
      ];
      const files = toLangGraph(ir);

      const graphJson = JSON.parse(files.find((f) => f.path === "graph.json")!.content);
      expect(graphJson.nodes).toHaveLength(1);
      expect(graphJson.edges).toHaveLength(0);
    });
  });
});
