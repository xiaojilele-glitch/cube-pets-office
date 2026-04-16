# 实现计划：多租户架构

## 概述

基于设计文档，将多租户架构分解为增量式编码任务。从共享类型定义开始，逐步构建中间件层、核心服务、数据隔离层、Marketplace、订阅管理、审计日志、数据导出/导入，最后实现前端租户管理面板。每个任务都建立在前一个任务的基础上，确保代码始终可运行。

## 任务

- [ ] 1. 定义共享类型和数据模型
  - [ ] 1.1 创建 `shared/tenant.ts`，定义 Tenant、TenantContext、TenantRole、TenantTier、Permission、QuotaLimits、QuotaUsage、TenantMembership 等核心类型
    - 包含 ROLE_PERMISSIONS 角色-权限映射常量
    - 包含 TIER_QUOTAS 各 tier 的默认配额常量
    - _Requirements: 1.4, 7.1_
  - [ ] 1.2 创建 `shared/marketplace.ts`，定义 MarketplaceAgent、PublishMetadata、MarketplaceFilters 等类型
    - _Requirements: 8.1, 8.2, 9.2_
  - [ ] 1.3 创建 `shared/audit.ts`，定义 AuditLogEntry、AuditFilters 等类型
    - _Requirements: 12.2_
  - [ ] 1.4 扩展 `server/db/index.ts` 中的 AgentRow、WorkflowRun、MessageRow、TaskRow 接口，新增 tenantId 字段
    - _Requirements: 3.1, 4.1, 5.1_

- [ ] 2. 实现租户数据存储层
  - [ ] 2.1 创建 `server/db/tenant-store.ts`，实现 TenantStore 类
    - 基于 JSON 文件存储（data/tenants.json）
    - 实现 createTenant、getTenant、deleteTenant、listTenants、updateTenant 方法
    - 实现 TenantMembership 的 CRUD（addMember、removeMember、getMember、listMembers、updateMemberRole）
    - _Requirements: 1.1, 1.5_
  - [ ]\* 2.2 编写 TenantStore 属性测试
    - **Property 1: 租户创建返回有效结果**
    - **Validates: Requirements 1.1, 1.5**

- [ ] 3. 实现租户上下文中间件
  - [ ] 3.1 创建 `server/core/tenant-context.ts`，实现租户上下文提取中间件
    - 从 X-Tenant-ID header 或 JWT token 中提取 tenantId
    - 验证用户是否属于该租户
    - 将 TenantContext 注入到 req 对象
    - 验证失败返回 403 并记录审计日志
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [ ] 3.2 创建 `server/core/rbac-guard.ts`，实现 RBAC 权限守卫中间件
    - 实现 requirePermission(...permissions) 工厂函数
    - 根据用户角色检查权限，无权限返回 403
    - _Requirements: 7.1, 7.2, 7.4_
  - [ ] 3.3 创建 `server/core/quota-guard.ts`，实现配额检查守卫中间件
    - 实现 requireQuota(resourceType, amount) 工厂函数
    - 超过配额返回 429 并附带升级提示
    - _Requirements: 6.1, 6.2, 6.3_
  - [ ]\* 3.4 编写租户上下文中间件属性测试
    - **Property 9: 租户上下文提取与验证**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
  - [ ]\* 3.5 编写 RBAC 权限守卫属性测试
    - **Property 8: RBAC 角色分配与权限执行**
    - **Validates: Requirements 7.2, 7.3, 7.4**

- [ ] 4. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 5. 实现 TenantService 和资源初始化
  - [ ] 5.1 创建 `server/core/tenant-service.ts`，实现 TenantService
    - createTenant()：创建租户记录、初始化工作空间目录、设置默认配额
    - deleteTenant()：软删除租户、异步清理关联数据（Agent、知识库、工作流、审计日志）
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.5, 13.4_
  - [ ]\* 5.2 编写 TenantService 属性测试
    - **Property 2: 租户初始化创建完整资源**
    - **Validates: Requirements 1.2, 1.3**
  - [ ]\* 5.3 编写租户删除清除属性测试
    - **Property 7: 租户删除数据清除**
    - **Validates: Requirements 4.5, 13.4**

- [ ] 6. 实现 QuotaService
  - [ ] 6.1 创建 `server/core/quota-service.ts`，实现 QuotaService
    - checkQuota()：检查配额是否允许
    - updateUsage()：更新配额使用量
    - recalculateUsage()：重新计算实际使用量
    - getQuotaUsage()：获取当前使用量
    - _Requirements: 6.1, 6.4, 6.5_
  - [ ]\* 6.2 编写 QuotaService 属性测试
    - **Property 5: 配额使用一致性**
    - **Property 6: 配额限额执行**
    - **Validates: Requirements 3.5, 4.4, 5.5, 6.1, 6.3, 6.4**
  - [ ]\* 6.3 编写租户间配额独立性属性测试
    - **Property 17: 租户间配额独立性**
    - **Validates: Requirements 13.3**

- [ ] 7. 实现租户作用域数据仓库
  - [ ] 7.1 创建 `server/core/tenant-agent-repository.ts`，封装 Agent 的租户隔离查询
    - 所有查询自动注入 tenantId 过滤
    - 创建时自动关联当前租户
    - 跨租户访问返回 404
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [ ] 7.2 创建 `server/core/tenant-workflow-repository.ts`，封装工作流的租户隔离查询
    - 工作流、执行记录、日志的租户隔离
    - 执行环境路径隔离
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [ ]\* 7.3 编写租户作用域记录关联属性测试
    - **Property 3: 租户作用域记录自动关联**
    - **Validates: Requirements 3.1, 3.2, 4.1, 4.2, 5.1, 5.2**
  - [ ]\* 7.4 编写跨租户数据隔离属性测试
    - **Property 4: 跨租户数据隔离**
    - **Validates: Requirements 3.3, 3.4, 4.3, 5.3, 13.2**
  - [ ]\* 7.5 编写执行环境路径隔离属性测试
    - **Property 18: 执行环境路径隔离**
    - **Validates: Requirements 5.4**

- [ ] 8. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 9. 实现 RBACService
  - [ ] 9.1 创建 `server/core/rbac-service.ts`，实现 RBACService
    - assignRole()：分配角色（替换已有角色）
    - getUserRole()：获取用户角色
    - getPermissions()：获取角色权限列表
    - hasPermission()：检查用户是否有指定权限
    - listMembers()：列出租户成员
    - _Requirements: 7.1, 7.2, 7.3, 7.5_

- [ ] 10. 实现 AuditLogger
  - [ ] 10.1 创建 `server/core/audit-logger.ts`，实现 AuditLogger
    - log()：记录审计日志条目（fire-and-forget 模式）
    - query()：按条件查询审计日志
    - 每个租户独立的审计日志文件（data/audit-logs/{tenantId}.json）
    - 审计日志不可修改、不可删除
    - _Requirements: 12.1, 12.2, 12.4, 12.5_
  - [ ]\* 10.2 编写审计日志属性测试
    - **Property 15: 审计日志完整性与不可变性**
    - **Validates: Requirements 12.1, 12.2, 12.5**
  - [ ]\* 10.3 编写审计日志过滤属性测试
    - **Property 16: 审计日志过滤正确性**
    - **Validates: Requirements 12.4**

- [ ] 11. 实现 MarketplaceService
  - [ ] 11.1 创建 `server/core/marketplace-service.ts`，实现 MarketplaceService
    - listAgents()：浏览公共 Agent 市场
    - importAgent()：导入 Marketplace Agent 到租户 Agent 池（创建私有副本）
    - publishAgent()：发布租户 Agent 到 Marketplace（验证必填元数据）
    - getUsageStats()：获取 Agent 使用统计
    - 基于 JSON 文件存储（data/marketplace.json）
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5_
  - [ ]\* 11.2 编写 Marketplace 导入属性测试
    - **Property 10: Marketplace Agent 导入创建私有副本**
    - **Validates: Requirements 8.5**
  - [ ]\* 11.3 编写 Marketplace 发布属性测试
    - **Property 11: Agent 发布保留元数据**
    - **Validates: Requirements 9.2, 9.3**
  - [ ]\* 11.4 编写导入计数追踪属性测试
    - **Property 12: 导入计数追踪**
    - **Validates: Requirements 9.4**

- [ ] 12. 实现 SubscriptionService
  - [ ] 12.1 创建 `server/core/subscription-service.ts`，实现 SubscriptionService
    - upgradeTenant()：升级订阅等级，自动更新配额和功能
    - getSubscription()：查询订阅信息
    - 记录订阅变更日志
    - _Requirements: 10.1, 10.2, 10.4, 10.5_
  - [ ]\* 12.2 编写订阅升级属性测试
    - **Property 13: 订阅升级更新配额**
    - **Validates: Requirements 10.2, 10.4**

- [ ] 13. 实现 ExportService
  - [ ] 13.1 创建 `server/core/export-service.ts`，实现 ExportService
    - exportTenantData()：异步导出租户数据（Agent、知识库、工作流）
    - importTenantData()：导入数据到租户
    - 支持 JSON 和 CSV 格式
    - 导出任务状态管理（pending → processing → completed/failed）
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  - [ ]\* 13.2 编写数据导出/导入往返属性测试
    - **Property 14: 数据导出/导入往返一致性**
    - **Validates: Requirements 11.3, 11.5**

- [ ] 14. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 15. 实现 REST API 路由并集成中间件
  - [ ] 15.1 创建 `server/routes/tenants.ts`，实现租户管理路由
    - POST /api/tenants（创建租户）
    - GET /api/tenants/:id（获取租户信息）
    - DELETE /api/tenants/:id（删除租户）
    - GET /api/tenants/:id/quota（查询配额）
    - GET /api/tenants/:id/subscription（查询订阅）
    - PUT /api/tenants/:id/subscription（升级订阅）
    - GET /api/tenants/:id/members（成员列表）
    - POST /api/tenants/:id/members/:userId/role（分配角色）
    - GET /api/tenants/:id/audit-logs（审计日志）
    - POST /api/tenants/:id/export（导出数据）
    - POST /api/tenants/:id/import（导入数据）
    - _Requirements: 6.5, 7.3, 10.5, 12.3_
  - [ ] 15.2 创建 `server/routes/marketplace.ts`，实现 Marketplace 路由
    - GET /api/marketplace/agents（浏览市场）
    - POST /api/agents/import（导入 Agent）
    - POST /api/agents/:id/publish（发布 Agent）
    - _Requirements: 8.3, 8.4, 9.1_
  - [ ] 15.3 在 `server/index.ts` 中注册新路由并集成租户上下文中间件
    - 将 tenantContextMiddleware 应用到需要租户隔离的路由
    - 在各端点应用 requirePermission 和 requireQuota 守卫
    - 更新现有 /api/agents 路由以支持租户隔离
    - _Requirements: 2.5, 6.2, 7.4_

- [ ] 16. 实现前端租户管理面板
  - [ ] 16.1 创建 `client/src/lib/tenant-store.ts`，实现前端租户状态管理
    - Zustand store 管理租户信息、配额使用、成员列表
    - API 调用封装（获取租户信息、配额、成员、审计日志）
    - _Requirements: 14.1, 14.2_
  - [ ] 16.2 创建 `client/src/pages/TenantDashboard.tsx`，实现租户管理面板页面
    - 显示租户名称、订阅等级、过期时间
    - 显示资源使用情况（Agent 数量、知识库大小、月度 API 调用）
    - 显示配额限制和使用百分比（进度条）
    - 提供升级、续费、导出数据操作按钮
    - 显示团队成员列表和权限分配
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_
  - [ ]\* 16.3 编写仪表盘配额百分比计算属性测试
    - **Property 19: 仪表盘配额百分比计算**
    - **Validates: Requirements 14.3**

- [ ] 17. 在 `client/src/App.tsx` 中添加租户管理面板路由
  - 添加 /tenant 路由指向 TenantDashboard 页面
  - _Requirements: 14.1_

- [ ] 18. 最终检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP 开发
- 每个任务引用了具体的需求编号以确保可追溯性
- 检查点确保增量验证
- 属性测试验证通用正确性属性
- 单元测试验证具体示例和边界情况
- 支付网关集成（Stripe 等）在 SubscriptionService 中预留接口，具体实现可后续迭代
