import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  generateGuestId,
  isGuestId,
  sanitizeGuestConfig,
} from "../../shared/guest-agent-utils.js";
import type { GuestAgentConfig } from "../../shared/organization-schema.js";

/* ─── Arbitraries ─── */

const guestAgentConfigArb: fc.Arbitrary<GuestAgentConfig> = fc.record({
  model: fc.stringMatching(/^[a-zA-Z0-9]{1,50}$/),
  baseUrl: fc.constant("http://localhost:8080"),
  apiKey: fc.option(fc.stringMatching(/^[0-9a-f]{16,64}$/), {
    nil: undefined,
  }),
  skills: fc.array(
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 30 }),
      description: fc.string({ minLength: 1, maxLength: 100 }),
    }),
    { maxLength: 5 },
  ),
  mcp: fc.constant([] as GuestAgentConfig["mcp"]),
  avatarHint: fc.constantFrom("cat", "dog", "bunny", "tiger", "lion"),
});

/* ─── Feature: agent-marketplace, Property 1: 访客代理创建返回 guest_ 前缀 ID ─── */
/* **Validates: Requirements 1.4, 2.1** */

describe("Feature: agent-marketplace, Property 1: 访客代理创建返回 guest_ 前缀 ID", () => {
  it("generateGuestId always returns an ID starting with 'guest_' followed by 8 hex chars", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const id = generateGuestId();
        expect(id).toMatch(/^guest_[0-9a-f]{8}$/);
        expect(isGuestId(id)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("isGuestId rejects IDs without guest_ prefix", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9a-f]{8}$/),
        (hex) => {
          expect(isGuestId(hex)).toBe(false);
          expect(isGuestId(`agent_${hex}`)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ─── Feature: agent-marketplace, Property 10: GuestAgentConfig 序列化往返一致性 ─── */
/* **Validates: Requirements 7.1, 7.2** */

describe("Feature: agent-marketplace, Property 10: GuestAgentConfig 序列化往返一致性", () => {
  it("JSON.parse(JSON.stringify(config)) produces a deep-equal result", () => {
    fc.assert(
      fc.property(guestAgentConfigArb, (config) => {
        const roundTripped = JSON.parse(JSON.stringify(config));
        expect(roundTripped).toEqual(config);
      }),
      { numRuns: 100 },
    );
  });
});

/* ─── Feature: agent-marketplace, Property 11: API 响应隐藏 apiKey ─── */
/* **Validates: Requirements 7.3** */

describe("Feature: agent-marketplace, Property 11: API 响应隐藏 apiKey", () => {
  it("sanitizeGuestConfig replaces non-empty apiKey with '***'", () => {
    fc.assert(
      fc.property(
        guestAgentConfigArb.filter((c) => c.apiKey != null),
        (config) => {
          const sanitized = sanitizeGuestConfig(config);
          expect(sanitized.apiKey).toBe("***");
          // Original config is not mutated
          expect(config.apiKey).not.toBe("***");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("sanitizeGuestConfig preserves undefined apiKey as undefined", () => {
    fc.assert(
      fc.property(
        guestAgentConfigArb.filter((c) => c.apiKey == null),
        (config) => {
          const sanitized = sanitizeGuestConfig(config);
          expect(sanitized.apiKey).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("sanitizeGuestConfig preserves all other fields", () => {
    fc.assert(
      fc.property(guestAgentConfigArb, (config) => {
        const sanitized = sanitizeGuestConfig(config);
        expect(sanitized.model).toBe(config.model);
        expect(sanitized.baseUrl).toBe(config.baseUrl);
        expect(sanitized.skills).toEqual(config.skills);
        expect(sanitized.mcp).toEqual(config.mcp);
        expect(sanitized.avatarHint).toBe(config.avatarHint);
      }),
      { numRuns: 100 },
    );
  });
});

/* ─── Imports for Task 3 property tests ─── */

import { registry, MAX_GUESTS } from "../../server/core/registry.js";
import {
  GuestAgent,
  buildGuestSoulMd,
  createGuestLLMProvider,
} from "../../server/core/guest-agent.js";
import type {
  GuestAgentNode,
  WorkflowMcpBinding,
} from "../../shared/organization-schema.js";

/* ─── Helpers: build a minimal GuestAgentNode for testing ─── */

function makeGuestOrgNode(
  overrides: Partial<GuestAgentNode> & { guestConfig: GuestAgentConfig },
): GuestAgentNode {
  return {
    id: overrides.id ?? "guest_00000001",
    agentId: overrides.agentId ?? "guest_00000001",
    parentId: overrides.parentId ?? "mgr-eng",
    departmentId: overrides.departmentId ?? "engineering",
    departmentLabel: overrides.departmentLabel ?? "Engineering",
    name: overrides.name ?? "TestGuest",
    title: overrides.title ?? "Guest Worker",
    role: overrides.role ?? "worker",
    responsibility: overrides.responsibility ?? "Assist with tasks",
    responsibilities: overrides.responsibilities ?? ["Assist"],
    goals: overrides.goals ?? ["Complete task"],
    summaryFocus: overrides.summaryFocus ?? [],
    skills: overrides.skills ?? [],
    mcp: overrides.mcp ?? [],
    model: overrides.model ?? { model: "gpt-4", temperature: 0.7, maxTokens: 3000 },
    execution: overrides.execution ?? {
      mode: "execute",
      strategy: "sequential",
      maxConcurrency: 1,
    },
    invitedBy: overrides.invitedBy ?? "ceo",
    source: overrides.source ?? "manual",
    expiresAt: overrides.expiresAt ?? Date.now() + 3600_000,
    guestConfig: overrides.guestConfig,
  };
}

/* ─── GuestAgentNode arbitrary for property tests ─── */

const guestAgentNodeArb = (config: GuestAgentConfig): fc.Arbitrary<GuestAgentNode> =>
  fc.record({
    name: fc.string({ minLength: 1, maxLength: 20 }),
    departmentId: fc.constantFrom("engineering", "design", "research"),
    departmentLabel: fc.constantFrom("Engineering", "Design", "Research"),
    role: fc.constant("worker" as const),
    parentId: fc.constantFrom("mgr-eng", "mgr-design", "mgr-research"),
    invitedBy: fc.constantFrom("ceo", "mgr-eng"),
    source: fc.constantFrom("manual" as const, "feishu" as const, "natural_language" as const),
  }).map((fields) =>
    makeGuestOrgNode({
      ...fields,
      guestConfig: config,
    }),
  );

/* ─── Feature: agent-marketplace, Property 2: register/unregister 往返 ─── */
/* **Validates: Requirements 2.4** */

describe("Feature: agent-marketplace, Property 2: register/unregister 往返", () => {
  beforeEach(() => {
    // Clear guest agents before each test (registry is a singleton)
    for (const g of registry.getGuestAgents()) {
      registry.unregisterGuest(g.config.id);
    }
  });

  it("registered guest is findable via get(id), unregistered guest returns undefined", () => {
    fc.assert(
      fc.property(
        guestAgentConfigArb,
        fc.integer({ min: 0, max: 99999999 }),
        (config, seed) => {
          const id = `guest_${seed.toString(16).padStart(8, "0")}`;
          const orgNode = makeGuestOrgNode({ id, agentId: id, guestConfig: config });
          const agent = new GuestAgent(id, config, orgNode);

          // Register
          registry.registerGuest(id, agent);
          expect(registry.get(id)).toBe(agent);
          expect(registry.isGuest(id)).toBe(true);
          expect(registry.getGuestCount()).toBeGreaterThanOrEqual(1);

          // Unregister
          registry.unregisterGuest(id);
          expect(registry.get(id)).toBeUndefined();
          expect(registry.isGuest(id)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ─── Feature: agent-marketplace, Property 4: 并发上限不变量 ─── */
/* **Validates: Requirements 2.6, 2.7** */

describe("Feature: agent-marketplace, Property 4: 并发上限不变量", () => {
  beforeEach(() => {
    for (const g of registry.getGuestAgents()) {
      registry.unregisterGuest(g.config.id);
    }
  });

  it("guest count never exceeds MAX_GUESTS; 6th registration throws", () => {
    fc.assert(
      fc.property(
        fc.array(guestAgentConfigArb, { minLength: 6, maxLength: 10 }),
        (configs) => {
          // Clean slate
          for (const g of registry.getGuestAgents()) {
            registry.unregisterGuest(g.config.id);
          }

          const registered: string[] = [];

          for (let i = 0; i < configs.length; i++) {
            const id = `guest_${i.toString(16).padStart(8, "0")}`;
            const orgNode = makeGuestOrgNode({ id, agentId: id, guestConfig: configs[i] });
            const agent = new GuestAgent(id, configs[i], orgNode);

            if (i < MAX_GUESTS) {
              // Should succeed
              registry.registerGuest(id, agent);
              registered.push(id);
              expect(registry.getGuestCount()).toBe(i + 1);
              expect(registry.getGuestCount()).toBeLessThanOrEqual(MAX_GUESTS);
            } else {
              // Should throw
              expect(() => registry.registerGuest(id, agent)).toThrow(
                /Maximum guest agent limit reached/,
              );
              // Count must remain at MAX_GUESTS
              expect(registry.getGuestCount()).toBe(MAX_GUESTS);
            }
          }

          // Cleanup
          for (const id of registered) {
            registry.unregisterGuest(id);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ─── Feature: agent-marketplace, Property 9: 访客代理使用独立 LLM 配置 ─── */
/* **Validates: Requirements 6.1** */

describe("Feature: agent-marketplace, Property 9: 访客代理使用独立 LLM 配置", () => {
  it("GuestAgent stores the provided model/baseUrl/apiKey in guestConfig, isolated from system defaults", () => {
    fc.assert(
      fc.property(
        guestAgentConfigArb,
        guestAgentConfigArb,
        (configA, configB) => {
          const idA = "guest_aaaaaaaa";
          const idB = "guest_bbbbbbbb";
          const nodeA = makeGuestOrgNode({ id: idA, agentId: idA, guestConfig: configA });
          const nodeB = makeGuestOrgNode({ id: idB, agentId: idB, guestConfig: configB });

          const agentA = new GuestAgent(idA, configA, nodeA);
          const agentB = new GuestAgent(idB, configB, nodeB);

          // Each agent's guestConfig reflects its own configuration
          expect(agentA.guestConfig.model).toBe(configA.model);
          expect(agentA.guestConfig.baseUrl).toBe(configA.baseUrl);
          expect(agentA.guestConfig.apiKey).toBe(configA.apiKey);

          expect(agentB.guestConfig.model).toBe(configB.model);
          expect(agentB.guestConfig.baseUrl).toBe(configB.baseUrl);
          expect(agentB.guestConfig.apiKey).toBe(configB.apiKey);

          // The two agents are independent — changing one doesn't affect the other
          expect(agentA.guestConfig).not.toBe(agentB.guestConfig);

          // RuntimeAgent config.model reflects the guest config model
          expect(agentA.config.model).toBe(configA.model);
          expect(agentB.config.model).toBe(configB.model);

          // isGuest flag is set
          expect(agentA.config.isGuest).toBe(true);
          expect(agentB.config.isGuest).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("createGuestLLMProvider returns a provider with call and callJson methods", () => {
    fc.assert(
      fc.property(guestAgentConfigArb, (config) => {
        const provider = createGuestLLMProvider(config);
        expect(typeof provider.call).toBe("function");
        expect(typeof provider.callJson).toBe("function");
      }),
      { numRuns: 100 },
    );
  });
});

/* ─── Imports for Task 4 property tests (Lifecycle Manager) ─── */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GuestLifecycleManager } from "../../server/core/guest-lifecycle.js";

const __test_filename = fileURLToPath(import.meta.url);
const __test_dirname = path.dirname(__test_filename);
const AGENT_DATA_ROOT = path.resolve(__test_dirname, "../../data/agents");

/* ─── Feature: agent-marketplace, Property 3: 注销后注册表清空且工作区删除 ─── */
/* **Validates: Requirements 2.3, 2.5** */

describe("Feature: agent-marketplace, Property 3: 注销后注册表清空且工作区删除", () => {
  const lifecycleManager = new GuestLifecycleManager();

  beforeEach(() => {
    // Clear all guest agents before each test
    for (const g of registry.getGuestAgents()) {
      registry.unregisterGuest(g.config.id);
    }
  });

  it("after leaveOffice, agent is not in getGuestAgents() and workspace dir does not exist", async () => {
    await fc.assert(
      fc.asyncProperty(
        guestAgentConfigArb,
        fc.integer({ min: 0, max: 99999999 }),
        async (config, seed) => {
          const id = `guest_${seed.toString(16).padStart(8, "0")}`;
          const orgNode = makeGuestOrgNode({ id, agentId: id, guestConfig: config });
          const agent = new GuestAgent(id, config, orgNode);

          // Register the guest agent
          registry.registerGuest(id, agent);
          expect(registry.isGuest(id)).toBe(true);

          // Create workspace directory to simulate real usage
          const workspacePath = path.join(AGENT_DATA_ROOT, id);
          fs.mkdirSync(workspacePath, { recursive: true });
          expect(fs.existsSync(workspacePath)).toBe(true);

          // Call leaveOffice — should unregister + delete workspace
          await lifecycleManager.leaveOffice(id);

          // Agent should no longer be in the registry
          const guestIds = registry.getGuestAgents().map((g) => g.config.id);
          expect(guestIds).not.toContain(id);
          expect(registry.get(id)).toBeUndefined();
          expect(registry.isGuest(id)).toBe(false);

          // Workspace directory should be deleted
          expect(fs.existsSync(workspacePath)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ─── Feature: agent-marketplace, Property 8: 任务结束自动清理所有访客代理 ─── */
/* **Validates: Requirements 2.5, 5.5** */

describe("Feature: agent-marketplace, Property 8: 任务结束自动清理所有访客代理", () => {
  const lifecycleManager = new GuestLifecycleManager();

  beforeEach(() => {
    for (const g of registry.getGuestAgents()) {
      registry.unregisterGuest(g.config.id);
    }
  });

  it("after onMissionComplete, getGuestAgents() returns empty and all workspaces are deleted", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(guestAgentConfigArb, { minLength: 1, maxLength: MAX_GUESTS }),
        async (configs) => {
          // Clean slate
          for (const g of registry.getGuestAgents()) {
            registry.unregisterGuest(g.config.id);
          }

          const ids: string[] = [];
          const workspacePaths: string[] = [];

          // Register N guest agents and create their workspace directories
          for (let i = 0; i < configs.length; i++) {
            const id = `guest_${i.toString(16).padStart(8, "0")}`;
            const orgNode = makeGuestOrgNode({ id, agentId: id, guestConfig: configs[i] });
            const agent = new GuestAgent(id, configs[i], orgNode);
            registry.registerGuest(id, agent);
            ids.push(id);

            const wp = path.join(AGENT_DATA_ROOT, id);
            fs.mkdirSync(wp, { recursive: true });
            workspacePaths.push(wp);
          }

          expect(registry.getGuestCount()).toBe(configs.length);

          // Trigger mission complete cleanup (must await the async method)
          await lifecycleManager.onMissionComplete("workflow_test_001");

          // All guest agents should be removed
          expect(registry.getGuestAgents()).toEqual([]);
          expect(registry.getGuestCount()).toBe(0);

          // All workspace directories should be deleted
          for (const wp of workspacePaths) {
            expect(fs.existsSync(wp)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ─── Imports for Task 6 property tests (MessageBus guest agent support) ─── */

import {
  validateHierarchy as validateHierarchyRule,
  validateStageRoute,
} from "../../shared/message-bus-rules.js";
import type { AgentRow } from "../../server/db/index.js";

/* ─── Feature: agent-marketplace, Property 6: MessageBus 层级验证支持访客代理 ─── */
/* **Validates: Requirements 5.2** */

describe("Feature: agent-marketplace, Property 6: MessageBus 层级验证支持访客代理", () => {
  beforeEach(() => {
    for (const g of registry.getGuestAgents()) {
      registry.unregisterGuest(g.config.id);
    }
  });

  /**
   * Helper: construct an AgentRow-compatible object for a guest agent,
   * mirroring the logic in MessageBus.assertAgentExists.
   */
  function buildGuestAgentRow(guest: InstanceType<typeof GuestAgent>): AgentRow {
    return {
      id: guest.config.id,
      name: guest.config.name,
      department: guest.config.department ?? "engineering",
      role: (guest.config.role as AgentRow["role"]) ?? "worker",
      manager_id: guest.config.managerId ?? null,
      model: guest.config.model ?? "",
      soul_md: null,
      heartbeat_config: null,
      is_active: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  it("validateHierarchy returns true for guest worker ↔ assigned manager", () => {
    fc.assert(
      fc.property(
        guestAgentConfigArb,
        fc.constantFrom("mgr-eng", "mgr-design", "mgr-research"),
        fc.constantFrom("engineering", "design", "research"),
        (config, managerId, dept) => {
          const id = `guest_${Math.random().toString(16).slice(2, 10)}`;
          const orgNode = makeGuestOrgNode({
            id,
            agentId: id,
            parentId: managerId,
            departmentId: dept,
            guestConfig: config,
          });
          const agent = new GuestAgent(id, config, orgNode);
          const guestRow = buildGuestAgentRow(agent);

          // Simulate the manager as an AgentRow
          const managerRow: AgentRow = {
            id: managerId,
            name: `Manager ${dept}`,
            department: dept,
            role: "manager",
            manager_id: "ceo",
            model: "gpt-4",
            soul_md: null,
            heartbeat_config: null,
            is_active: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          // Manager → Guest (worker) should be valid (isDirectReport: manager→worker)
          expect(validateHierarchyRule(managerRow, guestRow)).toBe(true);
          // Guest (worker) → Manager should also be valid (isDirectReport: to is manager of from)
          expect(validateHierarchyRule(guestRow, managerRow)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("validateStageRoute returns true for guest worker in execution/review/revision stages", () => {
    fc.assert(
      fc.property(
        guestAgentConfigArb,
        fc.constantFrom("mgr-eng", "mgr-design", "mgr-research"),
        fc.constantFrom("engineering", "design", "research"),
        fc.constantFrom("execution" as const, "review" as const, "revision" as const),
        (config, managerId, dept, stage) => {
          const id = `guest_${Math.random().toString(16).slice(2, 10)}`;
          const orgNode = makeGuestOrgNode({
            id,
            agentId: id,
            parentId: managerId,
            departmentId: dept,
            guestConfig: config,
          });
          const agent = new GuestAgent(id, config, orgNode);
          const guestRow = buildGuestAgentRow(agent);

          const managerRow: AgentRow = {
            id: managerId,
            name: `Manager ${dept}`,
            department: dept,
            role: "manager",
            manager_id: "ceo",
            model: "gpt-4",
            soul_md: null,
            heartbeat_config: null,
            is_active: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          // execution/revision: worker → manager (isDirectReport(to=manager, from=worker))
          if (stage === "execution" || stage === "revision") {
            expect(validateStageRoute(guestRow, managerRow, stage)).toBe(true);
          }
          // review: manager → worker (isDirectReport(from=manager, to=worker))
          if (stage === "review") {
            expect(validateStageRoute(managerRow, guestRow, stage)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("guest agent registered in registry is recognized by registry.isGuest and get()", () => {
    fc.assert(
      fc.property(
        guestAgentConfigArb,
        fc.constantFrom("mgr-eng", "mgr-design"),
        (config, managerId) => {
          // Clean slate
          for (const g of registry.getGuestAgents()) {
            registry.unregisterGuest(g.config.id);
          }

          const id = `guest_${Math.random().toString(16).slice(2, 10)}`;
          const orgNode = makeGuestOrgNode({
            id,
            agentId: id,
            parentId: managerId,
            guestConfig: config,
          });
          const agent = new GuestAgent(id, config, orgNode);

          registry.registerGuest(id, agent);

          // The registry should recognize this as a guest
          expect(registry.isGuest(id)).toBe(true);
          const retrieved = registry.get(id);
          expect(retrieved).toBeDefined();
          expect(retrieved!.config.id).toBe(id);
          expect(retrieved!.config.role).toBe("worker");
          expect(retrieved!.config.managerId).toBe(managerId);

          // Cleanup
          registry.unregisterGuest(id);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ─── Imports for Task 7 property tests (Invitation Parser) ─── */

import { parseInvitation } from "../../server/core/guest-invitation-parser.js";
import type { ParsedInvitation } from "../../server/core/guest-invitation-parser.js";

/* ─── Feature: agent-marketplace, Property 5: 自然语言邀请解析 ─── */
/* **Validates: Requirements 3.1** */

describe("Feature: agent-marketplace, Property 5: 自然语言邀请解析", () => {
  /** Arbitrary: valid agent name (alphanumeric + hyphens, 1-20 chars) */
  const agentNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,19}$/);

  /** Arbitrary: Chinese invitation prefix */
  const cnPrefixArb = fc.constantFrom(
    "邀请",
    "请",
    "让",
    "叫",
  );

  /** Arbitrary: Chinese invitation suffix (for patterns that need one) */
  const cnSuffixMap: Record<string, string> = {
    "邀请": "",
    "请": " 加入",
    "让": " 加入",
    "叫": " 来",
  };

  /** Arbitrary: English invitation prefix */
  const enPrefixArb = fc.constantFrom(
    "invite",
    "Invite",
    "bring in",
    "add",
    "call in",
  );

  /** Arbitrary: trailing context text */
  const contextSuffixArb = fc.constantFrom(
    "",
    " 一起分析竞品",
    " 帮忙设计界面",
    " to help with data analysis",
    " to assist with testing",
  );

  it("messages with Chinese invitation pattern + @Name return non-null with matching guestName", () => {
    fc.assert(
      fc.property(
        agentNameArb,
        cnPrefixArb,
        contextSuffixArb,
        (name, prefix, suffix) => {
          const cnSuffix = cnSuffixMap[prefix] ?? "";
          const message = `${prefix} @${name}${cnSuffix}${suffix}`;
          const result = parseInvitation(message);
          expect(result).not.toBeNull();
          expect(result!.guestName).toBe(name);
          expect(result!.context).toBe(message);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("messages with English invitation pattern + @Name return non-null with matching guestName", () => {
    fc.assert(
      fc.property(
        agentNameArb,
        enPrefixArb,
        contextSuffixArb,
        (name, prefix, suffix) => {
          const message = `${prefix} @${name}${suffix}`;
          const result = parseInvitation(message);
          expect(result).not.toBeNull();
          expect(result!.guestName).toBe(name);
          expect(result!.context).toBe(message);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("messages without invitation pattern return null", () => {
    /** Arbitrary: messages that do NOT contain invitation keywords + @Name */
    const nonInvitationArb = fc.constantFrom(
      "Hello, how are you?",
      "请帮我分析一下数据",
      "Let's discuss the project",
      "这个任务需要更多时间",
      "@Someone mentioned this",
      "Can you help me?",
      "我们来讨论一下方案",
      "The meeting is at 3pm",
      "分析报告已经完成",
      "Please review the code",
    );

    fc.assert(
      fc.property(nonInvitationArb, (message) => {
        const result = parseInvitation(message);
        expect(result).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("parseInvitation returns null for empty or non-string input", () => {
    expect(parseInvitation("")).toBeNull();
    expect(parseInvitation(null as unknown as string)).toBeNull();
    expect(parseInvitation(undefined as unknown as string)).toBeNull();
  });

  it("concrete examples from design doc parse correctly", () => {
    const examples: Array<{ message: string; expectedName: string }> = [
      { message: "邀请 @Claude-Researcher 一起分析竞品", expectedName: "Claude-Researcher" },
      { message: "invite @DataAnalyst to help with data analysis", expectedName: "DataAnalyst" },
      { message: "请 @Designer 加入帮忙设计界面", expectedName: "Designer" },
    ];

    for (const { message, expectedName } of examples) {
      const result = parseInvitation(message);
      expect(result).not.toBeNull();
      expect(result!.guestName).toBe(expectedName);
      expect(result!.context).toBe(message);
    }
  });
});


/* ─── Imports for Task 9 property tests (AccessGuard + Memory Isolation) ─── */

import { resolveAgentWorkspacePath } from "../../server/core/access-guard.js";
import { buildGuestPromptContext } from "../../server/core/guest-agent.js";

/* ─── Feature: agent-marketplace, Property 7: AccessGuard 工作区隔离 ─── */
/* **Validates: Requirements 5.3, 5.6** */

describe("Feature: agent-marketplace, Property 7: AccessGuard 工作区隔离", () => {
  /** Arbitrary: guest agent ID with guest_ prefix + 8 hex chars */
  const guestIdArb = fc.stringMatching(/^[0-9a-f]{8}$/).map((hex) => `guest_${hex}`);

  /** Arbitrary: another agent ID (non-guest, simulating a resident agent) */
  const otherAgentIdArb = fc.constantFrom(
    "ceo",
    "mgr-eng",
    "mgr-design",
    "scout",
    "writer",
    "reviewer",
    "guest_ffffffff",
  );

  /** Arbitrary: path segments containing ".." traversal attempts */
  const traversalPathArb = fc.oneof(
    fc.constant("../outside.txt"),
    fc.constant("../../etc/passwd"),
    fc.constant("subdir/../../other_agent/secret.md"),
    fc.constant("../other_agent/SOUL.md"),
    fc.constant("foo/../../../bar.txt"),
    fc.stringMatching(/^[a-z]{1,5}$/).map((s) => `../${s}/secret.txt`),
    fc.stringMatching(/^[a-z]{1,5}$/).map((s) => `${s}/../../leak.md`),
  );

  /** Arbitrary: safe relative path (no traversal) */
  const safeRelativePathArb = fc.oneof(
    fc.constant("notes.md"),
    fc.constant("reports/summary.txt"),
    fc.constant("sessions/workflow_001.jsonl"),
    fc.stringMatching(/^[a-z]{1,8}\.txt$/),
    fc.stringMatching(/^[a-z]{1,5}\/[a-z]{1,8}\.md$/),
  );

  it("resolveAgentWorkspacePath with guest_ ID resolves inside data/agents/guest_xxx/", () => {
    fc.assert(
      fc.property(guestIdArb, safeRelativePathArb, (guestId, relPath) => {
        const resolved = resolveAgentWorkspacePath(guestId, relPath);
        // The resolved path must contain the guest agent's ID as a directory segment
        // ensuring isolation to that agent's workspace
        const normalizedResolved = resolved.replace(/\\/g, "/");
        expect(normalizedResolved).toContain(`/agents/${guestId}/`);
      }),
      { numRuns: 100 },
    );
  });

  it("resolveAgentWorkspacePath throws for any path containing '..' traversal", () => {
    fc.assert(
      fc.property(guestIdArb, traversalPathArb, (guestId, badPath) => {
        expect(() => resolveAgentWorkspacePath(guestId, badPath)).toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it("guest agent cannot resolve paths inside another agent's workspace", () => {
    fc.assert(
      fc.property(
        guestIdArb,
        otherAgentIdArb,
        safeRelativePathArb,
        (guestId, otherId, relPath) => {
          if (guestId === otherId) return; // skip same-agent case

          const guestResolved = resolveAgentWorkspacePath(guestId, relPath);
          const otherResolved = resolveAgentWorkspacePath(otherId, relPath);

          // The two resolved paths must be in different directories
          const guestDir = path.dirname(guestResolved);
          const otherDir = path.dirname(otherResolved);

          // Guest's resolved path must NOT start with the other agent's workspace root
          const otherAgentRoot = otherResolved.substring(
            0,
            otherResolved.indexOf(otherId) + otherId.length,
          );
          expect(guestResolved.startsWith(otherAgentRoot + path.sep)).toBe(false);
          expect(guestResolved).not.toBe(otherAgentRoot);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("guest agent getSoulText returns guest-specific soul, not other agents' SOUL.md", () => {
    fc.assert(
      fc.property(guestAgentConfigArb, (config) => {
        const id = "guest_aabbccdd";
        const orgNode = makeGuestOrgNode({ id, agentId: id, guestConfig: config });
        const agent = new GuestAgent(id, config, orgNode);

        // The agent's soulMd should be the guest-specific soul built from orgNode
        const expectedSoul = buildGuestSoulMd(orgNode);
        expect(agent.config.soulMd).toBe(expectedSoul);
        expect(agent.config.soulMd).toContain("guest agent");
        expect(agent.config.soulMd).toContain(orgNode.name);
      }),
      { numRuns: 100 },
    );
  });

  it("buildGuestPromptContext returns empty array when no workflowId is provided", () => {
    fc.assert(
      fc.property(guestIdArb, (guestId) => {
        const result = buildGuestPromptContext(guestId, undefined);
        expect(result).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});

/* ─── Imports for Task 10 property tests (3D Scene Compatibility) ─── */

import type {
  WorkflowOrganizationSnapshot,
  WorkflowOrganizationDepartment,
} from "../../shared/organization-schema.js";

/* ─── Feature: agent-marketplace, Property 12: GuestAgentNode 与组织快照兼容 ─── */
/* **Validates: Requirements 1.5** */

describe("Feature: agent-marketplace, Property 12: GuestAgentNode 与组织快照兼容", () => {
  /**
   * Pure-function equivalent of createDynamicSceneData's guest detection logic.
   * Since the real function lives in a React component with Three.js dependencies,
   * we extract the core logic: detecting guest nodes and producing scene entries.
   */
  function processSnapshotForGuests(snapshot: WorkflowOrganizationSnapshot) {
    const guestNodes = snapshot.nodes.filter(
      (node) => "guestConfig" in node || node.agentId.startsWith("guest_"),
    );

    const GUEST_POD_POSITIONS: [number, number, number][] = [
      [0, 0, 4.5],
      [-1.5, 0, 4.5],
      [1.5, 0, 4.5],
      [-3, 0, 4.5],
      [3, 0, 4.5],
    ];

    const AVATAR_HINT_MAP: Record<string, string> = {
      cat: "cat", dog: "dog", bunny: "bunny", tiger: "tiger",
      lion: "lion", elephant: "elephant", monkey: "monkey",
      parrot: "parrot", pig: "pig", fish: "fish",
      giraffe: "giraffe", chick: "chick", cow: "cow",
      hog: "hog", caterpillar: "caterpillar",
    };

    const sceneGuests = guestNodes.map((node, index) => {
      const guestConfig = (node as GuestAgentNode).guestConfig;
      const avatarHint = guestConfig?.avatarHint || "cat";
      const animal = AVATAR_HINT_MAP[avatarHint.toLowerCase()] || "cat";
      const position = GUEST_POD_POSITIONS[index % GUEST_POD_POSITIONS.length];

      return {
        id: node.agentId,
        name: node.name,
        animal,
        position,
        isGuest: true,
        department: node.departmentId,
        role: node.role,
      };
    });

    return { sceneGuests, totalNodes: snapshot.nodes.length };
  }

  /** Arbitrary: minimal valid WorkflowOrganizationSnapshot */
  const minimalSnapshotArb = fc.record({
    workflowId: fc.stringMatching(/^wf_[a-z0-9]{8}$/),
    directive: fc.string({ minLength: 1, maxLength: 50 }),
  });

  /** Arbitrary: a department for the snapshot */
  const departmentArb: fc.Arbitrary<WorkflowOrganizationDepartment> = fc.record({
    id: fc.constantFrom("engineering", "design", "research"),
    label: fc.constantFrom("Engineering", "Design", "Research"),
    managerNodeId: fc.constant("mgr-node-1"),
    direction: fc.string({ minLength: 1, maxLength: 30 }),
    strategy: fc.constantFrom("sequential" as const, "parallel" as const),
    maxConcurrency: fc.integer({ min: 1, max: 4 }),
  });

  it("adding a GuestAgentNode to snapshot.nodes is processed without throwing and included in result", () => {
    fc.assert(
      fc.property(
        guestAgentConfigArb,
        minimalSnapshotArb,
        departmentArb,
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom("manual" as const, "feishu" as const, "natural_language" as const),
        (config, snapshotBase, dept, guestName, source) => {
          const guestId = generateGuestId();
          const guestNode = makeGuestOrgNode({
            id: guestId,
            agentId: guestId,
            name: guestName,
            departmentId: dept.id,
            departmentLabel: dept.label,
            parentId: "mgr-node-1",
            source,
            guestConfig: config,
          });

          // Build a minimal valid snapshot with the guest node
          const snapshot: WorkflowOrganizationSnapshot = {
            kind: "workflow_organization",
            version: 1,
            workflowId: snapshotBase.workflowId,
            directive: snapshotBase.directive,
            generatedAt: new Date().toISOString(),
            source: "generated",
            taskProfile: "general",
            reasoning: "test",
            rootNodeId: "root-1",
            rootAgentId: "ceo",
            departments: [dept],
            nodes: [
              // A minimal root node (plain WorkflowOrganizationNode, no guestConfig)
              {
                id: "root-1",
                agentId: "ceo",
                parentId: null,
                departmentId: "meta",
                departmentLabel: "Meta",
                name: "CEO",
                title: "CEO",
                role: "ceo",
                responsibility: "Orchestrate",
                responsibilities: ["Orchestrate"],
                goals: ["Complete"],
                summaryFocus: [],
                skills: [],
                mcp: [],
                model: { model: "gpt-4", temperature: 0.7, maxTokens: 3000 },
                execution: { mode: "orchestrate", strategy: "sequential", maxConcurrency: 1 },
              },
              guestNode,
            ],
          };

          // Should not throw
          const result = processSnapshotForGuests(snapshot);

          // The guest node should be detected and included
          expect(result.sceneGuests.length).toBeGreaterThanOrEqual(1);

          const guestEntry = result.sceneGuests.find((g) => g.id === guestId);
          expect(guestEntry).toBeDefined();
          expect(guestEntry!.isGuest).toBe(true);
          expect(guestEntry!.id).toBe(guestId);
          expect(guestEntry!.id.startsWith("guest_")).toBe(true);
          expect(guestEntry!.name).toBe(guestName);
          expect(guestEntry!.department).toBe(dept.id);
          expect(guestEntry!.role).toBe("worker");

          // Position should be a valid Guest Pod position
          expect(guestEntry!.position).toHaveLength(3);
          expect(guestEntry!.position[1]).toBe(0); // y=0

          // Animal should be resolved from avatarHint
          const validAnimals = [
            "cat", "dog", "bunny", "tiger", "lion", "elephant",
            "monkey", "parrot", "pig", "fish", "giraffe", "chick",
            "cow", "hog", "caterpillar",
          ];
          expect(validAnimals).toContain(guestEntry!.animal);

          // Total nodes includes both root and guest
          expect(result.totalNodes).toBe(2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("multiple GuestAgentNodes get distinct positions in the scene", () => {
    fc.assert(
      fc.property(
        fc.array(guestAgentConfigArb, { minLength: 2, maxLength: 5 }),
        (configs) => {
          const guestNodes = configs.map((config, i) => {
            const id = `guest_${i.toString(16).padStart(8, "0")}`;
            return makeGuestOrgNode({
              id,
              agentId: id,
              name: `Guest${i}`,
              guestConfig: config,
            });
          });

          const snapshot: WorkflowOrganizationSnapshot = {
            kind: "workflow_organization",
            version: 1,
            workflowId: "wf_test0001",
            directive: "test",
            generatedAt: new Date().toISOString(),
            source: "generated",
            taskProfile: "general",
            reasoning: "test",
            rootNodeId: "root-1",
            rootAgentId: "ceo",
            departments: [],
            nodes: [
              // Root node without guestConfig — plain WorkflowOrganizationNode
              {
                id: "root-1",
                agentId: "ceo",
                parentId: null,
                departmentId: "meta",
                departmentLabel: "Meta",
                name: "CEO",
                title: "CEO",
                role: "ceo",
                responsibility: "Orchestrate",
                responsibilities: ["Orchestrate"],
                goals: ["Complete"],
                summaryFocus: [],
                skills: [],
                mcp: [],
                model: { model: "gpt-4", temperature: 0.7, maxTokens: 3000 },
                execution: { mode: "orchestrate", strategy: "sequential", maxConcurrency: 1 },
              },
              ...guestNodes,
            ],
          };

          const result = processSnapshotForGuests(snapshot);

          // All guest nodes should be detected
          expect(result.sceneGuests.length).toBe(configs.length);

          // Each guest should have a valid position
          for (const guest of result.sceneGuests) {
            expect(guest.position).toHaveLength(3);
            expect(guest.isGuest).toBe(true);
          }

          // Positions within the 5-slot limit should be unique
          if (configs.length <= 5) {
            const positionKeys = result.sceneGuests.map(
              (g) => `${g.position[0]},${g.position[2]}`,
            );
            expect(new Set(positionKeys).size).toBe(configs.length);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("GuestAgentNode with unknown avatarHint defaults to 'cat'", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{3,10}$/).filter(
          (s) => !["cat", "dog", "bunny", "tiger", "lion", "elephant",
            "monkey", "parrot", "pig", "fish", "giraffe", "chick",
            "cow", "hog", "caterpillar"].includes(s),
        ),
        (unknownHint) => {
          const config: GuestAgentConfig = {
            model: "gpt-4",
            baseUrl: "http://localhost:8080",
            skills: [],
            mcp: [],
            avatarHint: unknownHint,
          };

          const id = generateGuestId();
          const guestNode = makeGuestOrgNode({
            id,
            agentId: id,
            guestConfig: config,
          });

          const snapshot: WorkflowOrganizationSnapshot = {
            kind: "workflow_organization",
            version: 1,
            workflowId: "wf_test0002",
            directive: "test",
            generatedAt: new Date().toISOString(),
            source: "generated",
            taskProfile: "general",
            reasoning: "test",
            rootNodeId: "root-1",
            rootAgentId: "ceo",
            departments: [],
            nodes: [guestNode],
          };

          const result = processSnapshotForGuests(snapshot);
          expect(result.sceneGuests.length).toBe(1);
          expect(result.sceneGuests[0].animal).toBe("cat");
        },
      ),
      { numRuns: 100 },
    );
  });
});
