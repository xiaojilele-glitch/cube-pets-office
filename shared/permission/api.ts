/**
 * Agent 权限模型 REST API 路由常量
 */

export const PERMISSION_API = {
  // 角色管理
  listRoles:        "GET    /api/permissions/roles",
  getRole:          "GET    /api/permissions/roles/:roleId",
  createRole:       "POST   /api/permissions/roles",
  updateRole:       "PUT    /api/permissions/roles/:roleId",

  // Agent 权限策略
  getPolicy:        "GET    /api/permissions/policies/:agentId",
  assignPolicy:     "POST   /api/permissions/policies/:agentId",
  updatePolicy:     "PUT    /api/permissions/policies/:agentId",

  // 令牌
  issueToken:       "POST   /api/permissions/tokens/:agentId",
  verifyToken:      "POST   /api/permissions/tokens/verify",

  // 动态权限
  grantTemp:        "POST   /api/permissions/grant-temp",
  revoke:           "POST   /api/permissions/revoke",
  escalate:         "POST   /api/permissions/escalate",

  // 冲突与风险
  detectConflicts:  "GET    /api/permissions/conflicts/:agentId",
  assessRisk:       "GET    /api/permissions/risk/:agentId",

  // 审计
  auditTrail:       "GET    /api/permissions/audit/:agentId",
  usageReport:      "GET    /api/permissions/usage/:agentId",
  violations:       "GET    /api/permissions/violations",
  exportReport:     "GET    /api/permissions/export",

  // 模板
  listTemplates:    "GET    /api/permissions/templates",
  getTemplate:      "GET    /api/permissions/templates/:templateId",
  createTemplate:   "POST   /api/permissions/templates",
} as const;
