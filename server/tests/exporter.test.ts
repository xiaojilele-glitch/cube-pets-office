import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";
import type { ExportIR } from "../../shared/export-schema.js";
import type { WorkflowOrganizationSnapshot } from "../../shared/organization-schema.js";

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

const mockOrganization: WorkflowOrganizationSnapshot = {
  kind: "workflow_organization",
  version: 1,
  workflowId: "wf-test",
  directive: "Build a product",
  generatedAt: "2026-04-01T00:00:00.000Z",
  source: "generated",
  taskProfile: "development",
  reasoning: "Test reasoning",
  rootNodeId: "node-ceo",
  rootAgentId: "ceo-1",
  departments: [
    {
      id: "dept-1",
      label: "Engineering",
      managerNodeId: "node-mgr",
      direction: "Build features",
      strategy: "parallel",
      maxConcurrency: 3,
    },
  ],
  nodes: [
    {
      id: "node-ceo",
      agentId: "ceo-1",
      parentId: null,
      departmentId: "dept-1",
      departmentLabel: "Engineering",
      name: "Chief Officer",
      title: "CEO",
      role: "ceo",
      responsibility: "Lead",
      responsibilities: ["Lead"],
      goals: ["Grow"],
      summaryFocus: [],
      skills: [],
      mcp: [],
      model: { model: "gpt-4", temperature: 0.7, maxTokens: 4096 },
      execution: { mode: "orchestrate", strategy: "sequential", maxConcurrency: 1 },
    },
  ],
};

vi.mock("../db/index.js", () => ({
  default: {
    getWorkflow: vi.fn(),
    getTasksByWorkflow: vi.fn(),
  },
}));

import db from "../db/index.js";
import { exportWorkflow } from "../core/exporter.js";

const mockDb = vi.mocked(db);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("exportWorkflow", () => {
  it("throws on invalid framework", async () => {
    await expect(
      exportWorkflow("wf-1", "invalid" as any)
    ).rejects.toThrow("Invalid framework");
  });

  it("throws when workflow not found", async () => {
    mockDb.getWorkflow.mockReturnValue(undefined);
    await expect(exportWorkflow("wf-missing", "crewai")).rejects.toThrow(
      "Workflow not found"
    );
  });

  it("throws when no organization in workflow", async () => {
    mockDb.getWorkflow.mockReturnValue({
      id: "wf-1",
      directive: "test",
      status: "completed",
      current_stage: null,
      departments_involved: [],
      started_at: null,
      completed_at: null,
      results: {},
      created_at: "2026-01-01",
    } as any);
    await expect(exportWorkflow("wf-1", "crewai")).rejects.toThrow(
      "No organization found"
    );
  });

  it("exports single framework with files at root + README", async () => {
    mockDb.getWorkflow.mockReturnValue({
      id: "wf-test",
      directive: "Build a product",
      status: "completed",
      current_stage: null,
      departments_involved: ["dept-1"],
      started_at: null,
      completed_at: null,
      results: { organization: mockOrganization },
      created_at: "2026-01-01",
    } as any);
    mockDb.getTasksByWorkflow.mockReturnValue([]);

    const { buffer, filename } = await exportWorkflow("wf-test", "crewai");

    // Filename format
    expect(filename).toMatch(/^cube-export-crewai-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.zip$/);

    // Unzip and check structure
    const zip = await JSZip.loadAsync(buffer);
    const paths = Object.keys(zip.files);

    // Single framework: files at root, no subdirectory
    expect(paths).toContain("README.md");
    expect(paths).toContain("agents.yaml");
    expect(paths).toContain("tasks.yaml");
    expect(paths).toContain("crew.py");
    expect(paths).toContain("requirements.txt");

    // No subdirectory prefixes
    expect(paths.every((p) => !p.startsWith("crewai/"))).toBe(true);
  });

  it("exports 'all' with framework subdirectories + root README", async () => {
    mockDb.getWorkflow.mockReturnValue({
      id: "wf-test",
      directive: "Build a product",
      status: "completed",
      current_stage: null,
      departments_involved: ["dept-1"],
      started_at: null,
      completed_at: null,
      results: { organization: mockOrganization },
      created_at: "2026-01-01",
    } as any);
    mockDb.getTasksByWorkflow.mockReturnValue([]);

    const { buffer, filename } = await exportWorkflow("wf-test", "all");

    expect(filename).toMatch(/^cube-export-all-/);

    const zip = await JSZip.loadAsync(buffer);
    const paths = Object.keys(zip.files);

    // Root README
    expect(paths).toContain("README.md");

    // Each framework in its own subdirectory
    expect(paths.some((p) => p.startsWith("crewai/"))).toBe(true);
    expect(paths.some((p) => p.startsWith("langgraph/"))).toBe(true);
    expect(paths.some((p) => p.startsWith("autogen/"))).toBe(true);

    // CrewAI files in subdirectory
    expect(paths).toContain("crewai/agents.yaml");
    expect(paths).toContain("crewai/crew.py");

    // LangGraph files in subdirectory
    expect(paths).toContain("langgraph/graph.json");
    expect(paths).toContain("langgraph/main.py");

    // AutoGen files in subdirectory
    expect(paths).toContain("autogen/agents.json");
    expect(paths).toContain("autogen/main.py");
  });

  it("README contains workflow info", async () => {
    mockDb.getWorkflow.mockReturnValue({
      id: "wf-test",
      directive: "Build a product",
      status: "completed",
      current_stage: null,
      departments_involved: ["dept-1"],
      started_at: null,
      completed_at: null,
      results: { organization: mockOrganization },
      created_at: "2026-01-01",
    } as any);
    mockDb.getTasksByWorkflow.mockReturnValue([]);

    const { buffer } = await exportWorkflow("wf-test", "langgraph");
    const zip = await JSZip.loadAsync(buffer);
    const readme = await zip.file("README.md")!.async("string");

    expect(readme).toContain("wf-test");
    expect(readme).toContain("Build a product");
    expect(readme).toContain("LangGraph");
    expect(readme).toContain("Chief Officer");
  });
});
