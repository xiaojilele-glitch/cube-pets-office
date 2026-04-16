/**
 * 审计链 REST API 路由常量
 */

export const AUDIT_API = {
  // 审计事件
  listEvents: "GET    /api/audit/events",
  getEvent: "GET    /api/audit/events/:id",
  searchEvents: "GET    /api/audit/events/search",

  // 审计链验证
  verify: "POST   /api/audit/verify",
  verifyStatus: "GET    /api/audit/verify/status",

  // 统计与导出
  stats: "GET    /api/audit/stats",
  exportLog: "GET    /api/audit/export",

  // 合规报告
  complianceReport: "POST   /api/audit/compliance/report",

  // 异常告警
  listAnomalies: "GET    /api/audit/anomalies",
  updateAnomaly: "PATCH  /api/audit/anomalies/:id",

  // 权限审计
  permissionTrail: "GET    /api/audit/permissions/:agentId",
  permissionViolations: "GET    /api/audit/permissions/violations",

  // 数据血缘
  dataLineage: "GET    /api/audit/lineage/:dataId",

  // 保留策略与归档
  retentionPolicies: "GET    /api/audit/retention/policies",
  retentionArchive: "POST   /api/audit/retention/archive",
} as const;
