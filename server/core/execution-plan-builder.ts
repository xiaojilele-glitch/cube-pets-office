import {
  EXECUTOR_CONTRACT_VERSION,
  type ExecutionJobKind,
  type ExecutionPlan,
  type ExecutionPlanJob,
  type ExecutionPlanStep,
  type ExecutionRunMode,
} from "../../shared/executor/contracts.js";

export interface ExecutionPlanBuildInput {
  missionId: string;
  title?: string;
  sourceText: string;
  requestedBy?: ExecutionPlan["requestedBy"];
  mode?: ExecutionRunMode;
  workspaceRoot?: string;
  topicId?: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutionUnderstanding {
  intent: ExecutionJobKind;
  confidence: number;
  objective: string;
  summary: string;
  evidence: string[];
  suggestedMode: ExecutionRunMode;
}

export interface ExecutionPlanBuildResult {
  understanding: ExecutionUnderstanding;
  plan: ExecutionPlan;
}

const DEFAULT_REQUESTED_BY: ExecutionPlan["requestedBy"] = "brain";
const DEFAULT_MODE: ExecutionRunMode = "auto";

const INTENT_PIPELINES: Record<ExecutionJobKind, ExecutionJobKind[]> = {
  scan: ["scan"],
  analyze: ["scan", "analyze"],
  plan: ["scan", "analyze", "plan"],
  codegen: ["scan", "analyze", "plan", "codegen"],
  execute: ["scan", "analyze", "plan", "execute", "report"],
  report: ["report"],
  custom: ["analyze", "plan", "custom"],
};

const INTENT_RULES: Array<{
  kind: ExecutionJobKind;
  patterns: RegExp[];
  confidence: number;
  suggestedMode?: ExecutionRunMode;
}> = [
  {
    kind: "execute",
    confidence: 0.92,
    suggestedMode: "auto",
    patterns: [
      /\bplaywright\b/i,
      /\brun tests?\b/i,
      /\bexecute\b/i,
      /\bexecution\b/i,
      /\bsmoke\b/i,
    ],
  },
  {
    kind: "codegen",
    confidence: 0.88,
    patterns: [
      /\bcodegen\b/i,
      /\bgenerate\b/i,
      /\bscaffold\b/i,
      /\bcreate tests?\b/i,
    ],
  },
  {
    kind: "report",
    confidence: 0.85,
    patterns: [/\breport\b/i, /\bsummary\b/i, /\bstatus\b/i],
  },
  {
    kind: "plan",
    confidence: 0.82,
    patterns: [/\bplan\b/i, /\bstrategy\b/i, /\broadmap\b/i],
  },
  {
    kind: "analyze",
    confidence: 0.78,
    patterns: [/\banaly[sz]e\b/i, /\breview\b/i, /\binvestigate\b/i],
  },
  {
    kind: "scan",
    confidence: 0.74,
    patterns: [/\bscan\b/i, /\binspect\b/i, /\bgraph\b/i],
  },
];

const JOB_DETAILS: Record<
  ExecutionJobKind,
  {
    label: string;
    description: string;
    acceptanceCriteria: string[];
    timeoutMs: number;
  }
> = {
  scan: {
    label: "Scan workspace",
    description:
      "Inspect repository structure and collect the source context needed by downstream steps.",
    acceptanceCriteria: [
      "Relevant source directories are scanned.",
      "Inputs needed for later execution steps are identified.",
    ],
    timeoutMs: 60_000,
  },
  analyze: {
    label: "Analyze request",
    description:
      "Translate the mission into concrete technical findings, constraints, and risks.",
    acceptanceCriteria: [
      "Core objective is restated clearly.",
      "Blocking assumptions and risks are identified.",
    ],
    timeoutMs: 90_000,
  },
  plan: {
    label: "Build plan",
    description:
      "Produce an execution-ready plan with ordered work and explicit dependencies.",
    acceptanceCriteria: [
      "Execution plan is structured and dependency-aware.",
      "Each follow-up step has a concrete output target.",
    ],
    timeoutMs: 90_000,
  },
  codegen: {
    label: "Generate artifacts",
    description:
      "Create code, scripts, or generated files described by the execution plan.",
    acceptanceCriteria: [
      "Generated artifacts match the mission objective.",
      "Outputs are attributable to a specific execution step.",
    ],
    timeoutMs: 180_000,
  },
  execute: {
    label: "Run execution",
    description:
      "Execute the prepared job flow and collect runtime results from the executor.",
    acceptanceCriteria: [
      "Execution starts with the expected run mode.",
      "Result metrics or failure details are produced.",
    ],
    timeoutMs: 300_000,
  },
  report: {
    label: "Publish report",
    description:
      "Summarize execution results and publish the artifacts needed by the caller.",
    acceptanceCriteria: [
      "A final summary is available.",
      "Result artifacts or report references are attached when possible.",
    ],
    timeoutMs: 60_000,
  },
  custom: {
    label: "Custom action",
    description:
      "Run a mission-specific action that does not fit the standard execution pipeline.",
    acceptanceCriteria: [
      "The custom action is described explicitly in the plan payload.",
      "The output is traceable to the mission objective.",
    ],
    timeoutMs: 120_000,
  },
};

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function summarizeObjective(
  title: string | undefined,
  sourceText: string
): string {
  const fromTitle = normalizeText(title || "");
  if (fromTitle) return fromTitle;

  const fromSource = normalizeText(sourceText).slice(0, 160);
  return fromSource || "Mission request";
}

function classifyExecutionIntent(sourceText: string): ExecutionUnderstanding {
  const evidence = new Set<string>();
  const normalized = normalizeText(sourceText);

  if (!normalized) {
    return {
      intent: "custom",
      confidence: 0.3,
      objective: "Mission request",
      summary:
        "Mission request is empty, so the plan falls back to a custom execution flow.",
      evidence: ["empty request"],
      suggestedMode: DEFAULT_MODE,
    };
  }

  for (const rule of INTENT_RULES) {
    const matched = rule.patterns.filter(pattern => pattern.test(normalized));
    if (matched.length > 0) {
      for (const pattern of matched) {
        evidence.add(pattern.source);
      }
      return {
        intent: rule.kind,
        confidence: rule.confidence,
        objective: normalized.slice(0, 220),
        summary: `Request is classified as ${rule.kind} based on matched intent keywords.`,
        evidence: Array.from(evidence),
        suggestedMode: rule.suggestedMode || DEFAULT_MODE,
      };
    }
  }

  return {
    intent: "custom",
    confidence: 0.45,
    objective: normalized.slice(0, 220),
    summary:
      "Request does not cleanly match a known execution intent, so a custom plan will be used.",
    evidence: ["fallback:custom"],
    suggestedMode: DEFAULT_MODE,
  };
}

function buildPlanSteps(jobKinds: ExecutionJobKind[]): ExecutionPlanStep[] {
  return jobKinds.map((jobKind, index) => {
    const details = JOB_DETAILS[jobKind];
    const previousKind = index > 0 ? jobKinds[index - 1] : undefined;

    return {
      key: jobKind,
      label: details.label,
      description: details.description,
      acceptanceCriteria: details.acceptanceCriteria,
      dependsOn: previousKind ? [previousKind] : undefined,
    };
  });
}

function buildPlanJobs(
  missionId: string,
  jobKinds: ExecutionJobKind[],
  sourceText: string,
  objective: string,
  topicId: string | undefined
): ExecutionPlanJob[] {
  return jobKinds.map((jobKind, index) => {
    const details = JOB_DETAILS[jobKind];
    const previousKind = index > 0 ? jobKinds[index - 1] : undefined;

    return {
      id: `${missionId}:${jobKind}:${index + 1}`,
      key: jobKind,
      label: details.label,
      description: details.description,
      kind: jobKind,
      dependsOn: previousKind ? [previousKind] : undefined,
      timeoutMs: details.timeoutMs,
      payload: {
        missionId,
        sourceText,
        objective,
        topicId,
        stepIndex: index,
      },
    };
  });
}

function buildPlanSummary(
  understanding: ExecutionUnderstanding,
  jobKinds: ExecutionJobKind[]
): string {
  const jobPreview = jobKinds.join(" -> ");
  return `${understanding.summary} Planned flow: ${jobPreview}.`;
}

export class ExecutionPlanBuilder {
  async build(
    input: ExecutionPlanBuildInput
  ): Promise<ExecutionPlanBuildResult> {
    const understanding = classifyExecutionIntent(input.sourceText);
    const objective = summarizeObjective(input.title, input.sourceText);
    const pipeline = INTENT_PIPELINES[understanding.intent];
    const steps = buildPlanSteps(pipeline);
    const jobs = buildPlanJobs(
      input.missionId,
      pipeline,
      input.sourceText,
      objective,
      input.topicId
    );

    const plan: ExecutionPlan = {
      version: EXECUTOR_CONTRACT_VERSION,
      missionId: input.missionId,
      summary: buildPlanSummary(understanding, pipeline),
      objective,
      requestedBy: input.requestedBy || DEFAULT_REQUESTED_BY,
      mode: input.mode || understanding.suggestedMode || DEFAULT_MODE,
      sourceText: input.sourceText,
      workspaceRoot: input.workspaceRoot,
      steps,
      jobs,
      metadata: {
        topicId: input.topicId,
        understanding,
        ...input.metadata,
      },
    };

    return {
      understanding: {
        ...understanding,
        objective,
      },
      plan,
    };
  }
}

export function buildExecutionPlan(
  input: ExecutionPlanBuildInput
): Promise<ExecutionPlanBuildResult> {
  return new ExecutionPlanBuilder().build(input);
}
