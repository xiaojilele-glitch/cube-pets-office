import { describe, it, expect } from "vitest";
import { toAutoGen } from "../core/export-adapters/autogen.js";
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

describe("toAutoGen", () => {
  it("should return exactly 4 files", () => {
    const files = toAutoGen(makeTestIR());
    expect(files).toHaveLength(4);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("agents.json");
    expect(paths).toContain("group_chat.json");
    expect(paths).toContain("main.py");
    expect(paths).toContain("requirements.txt");
  });

  describe("agents.json (Req 4.1)", () => {
    it("should contain an entry for every agent with name/system_message/llm_config", () => {
      const files = toAutoGen(makeTestIR());
      const agentsJson = JSON.parse(files.find((f) => f.path === "agents.json")!.content);

      expect(Object.keys(agentsJson)).toHaveLength(3);
      expect(agentsJson).toHaveProperty("chief_officer");
      expect(agentsJson).toHaveProperty("project_manager");
      expect(agentsJson).toHaveProperty("developer");

      // Each agent should have required fields
      for (const key of Object.keys(agentsJson)) {
        expect(agentsJson[key]).toHaveProperty("name");
        expect(agentsJson[key]).toHaveProperty("system_message");
        expect(agentsJson[key]).toHaveProperty("llm_config");
        expect(agentsJson[key].llm_config).toHaveProperty("model");
        expect(agentsJson[key].llm_config).toHaveProperty("temperature");
      }
    });

    it("should build system_message from title, responsibility, and goals", () => {
      const files = toAutoGen(makeTestIR());
      const agentsJson = JSON.parse(files.find((f) => f.path === "agents.json")!.content);

      const ceo = agentsJson.chief_officer;
      expect(ceo.system_message).toContain("Chief Executive Officer");
      expect(ceo.system_message).toContain("Lead the organization");
      expect(ceo.system_message).toContain("Drive growth");
    });

    it("should embed skill prompts in system_message for agents with skills", () => {
      const files = toAutoGen(makeTestIR());
      const agentsJson = JSON.parse(files.find((f) => f.path === "agents.json")!.content);

      // CEO has skill s1
      expect(agentsJson.chief_officer.system_message).toContain(
        "You are a strategic thinker who analyzes problems deeply."
      );
      // Project Manager has no skills
      expect(agentsJson.project_manager.system_message).not.toContain("Skills:");
    });

    it("should set correct model and temperature from IR", () => {
      const files = toAutoGen(makeTestIR());
      const agentsJson = JSON.parse(files.find((f) => f.path === "agents.json")!.content);

      expect(agentsJson.chief_officer.llm_config.model).toBe("gpt-4");
      expect(agentsJson.chief_officer.llm_config.temperature).toBe(0.7);
      expect(agentsJson.developer.llm_config.model).toBe("gpt-3.5-turbo");
      expect(agentsJson.developer.llm_config.temperature).toBe(0.3);
    });

    it("should have json language", () => {
      const files = toAutoGen(makeTestIR());
      const agentsFile = files.find((f) => f.path === "agents.json")!;
      expect(agentsFile.language).toBe("json");
    });
  });

  describe("group_chat.json (Req 4.2)", () => {
    it("should contain a GroupChat entry for each team", () => {
      const files = toAutoGen(makeTestIR());
      const gcJson = JSON.parse(files.find((f) => f.path === "group_chat.json")!.content);

      expect(Object.keys(gcJson)).toHaveLength(1);
      expect(gcJson).toHaveProperty("dev_team");
    });

    it("should list member agent keys in agents array", () => {
      const files = toAutoGen(makeTestIR());
      const gcJson = JSON.parse(files.find((f) => f.path === "group_chat.json")!.content);

      expect(gcJson.dev_team.agents).toContain("project_manager");
      expect(gcJson.dev_team.agents).toContain("developer");
    });

    it("should set max_round based on pipeline stages count", () => {
      const files = toAutoGen(makeTestIR());
      const gcJson = JSON.parse(files.find((f) => f.path === "group_chat.json")!.content);

      // 3 stages in test IR
      expect(gcJson.dev_team.max_round).toBe(3);
    });

    it("should set speaker_selection_method based on team strategy", () => {
      const files = toAutoGen(makeTestIR());
      const gcJson = JSON.parse(files.find((f) => f.path === "group_chat.json")!.content);

      // parallel strategy → "auto"
      expect(gcJson.dev_team.speaker_selection_method).toBe("auto");
    });

    it("should use round_robin for sequential strategy", () => {
      const ir = makeTestIR();
      ir.teams[0].strategy = "sequential";
      const files = toAutoGen(ir);
      const gcJson = JSON.parse(files.find((f) => f.path === "group_chat.json")!.content);

      expect(gcJson.dev_team.speaker_selection_method).toBe("round_robin");
    });

    it("should have json language", () => {
      const files = toAutoGen(makeTestIR());
      const gcFile = files.find((f) => f.path === "group_chat.json")!;
      expect(gcFile.language).toBe("json");
    });
  });

  describe("main.py (Req 4.3)", () => {
    it("should contain autogen imports and main function", () => {
      const files = toAutoGen(makeTestIR());
      const mainPy = files.find((f) => f.path === "main.py")!.content;

      expect(mainPy).toContain("import autogen");
      expect(mainPy).toContain("def main():");
      expect(mainPy).toContain('if __name__ == "__main__":');
    });

    it("should instantiate all agents as AssistantAgent", () => {
      const files = toAutoGen(makeTestIR());
      const mainPy = files.find((f) => f.path === "main.py")!.content;

      expect(mainPy).toContain("chief_officer = autogen.AssistantAgent(");
      expect(mainPy).toContain("project_manager = autogen.AssistantAgent(");
      expect(mainPy).toContain("developer = autogen.AssistantAgent(");
    });

    it("should create GroupChat for each team", () => {
      const files = toAutoGen(makeTestIR());
      const mainPy = files.find((f) => f.path === "main.py")!.content;

      expect(mainPy).toContain("group_chat_dev_team = autogen.GroupChat(");
      expect(mainPy).toContain("manager_dev_team = autogen.GroupChatManager(");
    });

    it("should include UserProxyAgent for conversation initiation", () => {
      const files = toAutoGen(makeTestIR());
      const mainPy = files.find((f) => f.path === "main.py")!.content;

      expect(mainPy).toContain("user_proxy = autogen.UserProxyAgent(");
    });

    it("should initiate chat with the first team manager", () => {
      const files = toAutoGen(makeTestIR());
      const mainPy = files.find((f) => f.path === "main.py")!.content;

      expect(mainPy).toContain("user_proxy.initiate_chat(");
      expect(mainPy).toContain("manager_dev_team");
    });

    it("should have python language", () => {
      const files = toAutoGen(makeTestIR());
      const mainFile = files.find((f) => f.path === "main.py")!;
      expect(mainFile.language).toBe("python");
    });
  });

  describe("requirements.txt (Req 4.4)", () => {
    it("should list pyautogen dependency", () => {
      const files = toAutoGen(makeTestIR());
      const reqTxt = files.find((f) => f.path === "requirements.txt")!.content;

      expect(reqTxt).toContain("pyautogen");
    });
  });

  describe("edge cases", () => {
    it("should handle IR with no agents", () => {
      const ir = makeTestIR();
      ir.agents = [];
      ir.skills = [];
      const files = toAutoGen(ir);
      expect(files).toHaveLength(4);

      const agentsJson = JSON.parse(files.find((f) => f.path === "agents.json")!.content);
      expect(Object.keys(agentsJson)).toHaveLength(0);
    });

    it("should handle IR with no teams", () => {
      const ir = makeTestIR();
      ir.teams = [];
      const files = toAutoGen(ir);
      expect(files).toHaveLength(4);

      const gcJson = JSON.parse(files.find((f) => f.path === "group_chat.json")!.content);
      expect(Object.keys(gcJson)).toHaveLength(0);

      // main.py should fall back to chatting with first agent
      const mainPy = files.find((f) => f.path === "main.py")!.content;
      expect(mainPy).toContain("user_proxy.initiate_chat(");
      expect(mainPy).toContain("chief_officer");
    });

    it("should handle IR with no stages (max_round defaults to 0)", () => {
      const ir = makeTestIR();
      ir.pipeline.stages = [];
      const files = toAutoGen(ir);

      const gcJson = JSON.parse(files.find((f) => f.path === "group_chat.json")!.content);
      expect(gcJson.dev_team.max_round).toBe(0);
    });

    it("should handle agents with no skills", () => {
      const ir = makeTestIR();
      ir.agents = [ir.agents[1]]; // Project Manager has no skills
      ir.skills = [];
      const files = toAutoGen(ir);

      const agentsJson = JSON.parse(files.find((f) => f.path === "agents.json")!.content);
      expect(agentsJson.project_manager.system_message).not.toContain("Skills:");
    });
  });
});
