import { describe, it, expect } from "vitest";
import { toCrewAI } from "../core/export-adapters/crewai.js";
import type { ExportIR } from "../../shared/export-schema.js";

/** Minimal valid IR with skills for testing */
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

describe("toCrewAI", () => {
  it("should return exactly 4 files", () => {
    const files = toCrewAI(makeTestIR());
    expect(files).toHaveLength(4);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("agents.yaml");
    expect(paths).toContain("tasks.yaml");
    expect(paths).toContain("crew.py");
    expect(paths).toContain("requirements.txt");
  });

  describe("agents.yaml (Req 2.1, 2.5)", () => {
    it("should contain an entry for every agent with role/goal/backstory", () => {
      const files = toCrewAI(makeTestIR());
      const agentsYaml = files.find((f) => f.path === "agents.yaml")!.content;

      // Each agent key present
      expect(agentsYaml).toContain("chief_officer:");
      expect(agentsYaml).toContain("project_manager:");
      expect(agentsYaml).toContain("developer:");

      // role, goal, backstory fields present for each
      expect(agentsYaml).toContain("role:");
      expect(agentsYaml).toContain("goal:");
      expect(agentsYaml).toContain("backstory:");
    });

    it("should embed skill prompt in backstory for agents with skills (Req 2.5)", () => {
      const files = toCrewAI(makeTestIR());
      const agentsYaml = files.find((f) => f.path === "agents.yaml")!.content;

      // CEO has skill s1 → backstory should contain the skill prompt
      expect(agentsYaml).toContain("You are a strategic thinker who analyzes problems deeply.");
    });

    it("should set allow_delegation based on role", () => {
      const files = toCrewAI(makeTestIR());
      const agentsYaml = files.find((f) => f.path === "agents.yaml")!.content;

      // Workers should not delegate
      const devSection = agentsYaml.split("developer:")[1];
      expect(devSection).toContain("allow_delegation: false");
    });

    it("should have yaml language", () => {
      const files = toCrewAI(makeTestIR());
      const agentsFile = files.find((f) => f.path === "agents.yaml")!;
      expect(agentsFile.language).toBe("yaml");
    });
  });

  describe("tasks.yaml (Req 2.2)", () => {
    it("should contain a task entry for every pipeline stage", () => {
      const files = toCrewAI(makeTestIR());
      const tasksYaml = files.find((f) => f.path === "tasks.yaml")!.content;

      expect(tasksYaml).toContain("direction:");
      expect(tasksYaml).toContain("planning:");
      expect(tasksYaml).toContain("execution:");
    });

    it("should include description, expected_output, and agent for each task", () => {
      const files = toCrewAI(makeTestIR());
      const tasksYaml = files.find((f) => f.path === "tasks.yaml")!.content;

      expect(tasksYaml).toContain("description:");
      expect(tasksYaml).toContain("expected_output:");
      expect(tasksYaml).toContain("agent:");
    });

    it("should assign agents based on participant roles", () => {
      const files = toCrewAI(makeTestIR());
      const tasksYaml = files.find((f) => f.path === "tasks.yaml")!.content;

      // direction stage has participantRoles: ["ceo"] → should pick CEO agent
      const directionSection = tasksYaml.split("direction:")[1].split("\n\n")[0];
      expect(directionSection).toContain("agent: chief_officer");

      // execution stage has participantRoles: ["worker"] → should pick worker agent
      const executionSection = tasksYaml.split("execution:")[1].split("\n\n")[0];
      expect(executionSection).toContain("agent: developer");
    });
  });

  describe("crew.py (Req 2.3)", () => {
    it("should contain Crew class definition and imports", () => {
      const files = toCrewAI(makeTestIR());
      const crewPy = files.find((f) => f.path === "crew.py")!.content;

      expect(crewPy).toContain("from crewai import Agent, Task, Crew, Process");
      expect(crewPy).toContain("def build_crew()");
      expect(crewPy).toContain("Crew(");
    });

    it("should instantiate all agents", () => {
      const files = toCrewAI(makeTestIR());
      const crewPy = files.find((f) => f.path === "crew.py")!.content;

      expect(crewPy).toContain('chief_officer = Agent(**agents_cfg["chief_officer"])');
      expect(crewPy).toContain('project_manager = Agent(**agents_cfg["project_manager"])');
      expect(crewPy).toContain('developer = Agent(**agents_cfg["developer"])');
    });

    it("should orchestrate all tasks", () => {
      const files = toCrewAI(makeTestIR());
      const crewPy = files.find((f) => f.path === "crew.py")!.content;

      expect(crewPy).toContain('tasks_cfg["direction"]');
      expect(crewPy).toContain('tasks_cfg["planning"]');
      expect(crewPy).toContain('tasks_cfg["execution"]');
    });

    it("should use hierarchical process when teams have parallel strategy", () => {
      const files = toCrewAI(makeTestIR());
      const crewPy = files.find((f) => f.path === "crew.py")!.content;

      expect(crewPy).toContain("Process.hierarchical");
    });

    it("should use sequential process when no parallel teams", () => {
      const ir = makeTestIR();
      ir.teams[0].strategy = "sequential";
      const files = toCrewAI(ir);
      const crewPy = files.find((f) => f.path === "crew.py")!.content;

      expect(crewPy).toContain("Process.sequential");
    });

    it("should include main entry point", () => {
      const files = toCrewAI(makeTestIR());
      const crewPy = files.find((f) => f.path === "crew.py")!.content;

      expect(crewPy).toContain('if __name__ == "__main__":');
      expect(crewPy).toContain("crew.kickoff()");
    });
  });

  describe("requirements.txt (Req 2.4)", () => {
    it("should list crewai dependencies", () => {
      const files = toCrewAI(makeTestIR());
      const reqTxt = files.find((f) => f.path === "requirements.txt")!.content;

      expect(reqTxt).toContain("crewai");
    });
  });

  describe("edge cases", () => {
    it("should handle IR with no agents", () => {
      const ir = makeTestIR();
      ir.agents = [];
      ir.skills = [];
      const files = toCrewAI(ir);
      expect(files).toHaveLength(4);
      const agentsYaml = files.find((f) => f.path === "agents.yaml")!.content;
      // Should be empty or minimal
      expect(agentsYaml.trim()).toBe("");
    });

    it("should handle IR with no stages", () => {
      const ir = makeTestIR();
      ir.pipeline.stages = [];
      const files = toCrewAI(ir);
      expect(files).toHaveLength(4);
      const tasksYaml = files.find((f) => f.path === "tasks.yaml")!.content;
      expect(tasksYaml.trim()).toBe("");
    });

    it("should handle agents with no skills", () => {
      const ir = makeTestIR();
      ir.agents = [ir.agents[1]]; // Project Manager has no skills
      ir.skills = [];
      const files = toCrewAI(ir);
      const agentsYaml = files.find((f) => f.path === "agents.yaml")!.content;
      expect(agentsYaml).toContain("project_manager:");
      // backstory should not contain "Skills:" section
      expect(agentsYaml).not.toContain("Skills:");
    });
  });
});
