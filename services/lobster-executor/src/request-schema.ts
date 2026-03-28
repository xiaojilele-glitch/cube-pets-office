import { z } from "zod";
import {
  EXECUTION_JOB_KINDS,
  EXECUTION_RUN_MODES,
  EXECUTOR_CONTRACT_VERSION,
} from "../../../shared/executor/contracts.js";
import type {
  ExecutionPlanJob,
  ExecutorJobRequest,
} from "../../../shared/executor/contracts.js";
import { ValidationError } from "./errors.js";

const isoTimestampSchema = z
  .string()
  .min(1)
  .refine(value => !Number.isNaN(Date.parse(value)), "Invalid ISO timestamp");

const executionRunModeSchema = z.enum(EXECUTION_RUN_MODES);
const executionJobKindSchema = z.enum(EXECUTION_JOB_KINDS);

const mockRunnerSchema = z
  .object({
    kind: z.literal("mock").default("mock"),
    outcome: z.enum(["success", "failed"]).default("success"),
    steps: z.number().int().min(1).max(20).default(3),
    delayMs: z.number().int().min(0).max(10_000).default(40),
    logs: z.array(z.string().min(1)).max(50).optional(),
    summary: z.string().min(1).max(2_000).optional(),
  })
  .strict();

const executionPlanJobSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  kind: executionJobKindSchema,
  dependsOn: z.array(z.string().min(1)).optional(),
  timeoutMs: z.number().int().positive().optional(),
  payload: z
    .object({
      runner: mockRunnerSchema.optional(),
    })
    .catchall(z.unknown())
    .optional(),
});

const executionPlanSchema = z.object({
  version: z.literal(EXECUTOR_CONTRACT_VERSION),
  missionId: z.string().min(1),
  summary: z.string().min(1),
  objective: z.string().min(1),
  requestedBy: z.enum(["brain", "user", "feishu", "system"]),
  mode: executionRunModeSchema,
  sourceText: z.string().optional(),
  workspaceRoot: z.string().optional(),
  steps: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      description: z.string().min(1),
      acceptanceCriteria: z.array(z.string().min(1)).optional(),
      dependsOn: z.array(z.string().min(1)).optional(),
    })
  ),
  jobs: z.array(executionPlanJobSchema).min(1),
  artifacts: z
    .array(
      z.object({
        kind: z.enum(["file", "report", "url", "log"]),
        name: z.string().min(1),
        path: z.string().optional(),
        url: z.string().optional(),
        description: z.string().optional(),
      })
    )
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const executorJobRequestSchema = z
  .object({
    version: z.literal(EXECUTOR_CONTRACT_VERSION),
    requestId: z.string().min(1),
    missionId: z.string().min(1),
    jobId: z.string().min(1),
    executor: z.literal("lobster"),
    createdAt: isoTimestampSchema,
    traceId: z.string().optional(),
    idempotencyKey: z.string().optional(),
    plan: executionPlanSchema,
    callback: z.object({
      eventsUrl: z.string().url(),
      timeoutMs: z.number().int().positive().optional(),
      auth: z.object({
        scheme: z.literal("hmac-sha256"),
        executorHeader: z.literal("x-cube-executor-id"),
        timestampHeader: z.literal("x-cube-executor-timestamp"),
        signatureHeader: z.literal("x-cube-executor-signature"),
        signedPayload: z.literal("timestamp.rawBody"),
      }),
    }),
  })
  .superRefine((request, ctx) => {
    if (request.plan.missionId !== request.missionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "request.missionId must match plan.missionId",
        path: ["missionId"],
      });
    }

    if (!request.plan.jobs.some(job => job.id === request.jobId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "request.jobId must exist in plan.jobs",
        path: ["jobId"],
      });
    }
  });

export type MockRunnerConfig = z.infer<typeof mockRunnerSchema>;

export function parseExecutorJobRequest(input: unknown): ExecutorJobRequest {
  const parsed = executorJobRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map(issue => issue.message).join("; ")
    );
  }
  return parsed.data as ExecutorJobRequest;
}

export function getPlanJobById(request: ExecutorJobRequest): ExecutionPlanJob {
  const job = request.plan.jobs.find(item => item.id === request.jobId);
  if (!job) {
    throw new ValidationError(
      `Job ${request.jobId} was not found in request plan`
    );
  }
  return job;
}

export function getMockRunnerConfig(
  planJob: ExecutionPlanJob
): MockRunnerConfig {
  const runner = planJob.payload?.runner ?? {};
  const parsed = mockRunnerSchema.safeParse(runner);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map(issue => issue.message).join("; ")
    );
  }
  return parsed.data;
}
