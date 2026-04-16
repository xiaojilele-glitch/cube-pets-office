# 实现计划：动态角色系统（Dynamic Role System）

## 概述

基于设计文档，将动态角色系统拆分为增量式编码任务。每个任务构建在前一任务之上，从共享类型定义开始，逐步实现核心组件，最后集成到工作流引擎和前端。所有代码使用 TypeScript，测试使用 Vitest + fast-check。

## 任务

- [x] 1. 定义共享类型和角色模板 Schema
  - [x] 1.1 创建 `shared/role-schema.ts`，定义 RoleTemplate、RoleChangeLogEntry、RoleOperationLog、RolePerformanceRecord、AgentRoleRecommendation、RoleSwitchTrace、PhaseAssignment、RoleConstraintError、RoleUsageSummary、AgentRoleDistribution 等类型
    - 导出 AuthorityLevel、RoleSource、RoleLoadPolicy 类型别名
    - 确保与现有 `shared/organization-schema.ts` 中的 WorkflowNodeModelConfig、WorkflowSkillBinding、WorkflowMcpBinding 类型兼容
    - _Requirements: 1.1, 4.1, 4.2_

- [x] 2. 实现 RoleRegistry 角色模板注册表
  - [x] 2.1 创建 `server/core/role-registry.ts`，实现 RoleRegistry 类
    - 实现 register(template)、get(roleId)、list()、unregister(roleId) 方法
    - 实现 resolve(roleId) 继承解析：递归合并 parent 的 responsibilityPrompt、requiredSkillIds、mcpIds
    - 实现循环继承检测
    - 实现变更日志记录（changedBy、changedAt、diff）
    - 持久化到 `data/role-templates.json`
    - _Requirements: 1.2, 1.3, 1.4, 1.5_
  - [x] 2.2 编写 RoleRegistry 属性测试
    - **Property 1: 角色模板注册/查询往返一致性**
    - **Validates: Requirements 1.2**
  - [x] 2.3 编写 RoleRegistry 继承解析属性测试
    - **Property 2: 角色继承解析正确性**
    - **Validates: Requirements 1.3**
  - [x] 2.4 编写 RoleRegistry 变更日志属性测试
    - **Property 3: 角色模板变更日志完整性**
    - **Validates: Requirements 1.4, 1.5**
  - [x] 2.5 编写 RoleRegistry 单元测试
    - 测试重复 roleId 注册、不存在的 roleId 查询、循环继承检测
    - _Requirements: 1.2, 1.3_

- [x] 3. 实现 RoleConstraintValidator 约束校验器
  - [x] 3.1 创建 `server/core/role-constraint-validator.ts`，实现 RoleConstraintValidator 类
    - 实现 validate(agent, targetRoleId, context) 方法
    - 按优先级校验：AGENT_BUSY → COOLDOWN_ACTIVE → ROLE_SWITCH_DENIED → AUTHORITY_APPROVAL_REQUIRED
    - 校验失败时记录调试日志
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 3.2 编写约束校验属性测试
    - **Property 15: 角色切换约束校验**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
  - [x] 3.3 编写约束校验单元测试
    - 测试各约束错误码的具体触发场景和边界条件
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 4. 扩展 Agent 类支持角色加载/卸载
  - [x] 4.1 修改 `server/core/agent.ts`，新增 AgentRoleState 和角色管理方法
    - 新增 roleState 字段（currentRoleId、baseSystemPrompt、roleLoadPolicy 等）
    - 实现 loadRole(roleId, triggerSource)：约束校验 → 获取模板 → 注入 prompt → 加载 skills/MCP → 合并 model 配置 → 更新状态 → 记录日志 → 广播事件
    - 实现 unloadRole(triggerSource)：恢复 prompt → 卸载 skills/MCP → 恢复配置 → 清空状态 → 记录日志 → 广播事件
    - 实现 switchRole(newRoleId, triggerSource)：事务性切换，失败回滚
    - 角色状态持久化到 `data/agents/<agentId>/role-state.json`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 4.2 修改 `shared/runtime-agent.ts`，扩展 RuntimeAgentConfig 新增 currentRoleId 可选字段
    - _Requirements: 2.1_
  - [x] 4.3 编写 loadRole 状态正确性属性测试
    - **Property 4: loadRole 后 Agent 状态正确性**
    - **Validates: Requirements 2.1**
  - [x] 4.4 编写 unloadRole 状态恢复属性测试
    - **Property 5: unloadRole 后 Agent 状态恢复**
    - **Validates: Requirements 2.2**
  - [x] 4.5 编写角色切换回滚属性测试
    - **Property 6: 角色切换失败回滚**
    - **Validates: Requirements 2.3**
  - [x] 4.6 编写 roleLoadPolicy 属性测试
    - **Property 7: roleLoadPolicy 模型配置合并**
    - **Validates: Requirements 2.4**
  - [x] 4.7 编写角色操作日志属性测试
    - **Property 8: 角色操作日志完整性**
    - **Validates: Requirements 2.5, 5.5, 6.5**

- [x] 5. Checkpoint - 确保核心组件测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 6. 实现 RolePerformanceTracker 绩效追踪器
  - [x] 6.1 创建 `server/core/role-performance-tracker.ts`，实现 RolePerformanceTracker 类
    - 实现 updateOnTaskComplete(agentId, roleId, taskResult)：更新 totalTasks、avgQualityScore、avgLatencyMs、successRate、lastActiveAt
    - 实现 Ring Buffer 语义的 recentTasks（最大 50 条）
    - 实现 lowConfidence 标记（totalTasks < 10）
    - 实现 getPerformance(agentId, roleId?) 查询，支持按 roleId 过滤
    - 同步更新 Agent 整体 CapabilityProfile
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [x] 6.2 编写绩效更新属性测试
    - **Property 11: 任务完成更新绩效记录**
    - **Validates: Requirements 4.2, 4.3, 4.4**
  - [x] 6.3 编写绩效过滤属性测试
    - **Property 12: 绩效历史按 roleId 过滤**
    - **Validates: Requirements 4.5**
  - [x] 6.4 编写绩效追踪器单元测试
    - 测试 Ring Buffer 边界（0/1/50/51 条）、分数 clamp、lowConfidence 阈值
    - _Requirements: 4.2, 4.3, 4.4_

- [x] 7. 实现 RoleMatcher 角色匹配器
  - [x] 7.1 创建 `server/core/role-matcher.ts`，实现 RoleMatcher 类
    - 实现 match(task, candidateAgents) 方法
    - 实现 computeScore：skillMatch _ 0.35 + agentCompetency _ 0.30 + rolePerformance _ 0.25 _ confidenceCoeff + (1 - loadFactor) \* 0.10
    - 实现 inferCandidateRoles(taskDescription)：通过 LLM 推断候选角色，失败时回退到关键词匹配
    - 当 task.requiredRole 存在时跳过推断，仅在该角色范围内匹配
    - 记录匹配结果到 ExecutionPlan 调试日志
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 7.2 编写评分计算属性测试
    - **Property 9: roleMatchScore 加权计算正确性**
    - **Validates: Requirements 3.1, 3.2, 4.4**
  - [x] 7.3 编写 requiredRole 约束属性测试
    - **Property 10: requiredRole 约束匹配范围**
    - **Validates: Requirements 3.4**
  - [x] 7.4 编写 RoleMatcher 单元测试
    - 测试空候选列表、所有 Agent 低分、LLM 推断失败降级
    - _Requirements: 3.1, 3.3_

- [x] 8. 实现 Phase-level 角色切换编排
  - [x] 8.1 扩展 `shared/executor/contracts.ts`，在 ExecutionPlanStep 中新增 assignments?: PhaseAssignment[] 字段
    - _Requirements: 5.1_
  - [x] 8.2 修改 `server/core/workflow-engine.ts`，在阶段切换逻辑中集成角色切换
    - 检测相邻阶段的 Agent-角色分配差异
    - 执行 agent.unloadRole() → agent.loadRole(nextPhaseRoleId)
    - 实现 allowSelfReview 约束检查（默认 false）
    - 当 allowSelfReview=false 时，自动将审查任务分配给其他 Agent
    - _Requirements: 5.2, 5.3, 5.4_
  - [x] 8.3 修改 `server/core/mission-orchestrator.ts`，记录角色切换轨迹到 Mission 事件流
    - 使用 MissionEvent 结构记录 agentId、fromRoleId、toRoleId、phaseId、timestamp
    - _Requirements: 5.5_
  - [x] 8.4 编写阶段切换角色切换属性测试
    - **Property 13: 阶段切换自动角色切换**
    - **Validates: Requirements 5.1, 5.2**
  - [x] 8.5 编写 allowSelfReview 约束属性测试
    - **Property 14: allowSelfReview 约束**
    - **Validates: Requirements 5.3, 5.4**

- [x] 9. Checkpoint - 确保工作流集成测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 10. 实现 RoleAnalyticsService 分析与告警
  - [x] 10.1 创建 `server/core/role-analytics.ts`，实现 RoleAnalyticsService 类
    - 实现指标收集：recordRoleLoad、recordRoleUnload、recordRoleSwitch、recordMatchScore
    - 实现 Prometheus 指标暴露：role_load_total、role_active_duration_seconds、role_switch_total、role_match_score_histogram
    - 实现 checkAlerts()：ROLE_UNUSED（7 天无加载）和 AGENT_ROLE_THRASHING（24 小时内 > 20 次切换）
    - 实现 getRoleUsageSummary() 和 getAgentRoleDistribution()
    - 持久化到 `data/role-analytics.json`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x] 10.2 编写 ROLE_UNUSED 告警属性测试
    - **Property 16: ROLE_UNUSED 告警触发**
    - **Validates: Requirements 7.3**
  - [x] 10.3 编写 AGENT_ROLE_THRASHING 告警属性测试
    - **Property 17: AGENT_ROLE_THRASHING 告警触发**
    - **Validates: Requirements 7.4**
  - [x] 10.4 编写分析服务单元测试
    - 测试告警阈值边界（第 7 天、第 20 次切换）
    - _Requirements: 7.3, 7.4_

- [x] 11. 实现后端 API 扩展
  - [x] 11.1 修改 `server/routes/agents.ts`，扩展 GET /api/agents/:id 响应
    - 新增 currentRole（角色名 + 加载时间）和 roleHistory（最近 20 条切换记录）字段
    - _Requirements: 8.1, 8.5_
  - [x] 11.2 创建 `server/routes/analytics.ts`，实现 GET /api/analytics/roles 端点
    - 返回 roleUsageSummary 和 agentRoleDistribution
    - _Requirements: 7.5_
  - [x] 11.3 扩展 Socket.IO 事件，新增 agent.roleChanged 事件推送
    - 在 agent.loadRole/unloadRole 中触发，包含 agentId、fromRoleId、toRoleId、timestamp
    - _Requirements: 8.5_
  - [x] 11.4 编写 API 角色状态响应属性测试
    - **Property 18: API 角色状态响应正确性**
    - **Validates: Requirements 8.1, 8.5**

- [x] 12. 集成动态组织生成模块
  - [x] 12.1 修改 `server/core/dynamic-organization.ts`，在组织生成后自动注册角色模板到 RoleRegistry
    - LLM 生成的角色定义 source 标记为 "generated"
    - 人工预定义的角色模板 source 标记为 "predefined"
    - _Requirements: 1.4_

- [x] 13. 实现前端角色状态展示
  - [x] 13.1 创建 `client/src/lib/role-store.ts`，实现 Zustand store
    - 订阅 WebSocket agent.roleChanged 事件
    - 维护 agentRoles Map（currentRole + roleHistory）
    - _Requirements: 8.1, 8.5_
  - [x] 13.2 扩展 Agent 详情面板，展示 currentRole 和 roleHistory
    - 显示当前角色名称和加载时间
    - 显示最近 20 次角色切换记录
    - _Requirements: 8.1_
  - [x] 13.3 实现多角色绩效雷达图组件
    - 使用 recharts RadarChart，以各 roleId 为轴展示 avgQualityScore
    - _Requirements: 8.2_
  - [x] 13.4 扩展 3D 场景中 Agent 的角色视觉标识
    - 根据 currentRole 动态更新颜色、图标、头顶标签
    - 角色切换时添加过渡动画
    - _Requirements: 8.3_
  - [x] 13.5 扩展工作流面板 Mission 时间轴
    - 展示各 Agent 的角色切换节点
    - 不同角色用不同颜色标注执行时段
    - _Requirements: 8.4_

- [x] 14. Final Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

## 备注

- 标记 `*` 的任务为可选测试任务，可跳过以加速 MVP 开发
- 每个任务引用了具体的需求编号，确保可追溯性
- Checkpoint 任务确保增量验证
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
- 所有属性测试使用 fast-check 库，每个测试至少运行 100 次迭代
