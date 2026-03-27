import { describe, expect, it, vi } from "vitest";

import { generateWorkflowOrganization } from "../core/dynamic-organization.js";

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
      directive: "Create a growth campaign to improve activation and retention.",
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
      growth.organization.departments.some(department => department.id === "growth")
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
    expect(result.organization.nodes.some(node => node.role === "manager")).toBe(
      true
    );
    expect(result.organization.nodes.some(node => node.role === "worker")).toBe(
      true
    );
  });
});
