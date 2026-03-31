# Implementation Plan: Agent 信誉系统

## Overview

基于事件驱动架构实现 Agent 信誉系统。按照数据模型 → 核心计算引擎 → 信任层级 → 异常检测 → 衰减机制 → 编排器集成 → API → 前端的顺序递增构建，每步都有对应的属性测试验证正确性。

## Tasks

- [ ] 1. 数据模型与配置
  - [ ] 1.1 创建信誉系统类型定义 `shared/reputation.ts`
    - 定义 DimensionScores、RoleReputationRecord、ReputationGrade、TrustTier、ReputationProfile、ReputationSignal、ReputationChangeEvent、DimensionDeltas、ReputationAuditEntry 接口
    - 定义 ReputationConfig 接口及默认配置常量 DEFAULT_REPUTATION_CONFIG
    - _Requirements: 1.1, 1.6, 2.1, 2.5_
  - [ ] 1.2 扩展数据库 Schema `server/db/index.ts`
    - 在 DatabaseSchema 中新增 reputation_profiles、reputation_events、reputation_audit_log 表
    - 新增 _counters 中的 reputation_events 和 reputation_audit_log 计数器
    - 实现 CRUD 方法：getReputationProfile、upsertReputationProfile、createReputationEvent、getReputationEvents、createAuditEntry、getAuditEntries
    - _Requirements: 1.1, 2.5, 7.5_
  - [ ]* 1.3 编写属性测试：信誉分整数范围不变量
    - **Property 1: 信誉分整数范围不变量**
    - **Validates: Requirements 1.1, 1.6**

- [ ] 2. 信誉计算引擎
  - [ ] 2.1 实现 ReputationCalculator `server/core/reputation/reputation-calculator.ts`
    - 实现 ema(current, newValue, alpha) 指数移动平均
    - 实现 ratioToScore(ratio) 比值线性映射（<= 1.0 → 1000, >= 2.0 → 0）
    - 实现 computeDimensionDeltas(current, signal, streakCount) 各维度变动计算
    - 实现 clampDeltas(deltas, maxDelta) 变动幅度限制
    - 实现 computeOverallScore(dimensions, weights) 加权综合分计算
    - _Requirements: 1.2, 2.2, 2.4_
  - [ ]* 2.2 编写属性测试：加权综合分公式
    - **Property 2: 加权综合分公式**
    - **Validates: Requirements 1.2**
  - [ ]* 2.3 编写属性测试：维度更新公式正确性
    - **Property 3: 维度更新公式正确性**
    - **Validates: Requirements 2.2**
  - [ ]* 2.4 编写属性测试：单次更新变动幅度限制
    - **Property 4: 单次更新变动幅度限制**
    - **Validates: Requirements 2.4**

- [ ] 3. Checkpoint - 确保核心计算引擎测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. 信任层级评估器
  - [ ] 4.1 实现 TrustTierEvaluator `server/core/reputation/trust-tier-evaluator.ts`
    - 实现 computeGrade(overallScore) 分数→等级映射
    - 实现 computeTrustTier(grade) 等级→信任层级映射
    - 实现 evaluateExternalUpgrade(profile) 外部 Agent 升级判定
    - 实现 evaluateGradeChange(oldGrade, newGrade, agentId, taskId) 等级变更事件生成
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [ ]* 4.2 编写属性测试：信誉等级与信任层级映射一致性
    - **Property 11: 信誉等级与信任层级映射一致性**
    - **Validates: Requirements 5.1, 5.2**
  - [ ]* 4.3 编写属性测试：外部 Agent 信任层级升级
    - **Property 12: 外部 Agent 信任层级升级**
    - **Validates: Requirements 5.3**
  - [ ]* 4.4 编写属性测试：信誉等级降级事件
    - **Property 13: 信誉等级降级事件**
    - **Validates: Requirements 5.4**

- [ ] 5. 异常检测器
  - [ ] 5.1 实现 AnomalyDetector `server/core/reputation/anomaly-detector.ts`
    - 实现 checkAnomalyThreshold(agentId, recentEvents) 24 小时异常波动检测
    - 实现 checkGrindingPattern(agentId, recentTasks) 刷分模式检测
    - 实现 checkCollabCollusion(taskforceRatings) 互评串通检测
    - 实现 getProbationDamping(profile) probation 阻尼系数
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [ ]* 5.2 编写属性测试：异常波动检测
    - **Property 16: 异常波动检测**
    - **Validates: Requirements 7.1**
  - [ ]* 5.3 编写属性测试：刷分模式检测
    - **Property 17: 刷分模式检测**
    - **Validates: Requirements 7.2**
  - [ ]* 5.4 编写属性测试：互评串通检测
    - **Property 18: 互评串通检测**
    - **Validates: Requirements 7.3**
  - [ ]* 5.5 编写属性测试：Probation 阶段正向更新阻尼
    - **Property 19: Probation 阶段正向更新阻尼**
    - **Validates: Requirements 7.4**

- [ ] 6. Checkpoint - 确保异常检测测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. 信誉服务与更新工作器
  - [ ] 7.1 实现 ReputationService `server/core/reputation/reputation-service.ts`
    - 组装 ReputationCalculator、TrustTierEvaluator、AnomalyDetector
    - 实现 handleTaskCompleted(signal) 完整信誉更新流程（采集信号→异常检测→计算变动→更新档案→评估层级→生成事件）
    - 实现 getReputation(agentId)、getReputationByRole(agentId, roleId)
    - 实现 adjustReputation、resetReputation（运维操作）
    - 实现 getLeaderboard(options)
    - 实现 initializeProfile(agentId, isExternal) 初始化信誉档案
    - _Requirements: 1.3, 1.4, 1.5, 2.1, 2.3, 2.5, 3.1, 3.2, 3.4_
  - [ ]* 7.2 编写属性测试：信誉变更事件完整性
    - **Property 5: 信誉变更事件完整性**
    - **Validates: Requirements 2.5, 6.5**
  - [ ]* 7.3 编写属性测试：角色信誉与整体信誉并行更新
    - **Property 6: 角色信誉与整体信誉并行更新**
    - **Validates: Requirements 3.2**
  - [ ]* 7.4 编写属性测试：低置信度标记
    - **Property 7: 低置信度标记**
    - **Validates: Requirements 3.3**

- [ ] 8. 衰减与连胜机制
  - [ ] 8.1 实现 DecayScheduler `server/core/reputation/decay-scheduler.ts`
    - 实现 start()、stop() 定时调度（每天执行一次）
    - 实现 runDecayCycle() 遍历所有 Agent，对不活跃者执行衰减
    - 衰减仅作用于 overallScore，维度子分不变
    - 衰减下限为 decayFloor
    - _Requirements: 6.1, 6.2, 6.3_
  - [ ] 8.2 在 ReputationService 中实现连胜加速逻辑
    - 跟踪 consecutiveHighQuality 计数
    - 连续 N 次高质量任务后提升 alpha 值
    - 连续记录断裂后恢复正常 alpha
    - _Requirements: 6.4_
  - [ ]* 8.3 编写属性测试：不活跃衰减规则
    - **Property 14: 不活跃衰减规则**
    - **Validates: Requirements 6.1, 6.2, 6.3**
  - [ ]* 8.4 编写属性测试：连胜加速机制
    - **Property 15: 连胜加速机制**
    - **Validates: Requirements 6.4**

- [ ] 9. Checkpoint - 确保信誉服务完整测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. 编排器集成
  - [ ] 10.1 实现任务分配信誉因子 `server/core/reputation/assignment-scorer.ts`
    - 实现 computeAssignmentScore(fitnessScore, profile, taskRole, config) 分配得分计算
    - 实现角色信誉替代逻辑（lowConfidence 时加权平均）
    - 实现 filterByReputationThreshold(candidates, threshold) 阈值过滤
    - 实现 filterByTaskforceRequirements(candidates, role) Taskforce 角色要求过滤
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [ ] 10.2 在 WorkflowEngine 中集成信誉因子
    - 在任务分配逻辑中调用 computeAssignmentScore
    - 在分配日志中记录 fitnessScore、reputationFactor、assignmentScore 和排名
    - 在 task.completed 事件处理中调用 ReputationService.handleTaskCompleted
    - _Requirements: 4.1, 4.5, 2.3_
  - [ ]* 10.3 编写属性测试：任务分配得分公式
    - **Property 8: 任务分配得分公式**
    - **Validates: Requirements 4.1**
  - [ ]* 10.4 编写属性测试：角色信誉替代与低置信度回退
    - **Property 9: 角色信誉替代与低置信度回退**
    - **Validates: Requirements 4.2**
  - [ ]* 10.5 编写属性测试：信誉阈值过滤
    - **Property 10: 信誉阈值过滤**
    - **Validates: Requirements 4.3, 4.4**

- [ ] 11. AgentDirectory 扩展
  - [ ] 11.1 扩展 AgentRegistry 添加 getReputation 方法
    - 在 server/core/registry.ts 中添加 getReputation(agentId) 方法
    - 委托给 ReputationService.getReputation
    - _Requirements: 1.5, 3.4_

- [ ] 12. REST API 与 WebSocket
  - [ ] 12.1 实现信誉 API 路由 `server/routes/reputation.ts`
    - GET /api/agents/:id/reputation — 返回完整 ReputationProfile
    - GET /api/admin/reputation/leaderboard — 排行榜（排序、分页、筛选）
    - POST /api/admin/reputation/:agentId/adjust — 手动调整
    - POST /api/admin/reputation/:agentId/reset — 重置
    - GET /api/admin/reputation/distribution — 分布直方图数据
    - GET /api/admin/reputation/trends — 趋势曲线数据
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 9.6_
  - [ ] 12.2 实现 WebSocket 信誉事件推送
    - 在 ReputationService 中信誉变动后通过 Socket.IO 推送 agent.reputationChanged
    - 在 TrustTierEvaluator 中层级变更后推送 agent.trustTierChanged
    - _Requirements: 5.5, 9.6_
  - [ ] 12.3 在 server/index.ts 中注册信誉路由
    - 挂载 /api/agents/:id/reputation 和 /api/admin/reputation/* 路由
    - _Requirements: 9.6_
  - [ ]* 12.4 编写属性测试：排行榜排序正确性
    - **Property 20: 排行榜排序正确性**
    - **Validates: Requirements 8.4**

- [ ] 13. Checkpoint - 确保 API 和集成测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. 前端信誉展示
  - [ ] 14.1 创建信誉相关 Zustand store `client/src/lib/reputation-store.ts`
    - 管理 Agent 信誉数据状态
    - 监听 WebSocket agent.reputationChanged 和 agent.trustTierChanged 事件
    - 提供 fetchReputation(agentId) 和 fetchLeaderboard() 方法
    - _Requirements: 9.1, 9.2, 9.3, 9.6_
  - [ ] 14.2 实现信誉等级徽章组件 `client/src/components/reputation/ReputationBadge.tsx`
    - 展示 S/A/B/C/D 等级徽章（不同颜色）和 trusted/standard/probation 标签
    - _Requirements: 9.1_
  - [ ] 14.3 实现五维信誉雷达图组件 `client/src/components/reputation/ReputationRadar.tsx`
    - 使用 Canvas 或 SVG 绘制五维雷达图
    - _Requirements: 9.2_
  - [ ] 14.4 实现信誉时序曲线和变更记录组件 `client/src/components/reputation/ReputationHistory.tsx`
    - 展示最近 30 天 overallScore 走势曲线
    - 展示最近 50 条 ReputationChangeEvent 列表
    - _Requirements: 9.2, 9.3_
  - [ ] 14.5 在 Agent 列表和详情面板中集成信誉组件
    - Agent 列表页添加 ReputationBadge
    - Agent 详情面板添加 ReputationRadar 和 ReputationHistory
    - _Requirements: 9.1, 9.2, 9.3_

- [ ] 15. 3D 场景信誉视觉效果
  - [ ] 15.1 在 Scene3D 中为 Agent 添加信誉视觉标识
    - S/A 等级 Agent 添加金色/银色光环效果
    - D 等级 Agent 添加警告色标识
    - _Requirements: 9.4_
  - [ ] 15.2 在工作流面板任务分配视图中展示信誉信息
    - 候选 Agent 旁展示 ReputationBadge 和 assignmentScore 分解
    - _Requirements: 9.5_

- [ ] 16. 模块导出与初始化
  - [ ] 16.1 创建模块入口 `server/core/reputation/index.ts`
    - 导出 ReputationService 单例
    - 导出 DecayScheduler 单例
    - 在服务启动时初始化信誉服务和衰减调度器
    - _Requirements: 2.3, 6.1_
  - [ ] 16.2 在现有 Agent 注册流程中初始化信誉档案
    - 内部 Agent 注册时调用 initializeProfile(agentId, false)
    - 外部 Agent 注册时调用 initializeProfile(agentId, true)
    - _Requirements: 1.3, 1.4_

- [ ] 17. Final checkpoint - 确保所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check
- Unit tests validate specific examples and edge cases using Vitest
- 所有信誉核心逻辑集中在 `server/core/reputation/` 目录下
- 前端组件集中在 `client/src/components/reputation/` 目录下
