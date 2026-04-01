# 实施任务

## 任务列表

- [ ] 1. 权限类型定义与共享契约
  - [ ] 1.1 创建 `shared/permission/contracts.ts`，定义 ResourceType、Action、RiskLevel、PermissionConstraints、PortRange、RateLimitConfig、Permission、AgentRole、AgentPermissionPolicy、CapabilityTokenPayload、PermissionMatrixEntry、CapabilityToken、PermissionCheckResult、PermissionAuditEntry、PermissionTemplate、RiskAssessment、RiskFactor、PermissionConflict、PermissionUsageReport 类型
  - [ ] 1.2 创建 `shared/permission/api.ts`，定义 PERMISSION_API 路由常量
  - [ ] 1.3 创建 `shared/permission/index.ts`，统一导出

- [ ] 2. 角色与模板存储
  - [ ] 2.1 在 `server/db/index.ts` 中扩展 DatabaseSchema，新增 permission_roles、permission_policies、permission_templates、permission_audit、permission_escalations 表
  - [ ] 2.2 创建 `server/permission/role-store.ts`，实现 RoleStore 类（createRole、getRole、listRoles、updateRole、initBuiltinRoles）
  - [ ] 2.3 在 RoleStore 中实现 initBuiltinRoles()，初始化 Reader、Writer、Admin、Executor、NetworkCaller 五个预定义角色
  - [ ] 2.4 在 RoleStore 中实现模板 CRUD（createTemplate、getTemplate、listTemplates、getTemplateByRole）
  - [ ] 2.5 初始化预定义权限模板：CodeExecutor、DataAnalyzer、FileProcessor、ApiCaller、DatabaseReader
  - [ ] 2.6 编写 `server/permission/role-store.test.ts` 单元测试

- [ ] 3. Agent 权限策略存储
  - [ ] 3.1 创建 `server/permission/policy-store.ts`，实现 PolicyStore 类（getPolicy、createPolicy、updatePolicy、deletePolicy、deletePoliciesByOrganization）
  - [ ] 3.2 实现 resolveEffectivePermissions(agentId)，按优先级合并角色权限、自定义权限、拒绝权限
  - [ ] 3.3 实现策略版本控制（getPolicyHistory、rollbackPolicy）
  - [ ] 3.4 编写 `server/permission/policy-store.test.ts` 单元测试
  - [ ] 3.5 编写属性测试 Property 1: 权限解析优先级正确性

- [ ] 4. CapabilityToken 服务
  - [ ] 4.1 创建 `server/permission/token-service.ts`，实现 TokenService 类（issueToken、verifyToken、refreshToken）
  - [ ] 4.2 实现 buildPermissionMatrix()，将有效权限转换为权限矩阵
  - [ ] 4.3 实现 JWT 签名和验证（使用 jsonwebtoken 库或轻量级 HMAC-SHA256 实现）
  - [ ] 4.4 编写 `server/permission/token-service.test.ts` 单元测试
  - [ ] 4.5 编写属性测试 Property 2: JWT 令牌签名完整性
  - [ ] 4.6 编写属性测试 Property 3: 令牌过期时间正确性

- [ ] 5. 资源权限检查器
  - [ ] 5.1 创建 `server/permission/checkers/filesystem-checker.ts`，实现文件系统权限检查（路径模式匹配、敏感目录黑名单、沙箱路径隔离）
  - [ ] 5.2 创建 `server/permission/checkers/network-checker.ts`，实现网络权限检查（域名白名单、CIDR 范围、端口范围、私有 IP 拒绝、速率限制）
  - [ ] 5.3 创建 `server/permission/checkers/api-checker.ts`，实现 API 权限检查（端点路径模式、HTTP 方法、参数约束）
  - [ ] 5.4 创建 `server/permission/checkers/database-checker.ts`，实现数据库权限检查（表名匹配、危险操作拒绝、结果集限制）
  - [ ] 5.5 创建 `server/permission/checkers/mcp-checker.ts`，实现 MCP 工具权限检查（工具 ID 白名单、操作白名单、参数约束）
  - [ ] 5.6 编写 `server/permission/checkers/filesystem-checker.test.ts` 单元测试
  - [ ] 5.7 编写 `server/permission/checkers/network-checker.test.ts` 单元测试
  - [ ] 5.8 编写 `server/permission/checkers/api-checker.test.ts` 单元测试
  - [ ] 5.9 编写 `server/permission/checkers/database-checker.test.ts` 单元测试
  - [ ] 5.10 编写属性测试 Property 5: 文件系统路径模式匹配正确性
  - [ ] 5.11 编写属性测试 Property 6: 敏感目录始终拒绝
  - [ ] 5.12 编写属性测试 Property 7: 私有 IP 段默认拒绝
  - [ ] 5.13 编写属性测试 Property 8: 端口范围匹配正确性
  - [ ] 5.14 编写属性测试 Property 9: 危险 SQL 操作始终拒绝

- [ ] 6. 运行时权限检查引擎
  - [ ] 6.1 创建 `server/permission/check-engine.ts`，实现 PermissionCheckEngine 类（checkPermission、checkPermissions、invalidateCache）
  - [ ] 6.2 实现 LRU 缓存层（容量 10000，TTL 60s）
  - [ ] 6.3 实现完整检查流程：JWT 验证 → 权限矩阵提取 → 缓存查找 → deny 优先匹配 → allow 匹配 → 约束检查 → 审计记录
  - [ ] 6.4 编写 `server/permission/check-engine.test.ts` 单元测试
  - [ ] 6.5 编写属性测试 Property 4: 权限检查引擎 deny 优先

- [ ] 7. 动态权限管理
  - [ ] 7.1 创建 `server/permission/dynamic-manager.ts`，实现 DynamicPermissionManager 类（grantTemporaryPermission、revokePermission、escalatePermission）
  - [ ] 7.2 实现临时权限过期清理逻辑（cleanupExpiredPermissions）
  - [ ] 7.3 实现权限变更后的令牌刷新通知
  - [ ] 7.4 编写 `server/permission/dynamic-manager.test.ts` 单元测试
  - [ ] 7.5 编写属性测试 Property 10: 临时权限自动过期

- [ ] 8. 冲突检测与风险评估
  - [ ] 8.1 创建 `server/permission/conflict-detector.ts`，实现 ConflictDetector 类（detectConflicts、assessRisk）
  - [ ] 8.2 实现冲突检测规则：allow_deny_overlap、excessive_scope、dangerous_combination
  - [ ] 8.3 实现风险评分矩阵（权限范围、网络访问、数据库操作、MCP 工具）
  - [ ] 8.4 编写 `server/permission/conflict-detector.test.ts` 单元测试
  - [ ] 8.5 编写属性测试 Property 13: 冲突检测覆盖性

- [ ] 9. 审计日志
  - [ ] 9.1 创建 `server/permission/audit-logger.ts`，实现 AuditLogger 类（log、getAuditTrail、getUsageReport、getViolations、exportReport）
  - [ ] 9.2 实现权限使用统计聚合（按资源类型分组的 allowed/denied 计数）
  - [ ] 9.3 编写 `server/permission/audit-logger.test.ts` 单元测试
  - [ ] 9.4 编写属性测试 Property 11: 权限变更审计完整性

- [ ] 10. REST API 路由
  - [ ] 10.1 创建 `server/routes/permissions.ts`，实现角色管理路由（GET/POST/PUT /api/permissions/roles）
  - [ ] 10.2 实现 Agent 权限策略路由（GET/POST/PUT /api/permissions/policies/:agentId）
  - [ ] 10.3 实现令牌路由（POST /api/permissions/tokens/:agentId、POST /api/permissions/tokens/verify）
  - [ ] 10.4 实现动态权限路由（POST grant-temp、revoke、escalate）
  - [ ] 10.5 实现冲突与风险路由（GET conflicts/:agentId、risk/:agentId）
  - [ ] 10.6 实现审计路由（GET audit/:agentId、usage/:agentId、violations、export）
  - [ ] 10.7 实现模板路由（GET/POST /api/permissions/templates）
  - [ ] 10.8 在 `server/index.ts` 中注册权限路由
  - [ ] 10.9 编写 `server/permission/routes.test.ts` 路由测试

- [ ] 11. 动态组织集成
  - [ ] 11.1 修改 `server/core/dynamic-organization.ts`，在 materializeWorkflowOrganization() 中增加权限分配逻辑
  - [ ] 11.2 实现权限继承关系：CEO 权限 ⊇ Manager 权限 ⊇ Worker 权限
  - [ ] 11.3 实现组织删除时的权限自动清理（deletePoliciesByOrganization）
  - [ ] 11.4 编写动态组织权限集成测试
  - [ ] 11.5 编写属性测试 Property 12: 权限继承层级正确性

- [ ] 12. Agent 操作拦截集成
  - [ ] 12.1 修改 `server/core/agent.ts`，增加 permissionToken 字段和 setPermissionToken() 方法
  - [ ] 12.2 在 Agent.saveToWorkspace()、readFromWorkspace() 中注入文件系统权限检查
  - [ ] 12.3 修改 `server/core/workflow-engine.ts`，在工作流启动时为每个 Agent 生成 CapabilityToken
  - [ ] 12.4 编写 Agent 权限拦截集成测试

- [ ] 13. 速率限制实现
  - [ ] 13.1 创建 `server/permission/rate-limiter.ts`，实现滑动窗口速率限制器
  - [ ] 13.2 在 NetworkChecker 和 ApiChecker 中集成速率限制检查
  - [ ] 13.3 编写 `server/permission/rate-limiter.test.ts` 单元测试
  - [ ] 13.4 编写属性测试 Property 14: 速率限制正确性

- [ ] 14. 前端权限管理界面
  - [ ] 14.1 创建 `client/src/lib/permission-store.ts`，Zustand store 管理权限数据 + REST API 调用
  - [ ] 14.2 创建 `client/src/components/permissions/PermissionPanel.tsx`，权限管理主面板（Agent 列表 + 权限配置 + 快速编辑）
  - [ ] 14.3 创建 `client/src/components/permissions/PermissionMatrix.tsx`，权限矩阵视图（Agent × Resource × Action 热力图）
  - [ ] 14.4 创建 `client/src/components/permissions/AuditTimeline.tsx`，审计时间轴（权限变更历史）
  - [ ] 14.5 在 `client/src/components/Toolbar.tsx` 中添加权限管理入口

- [ ] 15. 文档与环境变量
  - [ ] 15.1 更新 `.env.example`，添加 PERMISSION_TOKEN_SECRET、PERMISSION_TOKEN_DEFAULT_TTL_MS、PERMISSION_CACHE_SIZE、PERMISSION_CACHE_TTL_MS、PERMISSION_AUDIT_ENABLED 环境变量
  - [ ] 15.2 运行 `npm run check` 确保类型检查通过
