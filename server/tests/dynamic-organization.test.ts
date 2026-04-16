import { describe, expect, it, vi } from "vitest";

import {
  generateWorkflowOrganization,
  extractExternalAgentReferences,
  createExternalAgentNode,
} from "../core/dynamic-organization.js";

describe("dynamic organization generation", () => {
  it("falls back to heuristic departments and keeps skills/MCP bindings", async () => {
    const llmProvider = {
      call: vi.fn().mockRejectedValue(new Error("planner unavailable")),
      callJson: vi.fn(),
    };

    const engineering = await generateWorkflowOrganization({
      workflowId: "wf-engineering",
      directive: "Refactor the TypeScript API server and fix deployment bugs.",
      llmProvider,
      model: "gpt-4.1-mini",
    });

    const growth = await generateWorkflowOrganization({
      workflowId: "wf-growth",
      directive:
        "Create a growth campaign to improve activation and retention.",
      llmProvider,
      model: "gpt-4.1-mini",
    });

    expect(engineering.organization.source).toBe("fallback");
    expect(engineering.debug.source).toBe("fallback");
    expect(engineering.debug.fallbackReason).toContain("planner unavailable");
    expect(engineering.organization.taskProfile).toBe("engineering");
    expect(
      engineering.organization.departments.some(
        department => department.id === "delivery"
      )
    ).toBe(true);
    expect(
      engineering.organization.departments.some(
        department => department.id === "quality"
      )
    ).toBe(true);

    expect(growth.organization.taskProfile).toBe("growth");
    expect(
      growth.organization.departments.some(
        department => department.id === "growth"
      )
    ).toBe(true);

    expect(engineering.organization.rootAgentId).toBeTruthy();
    expect(engineering.organization.nodes.length).toBeGreaterThan(0);
    expect(
      engineering.organization.nodes.every(
        node => Array.isArray(node.skills) && Array.isArray(node.mcp)
      )
    ).toBe(true);
    expect(
      engineering.organization.nodes.some(node => node.skills.length > 0)
    ).toBe(true);
    expect(
      engineering.organization.nodes.some(node => node.mcp.length > 0)
    ).toBe(true);
  });

  it("uses generated plans when the planner returns valid JSON", async () => {
    const llmProvider = {
      call: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          reasoning: "Use a compact delivery and quality structure.",
          taskProfile: "orchestration",
          departments: [
            {
              id: "delivery",
              label: "Workflow Delivery",
              managerTemplateId: "delivery_lead",
              direction: "Own implementation and system wiring.",
              workerTemplateIds: [
                "solution_architect",
                "implementation_engineer",
                "mcp_integration_specialist",
              ],
              strategy: "parallel",
              maxConcurrency: 3,
            },
            {
              id: "quality",
              label: "Quality & Risk",
              managerTemplateId: "quality_lead",
              direction: "Audit the result before final summary.",
              workerTemplateIds: ["quality_reviewer", "risk_analyst"],
              strategy: "parallel",
              maxConcurrency: 2,
            },
          ],
        }),
      }),
      callJson: vi.fn(),
    };

    const result = await generateWorkflowOrganization({
      workflowId: "wf-generated",
      directive: "Build a dynamic organization runtime with MCP support.",
      llmProvider,
      model: "gpt-4.1-mini",
    });

    expect(result.organization.source).toBe("generated");
    expect(result.debug.source).toBe("generated");
    expect(result.organization.departments.map(item => item.id)).toEqual([
      "delivery",
      "quality",
    ]);
    expect(
      result.organization.nodes.some(node => node.role === "manager")
    ).toBe(true);
    expect(result.organization.nodes.some(node => node.role === "worker")).toBe(
      true
    );
  });
});

describe("extractExternalAgentReferences", () => {
  it("extracts known framework references from directive", () => {
    const refs = extractExternalAgentReferences(
      "Use @external-crewai-researcher and @external-langgraph-planner for this task"
    );
    expect(refs).toEqual([
      { name: "researcher", frameworkType: "crewai", endpoint: "" },
      { name: "planner", frameworkType: "langgraph", endpoint: "" },
    ]);
  });

  it("maps unknown framework prefixes to custom", () => {
    const refs = extractExternalAgentReferences("Ask @external-autogen-coder");
    expect(refs).toEqual([
      { name: "coder", frameworkType: "custom", endpoint: "" },
    ]);
  });

  it("maps claude framework correctly", () => {
    const refs = extractExternalAgentReferences(
      "Delegate to @external-claude-analyst"
    );
    expect(refs).toEqual([
      { name: "analyst", frameworkType: "claude", endpoint: "" },
    ]);
  });

  it("deduplicates identical references", () => {
    const refs = extractExternalAgentReferences(
      "@external-crewai-bot and again @external-crewai-bot"
    );
    expect(refs).toHaveLength(1);
  });

  it("returns empty array when no references found", () => {
    const refs = extractExternalAgentReferences("Just a normal directive");
    expect(refs).toEqual([]);
  });
});

describe("createExternalAgentNode", () => {
  it("creates a valid ExternalAgentNode with correct fields", () => {
    const node = createExternalAgentNode(
      "wf-123",
      "wf123",
      {
        name: "researcher",
        frameworkType: "crewai",
        endpoint: "http://localhost:8000",
      },
      "root",
      "executive",
      "Executive Office"
    );

    expect(node.id).toBe("external-researcher");
    expect(node.agentId).toBe("wf-wf123-external-researcher");
    expect(node.parentId).toBe("root");
    expect(node.role).toBe("worker");
    expect(node.frameworkType).toBe("crewai");
    expect(node.a2aEndpoint).toBe("http://localhost:8000");
    expect(node.invitedBy).toBe("system");
    expect(node.source).toBe("a2a-protocol");
    expect(node.expiresAt).toBe(0);
  });
});

describe("assembleOrganizationSnapshot with external agents", () => {
  it("includes ExternalAgentNodes when directive contains @external references", async () => {
    const llmProvider = {
      call: vi.fn().mockRejectedValue(new Error("planner unavailable")),
      callJson: vi.fn(),
    };

    const result = await generateWorkflowOrganization({
      workflowId: "wf-ext-test",
      directive:
        "Research topic using @external-crewai-researcher and @external-claude-writer",
      llmProvider,
      model: "gpt-4.1-mini",
    });

    const externalNodes = result.organization.nodes.filter(
      (n: any) => n.source === "a2a-protocol"
    );
    expect(externalNodes).toHaveLength(2);

    const researcher = externalNodes.find(
      (n: any) => n.name === "researcher"
    ) as any;
    expect(researcher).toBeDefined();
    expect(researcher.frameworkType).toBe("crewai");
    expect(researcher.parentId).toBe("root");

    const writer = externalNodes.find((n: any) => n.name === "writer") as any;
    expect(writer).toBeDefined();
    expect(writer.frameworkType).toBe("claude");
  });
});
