/**
 * RoleStore — 角色与模板存储
 *
 * 管理预定义角色（Reader、Writer、Admin、Executor、NetworkCaller）
 * 和权限模板（CodeExecutor、DataAnalyzer、FileProcessor、ApiCaller、DatabaseReader）。
 */
import db from "../db/index.js";
import type {
  AgentRole,
  Permission,
  PermissionTemplate,
} from "../../shared/permission/contracts.js";

type Database = typeof db;

// ─── Builtin Role Definitions ───────────────────────────────────────────────

const BUILTIN_ROLES: Omit<AgentRole, "version" | "createdAt" | "updatedAt">[] =
  [
    {
      roleId: "reader",
      roleName: "Reader",
      description: "Filesystem read-only access within agent workspace",
      permissions: [
        {
          resourceType: "filesystem",
          action: "read",
          constraints: { pathPatterns: ["/sandbox/agent_*/workspace/**"] },
          effect: "allow",
        },
      ],
    },
    {
      roleId: "writer",
      roleName: "Writer",
      description: "Filesystem read and write access within agent workspace",
      permissions: [
        {
          resourceType: "filesystem",
          action: "read",
          constraints: { pathPatterns: ["/sandbox/agent_*/workspace/**"] },
          effect: "allow",
        },
        {
          resourceType: "filesystem",
          action: "write",
          constraints: { pathPatterns: ["/sandbox/agent_*/workspace/**"] },
          effect: "allow",
        },
      ],
    },
    {
      roleId: "admin",
      roleName: "Admin",
      description: "Full access to all resources without constraints",
      permissions: [
        {
          resourceType: "filesystem",
          action: "read",
          constraints: {},
          effect: "allow",
        },
        {
          resourceType: "filesystem",
          action: "write",
          constraints: {},
          effect: "allow",
        },
        {
          resourceType: "filesystem",
          action: "execute",
          constraints: {},
          effect: "allow",
        },
        {
          resourceType: "filesystem",
          action: "delete",
          constraints: {},
          effect: "allow",
        },
        {
          resourceType: "network",
          action: "connect",
          constraints: {},
          effect: "allow",
        },
        {
          resourceType: "network",
          action: "call",
          constraints: {},
          effect: "allow",
        },
        {
          resourceType: "api",
          action: "call",
          constraints: {},
          effect: "allow",
        },
        {
          resourceType: "database",
          action: "select",
          constraints: {},
          effect: "allow",
        },
        {
          resourceType: "database",
          action: "insert",
          constraints: {},
          effect: "allow",
        },
        {
          resourceType: "database",
          action: "update",
          constraints: {},
          effect: "allow",
        },
        {
          resourceType: "database",
          action: "delete",
          constraints: {},
          effect: "allow",
        },
        {
          resourceType: "mcp_tool",
          action: "call",
          constraints: {},
          effect: "allow",
        },
      ],
    },
    {
      roleId: "executor",
      roleName: "Executor",
      description:
        "Filesystem read, write, and execute within agent workspace and /tmp",
      permissions: [
        {
          resourceType: "filesystem",
          action: "read",
          constraints: {
            pathPatterns: ["/sandbox/agent_*/workspace/**", "/tmp/**"],
          },
          effect: "allow",
        },
        {
          resourceType: "filesystem",
          action: "write",
          constraints: {
            pathPatterns: ["/sandbox/agent_*/workspace/**", "/tmp/**"],
          },
          effect: "allow",
        },
        {
          resourceType: "filesystem",
          action: "execute",
          constraints: {
            pathPatterns: ["/sandbox/agent_*/workspace/**", "/tmp/**"],
          },
          effect: "allow",
        },
      ],
    },
    {
      roleId: "network-caller",
      roleName: "NetworkCaller",
      description: "Network connect/http/https with domain whitelist",
      permissions: [
        {
          resourceType: "network",
          action: "connect",
          constraints: {
            domainPatterns: [
              "*.company.com",
              "*.googleapis.com",
              "*.openai.com",
            ],
          },
          effect: "allow",
        },
        {
          resourceType: "network",
          action: "call",
          constraints: {
            domainPatterns: [
              "*.company.com",
              "*.googleapis.com",
              "*.openai.com",
            ],
            methods: ["GET", "POST", "PUT", "DELETE"],
          },
          effect: "allow",
        },
      ],
    },
  ];

// ─── Builtin Template Definitions ───────────────────────────────────────────

const BUILTIN_TEMPLATES: Omit<
  PermissionTemplate,
  "version" | "createdAt" | "updatedAt"
>[] = [
  {
    templateId: "tpl-code-executor",
    templateName: "CodeExecutor",
    description: "Executor role with no network access",
    targetRole: "CodeExecutor",
    permissions: [
      // Executor permissions (read/write/execute in workspace + /tmp)
      {
        resourceType: "filesystem",
        action: "read",
        constraints: {
          pathPatterns: ["/sandbox/agent_*/workspace/**", "/tmp/**"],
        },
        effect: "allow",
      },
      {
        resourceType: "filesystem",
        action: "write",
        constraints: {
          pathPatterns: ["/sandbox/agent_*/workspace/**", "/tmp/**"],
        },
        effect: "allow",
      },
      {
        resourceType: "filesystem",
        action: "execute",
        constraints: {
          pathPatterns: ["/sandbox/agent_*/workspace/**", "/tmp/**"],
        },
        effect: "allow",
      },
      // Explicit deny network
      {
        resourceType: "network",
        action: "connect",
        constraints: {},
        effect: "deny",
      },
      {
        resourceType: "network",
        action: "call",
        constraints: {},
        effect: "deny",
      },
    ],
  },
  {
    templateId: "tpl-data-analyzer",
    templateName: "DataAnalyzer",
    description: "Reader + NetworkCaller with database select",
    targetRole: "DataAnalyzer",
    permissions: [
      // Reader
      {
        resourceType: "filesystem",
        action: "read",
        constraints: { pathPatterns: ["/sandbox/agent_*/workspace/**"] },
        effect: "allow",
      },
      // NetworkCaller
      {
        resourceType: "network",
        action: "connect",
        constraints: {
          domainPatterns: ["*.company.com", "*.googleapis.com", "*.openai.com"],
        },
        effect: "allow",
      },
      {
        resourceType: "network",
        action: "call",
        constraints: {
          domainPatterns: ["*.company.com", "*.googleapis.com", "*.openai.com"],
        },
        effect: "allow",
      },
      // Database select
      {
        resourceType: "database",
        action: "select",
        constraints: { forbiddenOperations: ["DROP", "TRUNCATE", "ALTER"] },
        effect: "allow",
      },
    ],
  },
  {
    templateId: "tpl-file-processor",
    templateName: "FileProcessor",
    description: "Writer role with no network access",
    targetRole: "FileProcessor",
    permissions: [
      // Writer
      {
        resourceType: "filesystem",
        action: "read",
        constraints: { pathPatterns: ["/sandbox/agent_*/workspace/**"] },
        effect: "allow",
      },
      {
        resourceType: "filesystem",
        action: "write",
        constraints: { pathPatterns: ["/sandbox/agent_*/workspace/**"] },
        effect: "allow",
      },
      // Explicit deny network
      {
        resourceType: "network",
        action: "connect",
        constraints: {},
        effect: "deny",
      },
      {
        resourceType: "network",
        action: "call",
        constraints: {},
        effect: "deny",
      },
    ],
  },
  {
    templateId: "tpl-api-caller",
    templateName: "ApiCaller",
    description: "Reader + NetworkCaller with API call permission",
    targetRole: "ApiCaller",
    permissions: [
      // Reader
      {
        resourceType: "filesystem",
        action: "read",
        constraints: { pathPatterns: ["/sandbox/agent_*/workspace/**"] },
        effect: "allow",
      },
      // NetworkCaller
      {
        resourceType: "network",
        action: "connect",
        constraints: {
          domainPatterns: ["*.company.com", "*.googleapis.com", "*.openai.com"],
        },
        effect: "allow",
      },
      {
        resourceType: "network",
        action: "call",
        constraints: {
          domainPatterns: ["*.company.com", "*.googleapis.com", "*.openai.com"],
        },
        effect: "allow",
      },
      // API call
      { resourceType: "api", action: "call", constraints: {}, effect: "allow" },
    ],
  },
  {
    templateId: "tpl-database-reader",
    templateName: "DatabaseReader",
    description: "Reader with database select only, no write",
    targetRole: "DatabaseReader",
    permissions: [
      // Reader
      {
        resourceType: "filesystem",
        action: "read",
        constraints: { pathPatterns: ["/sandbox/agent_*/workspace/**"] },
        effect: "allow",
      },
      // Database select
      {
        resourceType: "database",
        action: "select",
        constraints: { forbiddenOperations: ["DROP", "TRUNCATE", "ALTER"] },
        effect: "allow",
      },
      // Explicit deny database write
      {
        resourceType: "database",
        action: "insert",
        constraints: {},
        effect: "deny",
      },
      {
        resourceType: "database",
        action: "update",
        constraints: {},
        effect: "deny",
      },
      {
        resourceType: "database",
        action: "delete",
        constraints: {},
        effect: "deny",
      },
    ],
  },
];

// ─── RoleStore Class ────────────────────────────────────────────────────────

export class RoleStore {
  constructor(private db: Database) {}

  // ── Role CRUD ──────────────────────────────────────────────────────────

  createRole(
    role: Omit<AgentRole, "version" | "createdAt" | "updatedAt">
  ): AgentRole {
    const roles = this.db.getPermissionRoles();
    if (roles.find(r => r.roleId === role.roleId)) {
      throw new Error(`Role "${role.roleId}" already exists`);
    }
    const now = new Date().toISOString();
    const newRole: AgentRole = {
      ...role,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    roles.push(newRole);
    this.db.setPermissionRoles(roles);
    return newRole;
  }

  getRole(roleId: string): AgentRole | undefined {
    return this.db.getPermissionRoles().find(r => r.roleId === roleId);
  }

  listRoles(): AgentRole[] {
    return this.db.getPermissionRoles();
  }

  updateRole(
    roleId: string,
    updates: Partial<
      Pick<AgentRole, "roleName" | "description" | "permissions">
    >
  ): AgentRole {
    const roles = this.db.getPermissionRoles();
    const idx = roles.findIndex(r => r.roleId === roleId);
    if (idx === -1) {
      throw new Error(`Role "${roleId}" not found`);
    }
    const existing = roles[idx];
    const updated: AgentRole = {
      ...existing,
      ...updates,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };
    roles[idx] = updated;
    this.db.setPermissionRoles(roles);
    return updated;
  }

  // ── Builtin Roles ─────────────────────────────────────────────────────

  initBuiltinRoles(): void {
    const existing = this.db.getPermissionRoles();
    const existingIds = new Set(existing.map(r => r.roleId));
    const now = new Date().toISOString();
    let changed = false;

    for (const def of BUILTIN_ROLES) {
      if (!existingIds.has(def.roleId)) {
        existing.push({
          ...def,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        changed = true;
      }
    }

    if (changed) {
      this.db.setPermissionRoles(existing);
    }
  }

  // ── Template CRUD ─────────────────────────────────────────────────────

  createTemplate(
    template: Omit<PermissionTemplate, "version" | "createdAt" | "updatedAt">
  ): PermissionTemplate {
    const templates = this.db.getPermissionTemplates();
    if (templates.find(t => t.templateId === template.templateId)) {
      throw new Error(`Template "${template.templateId}" already exists`);
    }
    const now = new Date().toISOString();
    const newTemplate: PermissionTemplate = {
      ...template,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    templates.push(newTemplate);
    this.db.setPermissionTemplates(templates);
    return newTemplate;
  }

  getTemplate(templateId: string): PermissionTemplate | undefined {
    return this.db
      .getPermissionTemplates()
      .find(t => t.templateId === templateId);
  }

  listTemplates(): PermissionTemplate[] {
    return this.db.getPermissionTemplates();
  }

  getTemplateByRole(targetRole: string): PermissionTemplate | undefined {
    return this.db
      .getPermissionTemplates()
      .find(t => t.targetRole === targetRole);
  }

  // ── Builtin Templates ─────────────────────────────────────────────────

  initBuiltinTemplates(): void {
    const existing = this.db.getPermissionTemplates();
    const existingIds = new Set(existing.map(t => t.templateId));
    const now = new Date().toISOString();
    let changed = false;

    for (const def of BUILTIN_TEMPLATES) {
      if (!existingIds.has(def.templateId)) {
        existing.push({
          ...def,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        changed = true;
      }
    }

    if (changed) {
      this.db.setPermissionTemplates(existing);
    }
  }
}

// ── Exported constants for testing ──────────────────────────────────────────

export { BUILTIN_ROLES, BUILTIN_TEMPLATES };
