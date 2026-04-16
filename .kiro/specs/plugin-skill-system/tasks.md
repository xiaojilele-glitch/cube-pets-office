# 实现计划：Plugin / Skill 体系

## 概述

将现有硬编码的 SKILL_LIBRARY 演进为数据库驱动的 SkillRegistry，实现 Skill 的注册、版本管理、依赖解析、动态启用/禁用、性能监控和前端展示。采用渐进式迁移策略，保持与现有系统的兼容性。

## Tasks

- [x] 1. 定义共享类型契约和数据库 Schema 扩展
  - [x] 1.1 在 `shared/skill-contracts.ts` 中定义 SkillDefinition、SkillRecord、SkillBinding、SkillBindingConfig、SkillExecutionMetrics、SkillAuditLog、SkillContext、SideEffect、CanaryConfig 等类型接口
    - 确保与现有 `WorkflowSkillBinding`（shared/organization-schema.ts）兼容
    - _Requirements: 1.1, 6.1, 7.1, 9.1_
  - [x] 1.2 扩展 `server/db/index.ts`，新增 skills、skill_metrics、skill_audit_log 表和对应的 CRUD 方法
    - 新增 `DatabaseSchema` 中的 skills、skill_metrics、skill_audit_log 数组
    - 新增 \_counters 中的 skill_metrics、skill_audit_log 计数器
    - 实现 getSkills、getSkill、upsertSkill、getSkillMetrics、createSkillMetric、getSkillAuditLogs、createSkillAuditLog 等方法
    - _Requirements: 1.2, 7.1, 5.4_

- [x] 2. 实现 SkillRegistry 核心模块
  - [x] 2.1 创建 `server/core/skill-registry.ts`，实现 registerSkill 方法
    - 验证 SkillDefinition 必填字段完整性
    - 验证 prompt 模板包含 `{context}` 和 `{input}` 占位符
    - 验证 version 字段符合语义化版本格式（X.Y.Z）
    - 持久化到数据库并返回完整 SkillRecord
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 6.1_
  - [x] 2.2 编写 registerSkill 的属性测试
    - **Property 1: Skill 注册往返一致性**
    - **Property 2: Prompt 模板验证**
    - **Property 3: 版本并存**
    - **Property 15: 语义化版本验证**
    - **Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.3, 6.1, 6.3**
  - [x] 2.3 实现 resolveSkills 方法，包含依赖解析和循环检测
    - 递归解析 dependencies 字段，构建传递闭包
    - 使用访问标记检测循环依赖，抛出 CircularDependencyError
    - 过滤禁用的 Skill
    - 未找到的 skillId 记录 warn 日志并跳过
    - _Requirements: 2.2, 2.3, 2.4, 5.2, 8.2, 8.3_
  - [x] 2.4 编写 resolveSkills 的属性测试
    - **Property 4: Skill 解析正确性**
    - **Property 5: 依赖传递闭包**
    - **Property 6: 缺失 Skill 优雅降级**
    - **Property 7: 循环依赖检测**
    - **Property 8: 禁用 Skill 过滤**
    - **Validates: Requirements 2.2, 2.3, 2.4, 5.2, 5.3, 8.2, 8.3**
  - [x] 2.5 实现 enableSkill、disableSkill 方法和审计日志
    - 更新 SkillRecord.enabled 字段
    - 写入 skill_audit_log 记录（包含 operator、reason、timestamp）
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [x] 2.6 实现 getSkillVersions、querySkills 和 resolveMcpForSkill 方法
    - getSkillVersions 按 skillId 查询所有版本
    - querySkills 支持 category 和 tags 过滤
    - resolveMcpForSkill 复用现有 MCP_LIBRARY 解析逻辑，缺失 MCP 记录 warn 并跳过
    - _Requirements: 6.2, 6.3, 4.2, 4.3_
  - [x] 2.7 编写版本管理和 MCP 解析的属性测试
    - **Property 12: MCP 解析正确性**
    - **Property 13: MCP 不可用时优雅降级**
    - **Property 14: 审计日志完整性**
    - **Property 16: 指定版本解析**
    - **Validates: Requirements 4.2, 4.3, 5.4, 6.2, 6.5**
  - [x] 2.8 实现灰度发布逻辑
    - 在 resolveSkills 中根据 CanaryConfig.percentage 决定返回哪个版本
    - 使用 Math.random() 进行流量分配
    - _Requirements: 6.4_
  - [x] 2.9 编写灰度发布的属性测试
    - **Property 17: 灰度流量分布**
    - **Validates: Requirements 6.4**

- [x] 3. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [x] 4. 实现 SkillActivator 模块
  - [x] 4.1 创建 `server/core/skill-activator.ts`，实现 activateSkills 方法
    - 过滤 enabled=true 的 SkillBinding
    - 按 priority 排序
    - 截断到 maxSkills 上限（默认 5）
    - 替换 prompt 中的 `{context}` 占位符为任务上下文
    - 返回 ActivatedSkill 数组
    - _Requirements: 3.1, 3.2, 3.3, 3.5_
  - [x] 4.2 实现 buildSkillPromptSection 方法
    - 将激活的 Skill prompt 按优先级拼接为系统提示片段
    - _Requirements: 3.2_
  - [x] 4.3 编写 SkillActivator 的属性测试
    - **Property 9: Skill 激活数量上限**
    - **Property 10: 优先级排序的 Prompt 拼接**
    - **Property 11: 上下文占位符替换**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.5**

- [x] 5. 实现 SkillContext 上下文隔离
  - [x] 5.1 创建 `server/core/skill-context.ts`，实现 SkillContext 工厂函数
    - createSkillContext(skillId) 返回独立的上下文对象
    - 实现 recordSideEffect 方法记录副作用
    - 确保每个 Skill 的 state 互不影响
    - _Requirements: 9.1, 9.2, 9.3_
  - [x] 5.2 编写上下文隔离的属性测试
    - **Property 21: 上下文隔离**
    - **Property 22: 副作用记录**
    - **Validates: Requirements 9.1, 9.2, 9.3**

- [x] 6. 实现 SkillMonitor 性能监控模块
  - [x] 6.1 创建 `server/core/skill-monitor.ts`，实现 recordMetrics 和 getSkillMetrics 方法
    - recordMetrics 将 SkillExecutionMetrics 持久化到 skill_metrics 表
    - getSkillMetrics 支持 timeRange 过滤和按 version、agentRole、taskType 聚合
    - _Requirements: 7.1, 7.2, 7.3_
  - [x] 6.2 实现 checkAlerts 告警方法
    - 计算指定 Skill 在时间窗口内的失败率
    - 超过阈值时返回 AlertResult
    - _Requirements: 7.4_
  - [x] 6.3 编写 SkillMonitor 的属性测试
    - **Property 18: 性能指标记录往返**
    - **Property 19: 指标聚合正确性**
    - **Property 20: 告警阈值触发**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**

- [x] 7. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [x] 8. 集成到现有工作流系统
  - [x] 8.1 修改 `server/core/dynamic-organization.ts`，将 SKILL_LIBRARY 迁移到 SkillRegistry
    - 在 resolveSkills 函数中调用 skillRegistry.resolveSkills 替代硬编码查找
    - 保持 SKILL_LIBRARY 作为种子数据，启动时自动注册到 SkillRegistry
    - _Requirements: 2.1, 2.2, 2.5_
  - [x] 8.2 修改 `shared/runtime-agent.ts` 的 buildAgentSystemPrompt，注入 Skill prompt
    - 在系统提示中追加 Skill prompt 片段（通过 SkillActivator.buildSkillPromptSection）
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 8.3 修改 `server/core/workflow-engine.ts`，在执行阶段调用 SkillActivator
    - 在 runExecution 中，Agent invoke 前调用 activateSkills
    - 记录激活的 Skill 列表到执行日志
    - 记录 SkillExecutionMetrics 到 SkillMonitor
    - _Requirements: 3.1, 3.4, 7.1_

- [x] 9. 实现 Skill API 路由
  - [x] 9.1 创建 `server/routes/skills.ts`，实现 Skill 管理 API
    - POST /api/skills — 注册新 Skill
    - GET /api/skills — 查询 Skill 列表（支持 category、tags 查询参数）
    - GET /api/skills/:id/versions — 查询版本列表
    - PUT /api/skills/:id/:version/enable — 启用 Skill
    - PUT /api/skills/:id/:version/disable — 禁用 Skill
    - GET /api/skills/:id/metrics — 查询性能指标
    - _Requirements: 1.2, 5.1, 6.3, 7.2_
  - [x] 9.2 在 `server/routes/workflows.ts` 中新增节点 Skill 查询端点
    - GET /api/workflows/:id/nodes/:nodeId/skills — 返回节点的 SkillBinding 列表
    - _Requirements: 10.4_
  - [x] 9.3 在 `server/index.ts` 中注册 skills 路由
    - _Requirements: 10.4_

- [x] 10. 实现前端 Skill 展示组件
  - [x] 10.1 创建 `client/src/components/SkillCard.tsx` 组件
    - 展示 name、summary、category、version、enabled 状态
    - 点击展开详细信息（prompt、MCP 依赖、性能指标）
    - _Requirements: 10.2, 10.3_
  - [x] 10.2 在 `client/src/components/WorkflowPanel.tsx` 的 OrgView 中集成 SkillCard
    - 在 Agent 节点信息中展示 Skill 列表
    - 通过 GET /api/workflows/:id/nodes/:nodeId/skills 获取数据
    - _Requirements: 10.1, 10.4_
  - [x] 10.3 编写 SkillCard 渲染的属性测试
    - **Property 23: Skill 卡片渲染完整性**
    - **Validates: Requirements 10.2**

- [x] 11. 种子数据迁移和最终集成
  - [x] 11.1 创建种子数据脚本，将现有 SKILL_LIBRARY 中的 8 个 Skill 注册到数据库
    - 在服务启动时检查并自动注册种子 Skill
    - _Requirements: 1.2, 1.3_
  - [x] 11.2 编写集成测试
    - 测试完整的 Skill 注册 → 解析 → 激活 → 执行流程
    - 测试 API 端点的请求/响应格式
    - _Requirements: 1.2, 2.2, 3.1, 10.4_

- [x] 12. 最终检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP 交付
- 每个任务引用了具体的需求编号以确保可追溯性
- 检查点确保增量验证
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
