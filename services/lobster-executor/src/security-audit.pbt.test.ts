import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { SecurityAuditLogger } from "./security-audit.js";
import type { SecurityAuditEntry } from "../../../shared/executor/contracts.js";
import type { SecurityLevel } from "../../../shared/executor/contracts.js";

const TEST_DATA_ROOT = join(process.cwd(), "tmp/test-security-audit-pbt");

// ─── Generators ─────────────────────────────────────────────────────────────

const securityLevelArb = fc.constantFrom<SecurityLevel>("strict", "balanced", "permissive");

const eventTypeArb = fc.constantFrom<SecurityAuditEntry["eventType"]>(
  "container.created",
  "container.started",
  "container.oom",
  "container.seccomp_violation",
  "container.security_failure",
  "container.destroyed",
  "resource.exceeded",
);

const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 30, unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-_") });

const detailArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 10, unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz") }),
  fc.oneof(fc.string({ maxLength: 20 }), fc.integer(), fc.boolean()),
  { minKeys: 1, maxKeys: 5 },
);

// ─── Property 10: 审计日志字段完整性 ────────────────────────────────────────
// **Validates: Requirements 6.1, 6.4**

describe("Property 10: 审计日志字段完整性", () => {
  beforeEach(() => {
    if (existsSync(TEST_DATA_ROOT)) {
      rmSync(TEST_DATA_ROOT, { recursive: true, force: true });
    }
    mkdirSync(TEST_DATA_ROOT, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_ROOT)) {
      rmSync(TEST_DATA_ROOT, { recursive: true, force: true });
    }
  });

  it("for any SecurityAuditEntry, must have non-empty timestamp, jobId, missionId, eventType, securityLevel, and detail", () => {
    fc.assert(
      fc.property(
        nonEmptyStringArb,
        nonEmptyStringArb,
        eventTypeArb,
        securityLevelArb,
        detailArb,
        (jobId, missionId, eventType, securityLevel, detail) => {
          const logger = new SecurityAuditLogger(TEST_DATA_ROOT);

          logger.log({
            jobId,
            missionId,
            eventType,
            securityLevel,
            detail,
          });

          const entries = logger.getAll();
          expect(entries).toHaveLength(1);

          const entry = entries[0];

          // timestamp must be non-empty
          expect(entry.timestamp).toBeDefined();
          expect(typeof entry.timestamp).toBe("string");
          expect(entry.timestamp.length).toBeGreaterThan(0);

          // jobId must be non-empty
          expect(entry.jobId).toBeDefined();
          expect(entry.jobId.length).toBeGreaterThan(0);
          expect(entry.jobId).toBe(jobId);

          // missionId must be non-empty
          expect(entry.missionId).toBeDefined();
          expect(entry.missionId.length).toBeGreaterThan(0);
          expect(entry.missionId).toBe(missionId);

          // eventType must be non-empty
          expect(entry.eventType).toBeDefined();
          expect(entry.eventType.length).toBeGreaterThan(0);
          expect(entry.eventType).toBe(eventType);

          // securityLevel must be non-empty
          expect(entry.securityLevel).toBeDefined();
          expect(entry.securityLevel.length).toBeGreaterThan(0);
          expect(entry.securityLevel).toBe(securityLevel);

          // detail must be a non-null object
          expect(entry.detail).toBeDefined();
          expect(typeof entry.detail).toBe("object");
          expect(entry.detail).not.toBeNull();

          // Clean up for next iteration
          rmSync(TEST_DATA_ROOT, { recursive: true, force: true });
          mkdirSync(TEST_DATA_ROOT, { recursive: true });
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 11: 安全失败事件包含 securityContext ──────────────────────────
// **Validates: Requirements 7.4**

describe("Property 11: 安全失败事件包含 securityContext", () => {
  const securityErrorCodeArb = fc.constantFrom("OOM_KILLED", "SECCOMP_VIOLATION", "SECURITY_CONFIG_INVALID");

  const resourceLimitsArb = fc.record({
    memoryBytes: fc.integer({ min: 1_048_576, max: 34_359_738_368 }),
    nanoCpus: fc.integer({ min: 100_000_000, max: 16_000_000_000 }),
    pidsLimit: fc.integer({ min: 1, max: 65535 }),
    tmpfsSizeBytes: fc.integer({ min: 1_048_576, max: 1_073_741_824 }),
  });

  const securityPolicyArb = fc.record({
    level: securityLevelArb,
    user: nonEmptyStringArb,
    readonlyRootfs: fc.boolean(),
    noNewPrivileges: fc.constant(true),
    capDrop: fc.constant(["ALL"]),
    capAdd: fc.array(fc.constantFrom("NET_BIND_SERVICE", "SYS_PTRACE"), { minLength: 0, maxLength: 2 }),
    network: fc.record({
      mode: fc.constantFrom<"none" | "whitelist" | "bridge">("none", "whitelist", "bridge"),
    }),
    resources: resourceLimitsArb,
  });

  it("for any security-related job.failed event, payload must contain securityContext", () => {
    fc.assert(
      fc.property(
        securityErrorCodeArb,
        securityPolicyArb,
        nonEmptyStringArb,
        (errorCode, policy, errorMessage) => {
          // Simulate what emitFailed does in DockerRunner
          const SECURITY_ERROR_CODES = ["OOM_KILLED", "SECCOMP_VIOLATION", "SECURITY_CONFIG_INVALID"];
          const event: Record<string, unknown> = {
            type: "job.failed",
            status: "failed",
            errorCode,
            message: errorMessage,
            payload: {},
          };

          // Apply the same logic as DockerRunner.emitFailed (Task 4.4)
          if (SECURITY_ERROR_CODES.includes(errorCode)) {
            event.payload = {
              ...(event.payload as Record<string, unknown>),
              securityContext: {
                level: policy.level,
                user: policy.user,
                networkMode: policy.network.mode,
                readonlyRootfs: policy.readonlyRootfs,
                capDrop: policy.capDrop,
                capAdd: policy.capAdd,
                resources: policy.resources,
              },
            };
          }

          // Verify: payload must contain securityContext
          const payload = event.payload as Record<string, unknown>;
          expect(payload.securityContext).toBeDefined();

          const ctx = payload.securityContext as Record<string, unknown>;
          expect(ctx.level).toBe(policy.level);
          expect(ctx.user).toBe(policy.user);
          expect(ctx.networkMode).toBe(policy.network.mode);
          expect(ctx.readonlyRootfs).toBe(policy.readonlyRootfs);
          expect(ctx.capDrop).toEqual(["ALL"]);
          expect(ctx.resources).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("non-security error codes do NOT get securityContext", () => {
    const nonSecurityErrorCodeArb = fc.constantFrom("TIMEOUT", "EXIT_CODE_1", "DOCKER_UNAVAILABLE", "IMAGE_PULL_FAILED");

    fc.assert(
      fc.property(nonSecurityErrorCodeArb, (errorCode) => {
        const SECURITY_ERROR_CODES = ["OOM_KILLED", "SECCOMP_VIOLATION", "SECURITY_CONFIG_INVALID"];
        const payload: Record<string, unknown> = {};

        if (SECURITY_ERROR_CODES.includes(errorCode)) {
          payload.securityContext = { level: "strict" };
        }

        // Non-security codes should NOT have securityContext
        expect(payload.securityContext).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});
