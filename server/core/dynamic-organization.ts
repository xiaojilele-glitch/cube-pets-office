import path from "path";

import type {
  LLMMessage,
  LLMProvider,
} from "../../shared/workflow-runtime.js";
import type {
  ExternalAgentNode,
  OrganizationGenerationDebugLog,
  OrganizationGenerationSource,
  WorkflowMcpBinding,
  WorkflowOrganizationNode,
  WorkflowOrganizationSnapshot,
  WorkflowSkillBinding,
} from "../../shared/organization-schema.js";
import type { A2AFrameworkType } from "../../shared/a2a-protocol.js";
import db from "../db/index.js";
import { writeAgentWorkspaceFile } from "./access-guard.js";
import { ensureAgentWorkspaces } from "../memory/workspace.js";
import { registry } from "./registry.js";
import { SkillRegistry } from "./skill-registry.js";
import { RoleStore } from "../permission/role-store.js";
import { PolicyStore } from "../permission/policy-store.js";

type ExecutionMode = WorkflowOrganizationNode["execution"]["mode"];

// Singleton SkillRegistry instance — shared across the module
export const skillRegistry = new SkillRegistry(db);
type ExecutionStrategy = WorkflowOrganizationNode["execution"]["strategy"];

interface McpTemplate {
  id: string;
  name: string;
  server: string;
  description: string;
  connection: WorkflowMcpBinding["connection"];
  tools: string[];
}

interface RoleTemplate {
  id: string;
  name: string;
  title: string;
  role: WorkflowOrganizationNode["role"];
  defaultDepartmentLabel: string;
  responsibility: string;
  responsibilities: string[];
  goals: string[];
  summaryFocus: string[];
  skillIds: string[];
  mcpIds: string[];
  capabilities?: string[];  // e.g. ["vision", "tts", "stt"] (Req 6.3)
  execution: {
    mode: ExecutionMode;
    strategy: ExecutionStrategy;
    maxConcurrency: number;
  };
}

interface PlannerDepartment {
  id: string;
  label: string;
  managerTemplateId: string;
  direction: string;
  workerTemplateIds: string[];
  strategy: ExecutionStrategy;
  maxConcurrency: number;
}

interface PlannerOutput {
  reasoning: string;
  taskProfile: string;
  departments: PlannerDepartment[];
}

const SKILL_LIBRARY: Record<string, WorkflowSkillBinding> = {
  "directive-decomposition": {
    id: "directive-decomposition",
    name: "Directive Decomposition",
    summary: "Break vague requests into concrete deliverables, risks, and ownership.",
    prompt:
      "Translate the incoming request into explicit goals, constraints, assumptions, and review checkpoints before acting.",
  },
  "plan-synthesis": {
    id: "plan-synthesis",
    name: "Plan Synthesis",
    summary: "Convert a direction into execution-ready sub-tasks with clear handoffs.",
    prompt:
      "Write plans as scoped work packets with owners, expected output, and dependency notes.",
  },
  "system-design": {
    id: "system-design",
    name: "System Design",
    summary: "Design service, API, data, and integration changes with tradeoffs.",
    prompt:
      "Favor durable architecture, call out constraints, and explain why each technical path is chosen.",
  },
  "execution-playbook": {
    id: "execution-playbook",
    name: "Execution Playbook",
    summary: "Produce implementation steps that another engineer can follow directly.",
    prompt:
      "Return implementation guidance as ordered steps, acceptance signals, and edge cases to watch.",
  },
  "evidence-review": {
    id: "evidence-review",
    name: "Evidence Review",
    summary: "Ground claims in observable workflow artifacts and task outputs.",
    prompt:
      "Prefer evidence, examples, and concrete references over generic claims or filler language.",
  },
  "quality-audit": {
    id: "quality-audit",
    name: "Quality Audit",
    summary: "Check depth, correctness, coverage, and actionability across outputs.",
    prompt:
      "Audit for weak logic, missing detail, untested assumptions, and unclear next actions.",
  },
  "user-outcome-thinking": {
    id: "user-outcome-thinking",
    name: "User Outcome Thinking",
    summary: "Evaluate work through user value, clarity, and operational impact.",
    prompt:
      "Explain how each recommendation changes outcomes for users, operators, or maintainers.",
  },
  "tooling-integration": {
    id: "tooling-integration",
    name: "Tooling Integration",
    summary: "Reason about skills, tools, MCP connectors, and interface boundaries.",
    prompt:
      "When tools are involved, specify the connector purpose, required inputs, and fallback path when a tool is unavailable.",
  },
};

export const MCP_LIBRARY: Record<string, McpTemplate> = {
  "workspace-files": {
    id: "workspace-files",
    name: "Workspace Files",
    server: "internal.workspace",
    description: "Read and write workflow artifacts in the agent-scoped workspace.",
    connection: {
      transport: "internal",
      endpoint: "workspace://{agentId}",
      notes: "Scoped to the current agent workspace.",
    },
    tools: ["read_file", "write_file", "list_reports"],
  },
  "workflow-memory": {
    id: "workflow-memory",
    name: "Workflow Memory",
    server: "internal.memory",
    description: "Inspect prior workflow memory, messages, and summaries.",
    connection: {
      transport: "internal",
      endpoint: "memory://{agentId}?workflow={workflowId}",
      notes: "Read-mostly connector for replay and memory retrieval.",
    },
    tools: ["recent_memory", "search_memory", "workflow_messages"],
  },
  "report-center": {
    id: "report-center",
    name: "Report Center",
    server: "internal.reports",
    description: "Access department and workflow report outputs for summary or audit.",
    connection: {
      transport: "internal",
      endpoint: "reports://{workflowId}",
    },
    tools: ["department_reports", "final_report", "download_report"],
  },
  "tool-registry": {
    id: "tool-registry",
    name: "Tool Registry",
    server: "internal.registry",
    description: "Review the node's declared skills, MCP tools, and model settings.",
    connection: {
      transport: "internal",
      endpoint: "registry://organization/{workflowId}",
    },
    tools: ["organization_snapshot", "skills_manifest", "mcp_manifest"],
  },
};

const ROLE_LIBRARY: Record<string, RoleTemplate> = {
  executive_orchestrator: {
    id: "executive_orchestrator",
    name: "Mission Control",
    title: "Dynamic Orchestrator",
    role: "ceo",
    defaultDepartmentLabel: "Executive Office",
    responsibility: "Shape the dynamic organization and keep the overall answer coherent.",
    responsibilities: [
      "Clarify the mission and success criteria.",
      "Delegate only the capabilities the task actually needs.",
      "Resolve conflicts across departments and consolidate final guidance.",
    ],
    goals: [
      "Keep the organization minimal but complete.",
      "Avoid over-delegation and redundant parallel work.",
    ],
    summaryFocus: [
      "Organization fit for the request",
      "Cross-team risks",
      "Final integrated answer",
    ],
    skillIds: ["directive-decomposition", "plan-synthesis", "evidence-review"],
    mcpIds: ["workflow-memory", "report-center", "tool-registry"],
    execution: { mode: "orchestrate", strategy: "parallel", maxConcurrency: 3 },
  },
  delivery_lead: {
    id: "delivery_lead",
    name: "Delivery Lead",
    title: "Implementation Manager",
    role: "manager",
    defaultDepartmentLabel: "Delivery",
    responsibility: "Turn the mission into buildable work and coordinate implementation.",
    responsibilities: [
      "Translate the directive into executable technical tasks.",
      "Keep scope, sequencing, and dependencies explicit.",
      "Review implementation outputs for completeness and feasibility.",
    ],
    goals: ["Reach a runnable outcome", "Control delivery risk early"],
    summaryFocus: ["What changed", "Why it works", "Remaining risks"],
    skillIds: ["plan-synthesis", "system-design", "execution-playbook"],
    mcpIds: ["workspace-files", "workflow-memory", "tool-registry"],
    execution: { mode: "plan", strategy: "parallel", maxConcurrency: 3 },
  },
  research_lead: {
    id: "research_lead",
    name: "Research Lead",
    title: "Analysis Manager",
    role: "manager",
    defaultDepartmentLabel: "Research",
    responsibility: "Drive discovery, comparison, and decision support.",
    responsibilities: [
      "Frame the research questions and evidence standards.",
      "Assign specialized analysis tasks with clear output expectations.",
      "Synthesize findings into decision-ready guidance.",
    ],
    goals: ["Improve decision quality", "Make assumptions inspectable"],
    summaryFocus: ["Key findings", "Evidence strength", "Recommended decisions"],
    skillIds: ["directive-decomposition", "plan-synthesis", "evidence-review"],
    mcpIds: ["workflow-memory", "report-center", "tool-registry"],
    execution: { mode: "plan", strategy: "batched", maxConcurrency: 2 },
  },
  growth_lead: {
    id: "growth_lead",
    name: "Growth Lead",
    title: "Outcome Manager",
    role: "manager",
    defaultDepartmentLabel: "Growth",
    responsibility: "Coordinate content, UX, and measurement work around user impact.",
    responsibilities: [
      "Define the audience, user value, and success metrics.",
      "Coordinate strategy, content, and measurement outputs.",
      "Review work for clarity and behavioral impact.",
    ],
    goals: ["Keep the answer useful to users", "Tie recommendations to measurable outcomes"],
    summaryFocus: ["Audience impact", "Messaging clarity", "Measurement plan"],
    skillIds: ["plan-synthesis", "user-outcome-thinking", "evidence-review"],
    mcpIds: ["workflow-memory", "report-center", "tool-registry"],
    execution: { mode: "plan", strategy: "parallel", maxConcurrency: 2 },
  },
  operations_lead: {
    id: "operations_lead",
    name: "Operations Lead",
    title: "Enablement Manager",
    role: "manager",
    defaultDepartmentLabel: "Operations",
    responsibility: "Coordinate rollout, workflow enablement, and operational readiness.",
    responsibilities: [
      "Plan adoption, rollout, and maintenance paths.",
      "Surface operational dependencies and ownership gaps.",
      "Review whether the plan can be executed repeatedly.",
    ],
    goals: ["Reduce rollout risk", "Clarify maintenance responsibilities"],
    summaryFocus: ["Operational readiness", "Dependencies", "Rollout plan"],
    skillIds: ["plan-synthesis", "execution-playbook", "tooling-integration"],
    mcpIds: ["workspace-files", "workflow-memory", "tool-registry"],
    execution: { mode: "plan", strategy: "sequential", maxConcurrency: 1 },
  },
  quality_lead: {
    id: "quality_lead",
    name: "Quality Lead",
    title: "Assurance Manager",
    role: "manager",
    defaultDepartmentLabel: "Quality",
    responsibility: "Audit depth, risks, and unresolved gaps across the organization.",
    responsibilities: [
      "Run cross-team quality and risk review.",
      "Call out missing evidence, shallow reasoning, and weak execution paths.",
      "Recommend concrete revisions before sign-off.",
    ],
    goals: ["Prevent shallow outputs", "Keep final guidance defensible"],
    summaryFocus: ["Quality gaps", "Risk posture", "Revision priorities"],
    skillIds: ["quality-audit", "evidence-review", "tooling-integration"],
    mcpIds: ["workflow-memory", "report-center", "tool-registry"],
    execution: { mode: "audit", strategy: "parallel", maxConcurrency: 2 },
  },
  solution_architect: {
    id: "solution_architect",
    name: "Solution Architect",
    title: "Architecture Worker",
    role: "worker",
    defaultDepartmentLabel: "Delivery",
    responsibility: "Design implementation structure, dependencies, and tradeoffs.",
    responsibilities: [
      "Outline architecture and module boundaries.",
      "Call out critical assumptions and risks.",
    ],
    goals: ["Create a stable technical direction"],
    summaryFocus: ["Architecture choices", "Tradeoffs", "Dependencies"],
    skillIds: ["system-design", "execution-playbook"],
    mcpIds: ["workspace-files", "tool-registry"],
    execution: { mode: "execute", strategy: "sequential", maxConcurrency: 1 },
  },
  implementation_engineer: {
    id: "implementation_engineer",
    name: "Implementation Engineer",
    title: "Execution Worker",
    role: "worker",
    defaultDepartmentLabel: "Delivery",
    responsibility: "Turn scoped tasks into concrete implementation guidance or code changes.",
    responsibilities: [
      "Produce executable implementation detail.",
      "Spell out acceptance criteria and edge cases.",
    ],
    goals: ["Move the task from design to deliverable"],
    summaryFocus: ["Implementation", "Validation", "Known limitations"],
    skillIds: ["execution-playbook", "system-design"],
    mcpIds: ["workspace-files", "workflow-memory"],
    execution: { mode: "execute", strategy: "sequential", maxConcurrency: 1 },
  },
  data_analyst: {
    id: "data_analyst",
    name: "Data Analyst",
    title: "Measurement Worker",
    role: "worker",
    defaultDepartmentLabel: "Research",
    responsibility: "Quantify baselines, metrics, and evidence gaps.",
    responsibilities: [
      "Define what should be measured and why.",
      "Translate goals into metrics and validation checks.",
    ],
    goals: ["Make the outcome measurable"],
    summaryFocus: ["Metrics", "Evidence", "Validation"],
    skillIds: ["evidence-review", "user-outcome-thinking"],
    mcpIds: ["workflow-memory", "report-center"],
    execution: { mode: "execute", strategy: "sequential", maxConcurrency: 1 },
  },
  user_experience_designer: {
    id: "user_experience_designer",
    name: "UX Designer",
    title: "Experience Worker",
    role: "worker",
    defaultDepartmentLabel: "Growth",
    responsibility: "Represent clarity, usability, and user-facing flow quality.",
    responsibilities: [
      "Describe user-facing flow and friction points.",
      "Tie changes to user comprehension and behavior.",
    ],
    goals: ["Keep the output understandable and practical"],
    summaryFocus: ["User flow", "Clarity", "Friction"],
    skillIds: ["user-outcome-thinking", "execution-playbook"],
    mcpIds: ["workflow-memory", "report-center"],
    execution: { mode: "execute", strategy: "sequential", maxConcurrency: 1 },
  },
  content_strategist: {
    id: "content_strategist",
    name: "Content Strategist",
    title: "Communication Worker",
    role: "worker",
    defaultDepartmentLabel: "Growth",
    responsibility: "Produce messaging, framing, and audience-facing artifacts.",
    responsibilities: [
      "Shape content around audience intent.",
      "Keep the output concrete, structured, and reusable.",
    ],
    goals: ["Improve clarity and adoption"],
    summaryFocus: ["Messaging", "Audience fit", "Reusable assets"],
    skillIds: ["user-outcome-thinking", "execution-playbook"],
    mcpIds: ["workspace-files", "report-center"],
    execution: { mode: "execute", strategy: "sequential", maxConcurrency: 1 },
  },
  operations_specialist: {
    id: "operations_specialist",
    name: "Operations Specialist",
    title: "Rollout Worker",
    role: "worker",
    defaultDepartmentLabel: "Operations",
    responsibility: "Translate plans into rollout, support, and enablement steps.",
    responsibilities: [
      "Define rollout sequencing and owner handoffs.",
      "Call out runbook or support requirements.",
    ],
    goals: ["Reduce operational ambiguity"],
    summaryFocus: ["Rollout steps", "Owners", "Support load"],
    skillIds: ["execution-playbook", "tooling-integration"],
    mcpIds: ["workspace-files", "workflow-memory"],
    execution: { mode: "execute", strategy: "sequential", maxConcurrency: 1 },
  },
  prompt_strategist: {
    id: "prompt_strategist",
    name: "Prompt Strategist",
    title: "Prompt Worker",
    role: "worker",
    defaultDepartmentLabel: "Research",
    responsibility: "Design prompt, skill, and role instructions for LLM workflows.",
    responsibilities: [
      "Shape role instructions and prompt scaffolding.",
      "Keep prompt design aligned with the execution chain.",
    ],
    goals: ["Improve prompt clarity and control"],
    summaryFocus: ["Prompt structure", "Role fit", "Control points"],
    skillIds: ["directive-decomposition", "tooling-integration"],
    mcpIds: ["tool-registry", "workflow-memory"],
    execution: { mode: "execute", strategy: "sequential", maxConcurrency: 1 },
  },
  mcp_integration_specialist: {
    id: "mcp_integration_specialist",
    name: "MCP Integration Specialist",
    title: "Connector Worker",
    role: "worker",
    defaultDepartmentLabel: "Operations",
    responsibility: "Specify tool connectors, MCP servers, and integration contracts.",
    responsibilities: [
      "Map each task to the minimum required tool surface.",
      "Describe connection endpoints, required inputs, and fallback behavior.",
    ],
    goals: ["Keep tool setup explicit and minimal"],
    summaryFocus: ["Connector plan", "Dependencies", "Fallbacks"],
    skillIds: ["tooling-integration", "system-design"],
    mcpIds: ["tool-registry", "workspace-files"],
    execution: { mode: "execute", strategy: "sequential", maxConcurrency: 1 },
  },
  market_researcher: {
    id: "market_researcher",
    name: "Market Researcher",
    title: "Insight Worker",
    role: "worker",
    defaultDepartmentLabel: "Research",
    responsibility: "Compare options, references, and contextual signals.",
    responsibilities: [
      "Extract similarities, gaps, and directional implications.",
      "Explain what evidence is missing and how to validate it.",
    ],
    goals: ["Improve situational awareness"],
    summaryFocus: ["Comparisons", "Signals", "Open questions"],
    skillIds: ["evidence-review", "directive-decomposition"],
    mcpIds: ["workflow-memory", "report-center"],
    execution: { mode: "execute", strategy: "sequential", maxConcurrency: 1 },
  },
  quality_reviewer: {
    id: "quality_reviewer",
    name: "Quality Reviewer",
    title: "Review Worker",
    role: "worker",
    defaultDepartmentLabel: "Quality",
    responsibility: "Review depth, correctness, and revision completeness.",
    responsibilities: [
      "Inspect outputs for weak claims and missing implementation detail.",
      "Provide specific revision advice and unresolved items.",
    ],
    goals: ["Raise final answer quality"],
    summaryFocus: ["Defects", "Gaps", "Revision guidance"],
    skillIds: ["quality-audit", "evidence-review"],
    mcpIds: ["workflow-memory", "report-center"],
    execution: { mode: "audit", strategy: "parallel", maxConcurrency: 2 },
  },
  risk_analyst: {
    id: "risk_analyst",
    name: "Risk Analyst",
    title: "Risk Worker",
    role: "worker",
    defaultDepartmentLabel: "Quality",
    responsibility: "Surface dependency, adoption, and execution risks.",
    responsibilities: [
      "Identify hidden failure modes and sequencing risks.",
      "Suggest practical mitigation steps.",
    ],
    goals: ["Reduce avoidable surprises"],
    summaryFocus: ["Risks", "Mitigations", "Escalation points"],
    skillIds: ["quality-audit", "tooling-integration"],
    mcpIds: ["workflow-memory", "report-center"],
    execution: { mode: "audit", strategy: "parallel", maxConcurrency: 2 },
  },
};

function sanitizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function shortWorkflowId(workflowId: string): string {
  return workflowId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10).toLowerCase();
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function inferTaskProfile(directive: string): string {
  const text = directive.toLowerCase();

  // Multimodal keyword detection (Req 6.1)
  const multimodalKeywords = /语音|朗读|图片|截图|看一下|voice|speak|read\s*aloud|image|screenshot|look\s*at/i;
  const hasMultimodal = multimodalKeywords.test(text);

  let profile: string;

  if (/(mcp|skill|prompt|agent|workflow|orchestrat|connector|tool)/i.test(text)) {
    profile = "orchestration";
  } else if (/(code|api|server|frontend|backend|typescript|bug|test|deploy|refactor)/i.test(text)) {
    profile = "engineering";
  } else if (/(research|compare|analysis|analyze|benchmark|study|investigate)/i.test(text)) {
    profile = "research";
  } else if (/(growth|marketing|content|community|campaign|copy|engagement)/i.test(text)) {
    profile = "growth";
  } else if (/(ops|operation|rollout|launch|runbook|support|process)/i.test(text)) {
    profile = "operations";
  } else {
    profile = "general";
  }

  return hasMultimodal ? `${profile}+multimodal` : profile;
}

function buildFallbackPlan(directive: string): PlannerOutput {
  const profile = inferTaskProfile(directive);
  const departments: PlannerDepartment[] = [];

  if (profile === "engineering" || profile === "orchestration") {
    departments.push({
      id: "delivery",
      label: profile === "orchestration" ? "Workflow Delivery" : "Technical Delivery",
      managerTemplateId: "delivery_lead",
      direction:
        "Own the implementation path, keep interfaces explicit, and return an execution-ready result.",
      workerTemplateIds:
        profile === "orchestration"
          ? [
              "solution_architect",
              "implementation_engineer",
              "prompt_strategist",
              "mcp_integration_specialist",
            ]
          : ["solution_architect", "implementation_engineer", "data_analyst"],
      strategy: "parallel",
      maxConcurrency: 3,
    });
  }

  if (profile === "research" || profile === "general") {
    departments.push({
      id: "research",
      label: "Research & Framing",
      managerTemplateId: "research_lead",
      direction:
        "Clarify the problem, compare options, and make the recommendation evidence-oriented.",
      workerTemplateIds: ["market_researcher", "data_analyst", "prompt_strategist"],
      strategy: "batched",
      maxConcurrency: 2,
    });
  }

  if (profile === "growth") {
    departments.push({
      id: "growth",
      label: "Growth & Communication",
      managerTemplateId: "growth_lead",
      direction:
        "Optimize the answer for user understanding, adoption, and measurable impact.",
      workerTemplateIds: ["content_strategist", "user_experience_designer", "data_analyst"],
      strategy: "parallel",
      maxConcurrency: 2,
    });
  }

  if (profile === "operations" || profile === "orchestration") {
    departments.push({
      id: "operations",
      label: "Operations Enablement",
      managerTemplateId: "operations_lead",
      direction:
        "Own rollout, tooling, and maintenance planning so the result can be executed repeatedly.",
      workerTemplateIds: ["operations_specialist", "mcp_integration_specialist"],
      strategy: "sequential",
      maxConcurrency: 1,
    });
  }

  if (departments.length === 0) {
    departments.push({
      id: "delivery",
      label: "Execution",
      managerTemplateId: "delivery_lead",
      direction:
        "Translate the request into clear execution steps and practical implementation guidance.",
      workerTemplateIds: ["implementation_engineer", "user_experience_designer"],
      strategy: "parallel",
      maxConcurrency: 2,
    });
  }

  departments.push({
    id: "quality",
    label: "Quality & Risk",
    managerTemplateId: "quality_lead",
    direction:
      "Audit all outputs for missing depth, hidden risk, and weak execution detail before the final summary.",
    workerTemplateIds: ["quality_reviewer", "risk_analyst"],
    strategy: "parallel",
    maxConcurrency: 2,
  });

  return {
    reasoning:
      "Fallback organization selected from directive heuristics because the dynamic planner was unavailable or returned invalid output.",
    taskProfile: profile,
    departments,
  };
}

function plannerCatalogSummary(): string {
  return Object.values(ROLE_LIBRARY)
    .filter(template => template.role !== "ceo")
    .map(
      template => {
        const capTag = template.capabilities?.length
          ? ` [${template.capabilities.join(", ")}]`
          : "";
        return `- ${template.id} (${template.role}): ${template.title}. ${template.responsibility}${capTag}`;
      }
    )
    .join("\n");
}

function buildPlannerPrompt(workflowId: string, directive: string): string {
  return `You are generating a dynamic organization chart for one workflow.

Workflow ID: ${workflowId}
User directive:
${directive}

Available role templates:
${plannerCatalogSummary()}

Requirements:
- Return valid JSON only.
- Keep the organization lean. Use 2 to 4 departments total.
- Always include exactly one quality-oriented department that uses managerTemplateId "quality_lead".
- Only choose worker templates that materially help the task.
- Each department must have one manager template and 1 to 4 worker templates.
- "id" values should be short lowercase slugs.
- "label" should be readable for humans.
- "direction" should explain what that department owns.
- Choose a realistic execution strategy for each department.

Return this shape:
{
  "reasoning": "why this organization fits the directive",
  "taskProfile": "engineering|research|growth|operations|orchestration|general",
  "departments": [
    {
      "id": "delivery",
      "label": "Technical Delivery",
      "managerTemplateId": "delivery_lead",
      "direction": "department mission",
      "workerTemplateIds": ["solution_architect", "implementation_engineer"],
      "strategy": "parallel",
      "maxConcurrency": 2
    }
  ]
}`;
}

function extractJsonObject(raw: string): unknown {
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1] || raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Planner response did not contain a JSON object.");
  }

  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizePlan(input: unknown): PlannerOutput {
  if (!input || typeof input !== "object") {
    throw new Error("Planner output is empty.");
  }

  const value = input as Record<string, unknown>;
  const departmentsRaw = Array.isArray(value.departments) ? value.departments : [];
  const departments = departmentsRaw.reduce<PlannerDepartment[]>((items, item) => {
      if (!item || typeof item !== "object") return items;
      const row = item as Record<string, unknown>;
      const managerTemplateId =
        typeof row.managerTemplateId === "string" ? row.managerTemplateId : "";
      const managerTemplate = ROLE_LIBRARY[managerTemplateId];
      if (!managerTemplate || managerTemplate.role !== "manager") return items;

      const workerTemplateIds = Array.isArray(row.workerTemplateIds)
        ? row.workerTemplateIds.filter(
            workerId =>
              typeof workerId === "string" &&
              ROLE_LIBRARY[workerId] &&
              ROLE_LIBRARY[workerId].role === "worker"
          )
        : [];

      if (workerTemplateIds.length === 0) return items;

      items.push({
        id:
          typeof row.id === "string" && row.id.trim()
            ? sanitizeId(row.id)
            : sanitizeId(managerTemplate.defaultDepartmentLabel),
        label:
          typeof row.label === "string" && row.label.trim()
            ? row.label.trim()
            : managerTemplate.defaultDepartmentLabel,
        managerTemplateId,
        direction:
          typeof row.direction === "string" && row.direction.trim()
            ? row.direction.trim()
            : managerTemplate.responsibility,
        workerTemplateIds: workerTemplateIds.map(workerId => String(workerId)),
        strategy:
          row.strategy === "parallel" ||
          row.strategy === "sequential" ||
          row.strategy === "batched"
            ? row.strategy
            : managerTemplate.execution.strategy,
        maxConcurrency:
          typeof row.maxConcurrency === "number" && Number.isFinite(row.maxConcurrency)
            ? Math.max(1, Math.min(4, Math.floor(row.maxConcurrency)))
            : managerTemplate.execution.maxConcurrency,
      });

      return items;

      return items;
    }, []);

  if (departments.length === 0) {
    throw new Error("Planner output did not include any valid departments.");
  }

  if (!departments.some(department => department.managerTemplateId === "quality_lead")) {
    departments.push(buildFallbackPlan("").departments.slice(-1)[0]);
  }

  return {
    reasoning:
      typeof value.reasoning === "string" && value.reasoning.trim()
        ? value.reasoning.trim()
        : "Organization generated without additional reasoning.",
    taskProfile:
      typeof value.taskProfile === "string" && value.taskProfile.trim()
        ? value.taskProfile.trim()
        : "general",
    departments,
  };
}

function resolveSkills(skillIds: string[]): WorkflowSkillBinding[] {
  // Try SkillRegistry first; fall back to hardcoded SKILL_LIBRARY for backward compat
  const fromRegistry = skillRegistry.resolveSkills(skillIds);
  if (fromRegistry.length > 0) {
    return fromRegistry.map(b => ({
      id: b.resolvedSkill.id,
      name: b.resolvedSkill.name,
      summary: b.resolvedSkill.summary,
      prompt: b.resolvedSkill.prompt,
    }));
  }
  // Fallback: hardcoded library
  return skillIds
    .map(skillId => SKILL_LIBRARY[skillId])
    .filter((skill): skill is WorkflowSkillBinding => Boolean(skill));
}

export function resolveMcp(
  mcpIds: string[],
  agentId: string,
  workflowId: string
): WorkflowMcpBinding[] {
  return mcpIds
    .map(mcpId => MCP_LIBRARY[mcpId])
    .filter((template): template is McpTemplate => Boolean(template))
    .map(template => ({
      id: template.id,
      name: template.name,
      server: template.server,
      description: template.description,
      connection: {
        ...template.connection,
        endpoint: template.connection.endpoint
          .replaceAll("{agentId}", agentId)
          .replaceAll("{workflowId}", workflowId),
      },
      tools: [...template.tools],
    }));
}

function createNode(
  workflowId: string,
  workflowKey: string,
  nodeId: string,
  parentId: string | null,
  departmentId: string,
  departmentLabel: string,
  templateId: string,
  model: string,
  overrides: Partial<Pick<WorkflowOrganizationNode, "goals" | "summaryFocus">> = {}
): WorkflowOrganizationNode {
  const template = ROLE_LIBRARY[templateId];
  const agentId = `wf-${workflowKey}-${sanitizeId(nodeId)}`;

  return {
    id: nodeId,
    agentId,
    parentId,
    departmentId,
    departmentLabel,
    name: template.name,
    title: template.title,
    role: template.role,
    responsibility: template.responsibility,
    responsibilities: [...template.responsibilities],
    goals: [...(overrides.goals || template.goals)],
    summaryFocus: [...(overrides.summaryFocus || template.summaryFocus)],
    skills: resolveSkills(template.skillIds),
    mcp: resolveMcp(template.mcpIds, agentId, workflowId),
    model: {
      model,
      temperature: template.role === "worker" ? 0.7 : 0.55,
      maxTokens: template.role === "worker" ? 2200 : 1800,
    },
    execution: { ...template.execution },
  };
}

const EXTERNAL_AGENT_PATTERN = /@external-([a-z]+)-([a-z0-9-]+)/gi;

const KNOWN_FRAMEWORKS: Record<string, A2AFrameworkType> = {
  crewai: "crewai",
  langgraph: "langgraph",
  claude: "claude",
};

export function extractExternalAgentReferences(
  directive: string
): { name: string; frameworkType: A2AFrameworkType; endpoint: string }[] {
  const refs: { name: string; frameworkType: A2AFrameworkType; endpoint: string }[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  // Reset lastIndex for global regex
  EXTERNAL_AGENT_PATTERN.lastIndex = 0;
  while ((match = EXTERNAL_AGENT_PATTERN.exec(directive)) !== null) {
    const frameworkPrefix = match[1].toLowerCase();
    const agentName = match[2].toLowerCase();
    const key = `${frameworkPrefix}-${agentName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    refs.push({
      name: agentName,
      frameworkType: KNOWN_FRAMEWORKS[frameworkPrefix] ?? "custom",
      endpoint: "",
    });
  }

  return refs;
}

export function createExternalAgentNode(
  workflowId: string,
  workflowKey: string,
  ref: { name: string; frameworkType: A2AFrameworkType; endpoint: string },
  parentId: string,
  departmentId: string,
  departmentLabel: string
): ExternalAgentNode {
  const nodeId = `external-${sanitizeId(ref.name)}`;
  const agentId = `wf-${workflowKey}-${nodeId}`;

  return {
    id: nodeId,
    agentId,
    parentId,
    departmentId,
    departmentLabel,
    name: ref.name,
    title: `External ${ref.frameworkType} Agent`,
    role: "worker",
    responsibility: `External agent provided via A2A protocol (${ref.frameworkType}).`,
    responsibilities: [],
    goals: [],
    summaryFocus: [],
    skills: [],
    mcp: [],
    model: { model: "external", temperature: 0, maxTokens: 0 },
    execution: { mode: "execute", strategy: "sequential", maxConcurrency: 1 },
    // GuestAgentNode fields
    invitedBy: "system",
    source: "a2a-protocol",
    expiresAt: 0,
    // ExternalAgentNode fields
    frameworkType: ref.frameworkType,
    a2aEndpoint: ref.endpoint,
  };
}

function buildNodeSoul(
  snapshot: WorkflowOrganizationSnapshot,
  node: WorkflowOrganizationNode
): string {
  const parent =
    node.parentId === null
      ? null
      : snapshot.nodes.find(candidate => candidate.id === node.parentId) || null;
  const childNames = snapshot.nodes
    .filter(candidate => candidate.parentId === node.id)
    .map(candidate => `${candidate.name} (${candidate.title})`);

  return `# ${node.name}

## Identity
- Role: ${node.role}
- Title: ${node.title}
- Department: ${node.departmentLabel} (${node.departmentId})
- Primary responsibility: ${node.responsibility}

## Mission
- Workflow directive: ${snapshot.directive}
- Organization reasoning: ${snapshot.reasoning}
- Goals:
${node.goals.map(goal => `- ${goal}`).join("\n")}

## Responsibilities
${node.responsibilities.map(item => `- ${item}`).join("\n")}

## Skills
${node.skills.map(skill => `- ${skill.name}: ${skill.prompt}`).join("\n")}

## MCP
${node.mcp
  .map(
    connector =>
      `- ${connector.name} via ${connector.server}\n  endpoint: ${connector.connection.endpoint}\n  tools: ${connector.tools.join(", ")}`
  )
  .join("\n")}

## Collaboration Rules
- Parent: ${parent ? `${parent.name} (${parent.title})` : "None"}
- Direct reports:
${childNames.length > 0 ? childNames.map(name => `- ${name}`).join("\n") : "- None"}
- Keep output specific, inspectable, and ready for the next node in the chain.
- If evidence is weak, say so directly and propose the safest fallback.
`;
}

function ensureDepartmentIds(departments: PlannerDepartment[]): PlannerDepartment[] {
  const counts = new Map<string, number>();

  return departments.map((department, index) => {
    const baseId = sanitizeId(department.id || department.label || `department-${index + 1}`);
    const current = (counts.get(baseId) || 0) + 1;
    counts.set(baseId, current);

    return {
      ...department,
      id: current === 1 ? baseId : `${baseId}-${current}`,
    };
  });
}

function assembleOrganizationSnapshot(
  workflowId: string,
  directive: string,
  plan: PlannerOutput,
  model: string,
  source: OrganizationGenerationSource
): WorkflowOrganizationSnapshot {
  const workflowKey = shortWorkflowId(workflowId);
  const normalizedDepartments = ensureDepartmentIds(plan.departments);
  const rootNodeId = "root";
  const rootNode = createNode(
    workflowId,
    workflowKey,
    rootNodeId,
    null,
    "executive",
    "Executive Office",
    "executive_orchestrator",
    model
  );

  const nodes: WorkflowOrganizationNode[] = [rootNode];
  const departments = normalizedDepartments.map((department, index) => {
    const managerNodeId = `manager-${index + 1}-${department.id}`;
    const managerTemplate = ROLE_LIBRARY[department.managerTemplateId];
    const managerNode = createNode(
      workflowId,
      workflowKey,
      managerNodeId,
      rootNodeId,
      department.id,
      department.label,
      department.managerTemplateId,
      model,
      {
        goals: unique([department.direction, ...managerTemplate.goals]),
        summaryFocus: unique([...managerTemplate.summaryFocus, department.direction]),
      }
    );

    managerNode.execution.strategy =
      department.strategy || managerTemplate.execution.strategy;
    managerNode.execution.maxConcurrency =
      department.maxConcurrency || managerTemplate.execution.maxConcurrency;
    nodes.push(managerNode);

    department.workerTemplateIds.forEach((workerTemplateId, workerIndex) => {
      nodes.push(
        createNode(
          workflowId,
          workflowKey,
          `worker-${index + 1}-${workerIndex + 1}-${sanitizeId(workerTemplateId)}`,
          managerNodeId,
          department.id,
          department.label,
          workerTemplateId,
          model,
          {
            goals: unique([department.direction, ...ROLE_LIBRARY[workerTemplateId].goals]),
          }
        )
      );
    });

    return {
      id: department.id,
      label: department.label,
      managerNodeId,
      direction: department.direction,
      strategy: managerNode.execution.strategy,
      maxConcurrency: managerNode.execution.maxConcurrency,
    };
  });

  // ── Attach ExternalAgentNodes for @external-xxx references ──────────
  const externalRefs = extractExternalAgentReferences(directive);
  for (const ref of externalRefs) {
    nodes.push(
      createExternalAgentNode(
        workflowId,
        workflowKey,
        ref,
        rootNodeId,
        "executive",
        "Executive Office"
      )
    );
  }

  return {
    kind: "workflow_organization",
    version: 1,
    workflowId,
    directive,
    generatedAt: new Date().toISOString(),
    source,
    taskProfile: plan.taskProfile,
    reasoning: plan.reasoning,
    rootNodeId,
    rootAgentId: rootNode.agentId,
    departments,
    nodes,
  };
}

export async function generateWorkflowOrganization(options: {
  workflowId: string;
  directive: string;
  llmProvider: LLMProvider;
  model: string;
}): Promise<{
  organization: WorkflowOrganizationSnapshot;
  debug: OrganizationGenerationDebugLog;
}> {
  const prompt = buildPlannerPrompt(options.workflowId, options.directive);
  const messages: LLMMessage[] = [
    {
      role: "system",
      content:
        "You design compact multi-agent organizations. Return JSON only and prefer the minimum capable structure.",
    },
    { role: "user", content: prompt },
  ];

  let rawResponse: string | null = null;
  let parsedPlan: unknown = null;
  let source: OrganizationGenerationSource = "generated";
  let fallbackReason: string | null = null;

  try {
    const response = await options.llmProvider.call(messages, {
      model: options.model,
      temperature: 0.35,
      maxTokens: 1800,
    });
    rawResponse = response.content;
    parsedPlan = extractJsonObject(response.content);
  } catch (error) {
    fallbackReason =
      error instanceof Error ? error.message : "Unknown planner failure.";
    source = "fallback";
    parsedPlan = buildFallbackPlan(options.directive);
  }

  let normalizedPlan: PlannerOutput;
  try {
    normalizedPlan = normalizePlan(parsedPlan);
  } catch (error) {
    fallbackReason =
      error instanceof Error ? error.message : "Planner validation failed.";
    source = "fallback";
    normalizedPlan = buildFallbackPlan(options.directive);
    parsedPlan = normalizedPlan;
  }

  const organization = assembleOrganizationSnapshot(
    options.workflowId,
    options.directive,
    normalizedPlan,
    options.model,
    source
  );

  return {
    organization,
    debug: {
      workflowId: options.workflowId,
      directive: options.directive,
      generatedAt: organization.generatedAt,
      source,
      prompt,
      rawResponse,
      parsedPlan,
      fallbackReason,
    },
  };
}

export function materializeWorkflowOrganization(
  organization: WorkflowOrganizationSnapshot
): void {
  ensureAgentWorkspaces(organization.nodes.map(node => node.agentId));

  for (const node of organization.nodes) {
    const parent =
      node.parentId === null
        ? null
        : organization.nodes.find(candidate => candidate.id === node.parentId) || null;

    db.upsertAgent({
      id: node.agentId,
      name: `${node.name} - ${node.title}`,
      department: node.departmentId,
      role: node.role,
      manager_id: parent?.agentId ?? null,
      model: node.model.model,
      soul_md: buildNodeSoul(organization, node),
      heartbeat_config: { enabled: false },
      is_active: 1,
    });
  }

  // ── Permission assignment for each node ──────────────────────────────
  assignOrganizationPermissions(organization);

  if (registry.refreshAll) {
    registry.refreshAll();
  } else {
    organization.nodes.forEach(node => registry.refresh(node.agentId));
  }
}

/**
 * Assign permission policies to all nodes in an organization.
 *
 * - Looks up a permission template by the node's role
 * - CEO gets Admin role added (full access)
 * - Manager gets Writer role added (read + write)
 * - Worker gets base template only (minimal permissions)
 * - Each policy is tagged with organizationId for cleanup
 */
export function assignOrganizationPermissions(
  organization: WorkflowOrganizationSnapshot,
  roleStoreOverride?: RoleStore,
  policyStoreOverride?: PolicyStore,
): void {
  const roleStore = roleStoreOverride ?? new RoleStore(db);
  const policyStore = policyStoreOverride ?? new PolicyStore(db, roleStore);

  for (const node of organization.nodes) {
    // Skip if policy already exists for this agent
    if (policyStore.getPolicy(node.agentId)) continue;

    // Look up permission template by agent role
    const template = roleStore.getTemplateByRole(node.role);
    const assignedRoles: string[] = template ? [template.templateId] : ["reader"];

    // Apply permission inheritance: CEO > Manager > Worker
    if (node.role === "ceo") {
      assignedRoles.push("admin");
    } else if (node.role === "manager") {
      assignedRoles.push("writer");
    }
    // Worker gets base template only (no extra role)

    policyStore.createPolicy({
      agentId: node.agentId,
      assignedRoles,
      customPermissions: [],
      deniedPermissions: [],
      effectiveAt: new Date().toISOString(),
      expiresAt: null,
      templateId: template?.templateId,
      organizationId: organization.workflowId,
    });
  }
}

/**
 * Clean up all permission policies associated with an organization.
 * Called when an organization is deleted / disbanded.
 */
export function deleteOrganizationPermissions(
  organizationId: string,
  policyStoreOverride?: PolicyStore,
): void {
  const roleStore = new RoleStore(db);
  const policyStore = policyStoreOverride ?? new PolicyStore(db, roleStore);
  policyStore.deletePoliciesByOrganization(organizationId);
}


export function persistOrganizationDebugLog(
  organization: WorkflowOrganizationSnapshot,
  debug: OrganizationGenerationDebugLog
): string {
  const absolutePath = writeAgentWorkspaceFile(
    organization.rootAgentId,
    `${organization.workflowId}__organization-debug.json`,
    JSON.stringify({ ...debug, organization }, null, 2),
    "reports"
  );

  return path.relative(process.cwd(), absolutePath).replace(/\\/g, "/");
}
