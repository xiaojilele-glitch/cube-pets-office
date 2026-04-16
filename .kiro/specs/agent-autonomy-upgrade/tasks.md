# 实现计划：Agent 自治能力升级

## 概述

基于设计文档，将 Agent 自治能力升级分为 8 个主要阶段实施。从共享类型和基础工具开始，逐步构建能力画像、自评估、智能分配、竞争执行、裁判评选、临时工作组、成本监控，最后集成到现有工作流引擎和前端。每个阶段包含实现任务和对应的属性测试。

## 任务

- [x] 1. 共享类型定义与基础工具
  - [x] 1.1 创建 `shared/autonomy-types.ts`，定义所有自治能力相关类型：CapabilityProfile、ResourceQuota、TaskHistoryEntry、AssessmentDecision、AssessmentResult、AssessmentWeights、AllocationStrategy、AllocationDecision、CompetitionSession、ContestantEntry、JudgingResult、JudgingScore、CompetitionCost、TaskforceSession、TaskforceMember、RecruitmentManifest、SubTask、TaskforceMessageType、AutonomyConfig、AutonomyData
    - 类型定义参照设计文档"组件与接口"第 1 节
    - _Requirements: 1.1, 2.2, 2.4, 2.6, 4.1, 5.1, 6.5, 7.7, 8.5_
  - [x] 1.2 创建 `shared/ring-buffer.ts`，实现泛型 RingBuffer 类：push、toArray、length、toJSON、fromJSON
    - 固定容量环形缓冲区，支持序列化往返
    - _Requirements: 1.4_
  - [x] 1.3 编写 RingBuffer 属性测试
    - **Property 30: RingBuffer 往返一致性**
    - **Validates: Requirements 1.4, 1.8**

- [x] 2. CapabilityProfileManager 实现
  - [x] 2.1 创建 `server/core/capability-profile-manager.ts`，实现 CapabilityProfileManager 类：getProfile、initProfile、updateSkillAfterTask（EMA 公式 alpha=0.1）、incrementLoad、decrementLoad、recalculateConfidence、applySkillDecay、applyCompetitionReward、serialize、deserialize
    - 内存中维护 Map<string, CapabilityProfile>
    - initProfile 设置 confidenceScore=0.5、needsReview=true
    - 技能衰减公式：skill \* (0.95 ^ weeksInactive)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_
  - [x] 2.2 编写 CapabilityProfile 结构完整性属性测试
    - **Property 1: CapabilityProfile 结构完整性**
    - **Validates: Requirements 1.1, 1.7**
  - [x] 2.3 编写 EMA 技能更新属性测试
    - **Property 2: EMA 技能更新公式正确性**
    - **Validates: Requirements 1.2**
  - [x] 2.4 编写 loadFactor 不变量属性测试
    - **Property 3: loadFactor 不变量**
    - **Validates: Requirements 1.3**
  - [x] 2.5 编写 confidenceScore RingBuffer 计算属性测试
    - **Property 4: confidenceScore 基于 RingBuffer 计算**
    - **Validates: Requirements 1.4**
  - [x] 2.6 编写新 Agent 初始化属性测试
    - **Property 5: 新 Agent 初始化不变量**
    - **Validates: Requirements 1.5**
  - [x] 2.7 编写技能衰减属性测试
    - **Property 6: 技能衰减公式正确性**
    - **Validates: Requirements 1.6**

- [x] 3. SelfAssessment 模块实现
  - [x] 3.1 创建 `server/core/self-assessment.ts`，实现 SelfAssessment 类：assess、coarseFilter、computeSkillMatch（加权余弦相似度）、computeFitnessScore、makeDecision、generateReferralList
    - coarseFilter 做 specializationTags 与 requiredSkills 交集检查
    - fitnessScore = w1*skillMatch + w2*(1-loadFactor) + w3*confidence + w4*resource
    - 决策阈值：>=0.8 ACCEPT, 0.6-0.8 CAVEAT, 0.4-0.6 ASSIST, <0.4 REJECT
    - referralList 最多 3 个，按 fitnessScore 降序
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - [x] 3.2 编写粗筛匹配属性测试
    - **Property 7: 粗筛匹配正确性**
    - **Validates: Requirements 2.1**
  - [x] 3.3 编写 fitnessScore 加权求和属性测试
    - **Property 8: fitnessScore 加权求和正确性**
    - **Validates: Requirements 2.2**
  - [x] 3.4 编写余弦相似度属性测试
    - **Property 9: 余弦相似度数学性质**
    - **Validates: Requirements 2.3**
  - [x] 3.5 编写决策阈值属性测试
    - **Property 10: 决策阈值正确性**
    - **Validates: Requirements 2.4**
  - [x] 3.6 编写推荐列表属性测试
    - **Property 11: 推荐列表长度限制**
    - **Validates: Requirements 2.5**

- [x] 4. Checkpoint - 基础模块验证
  - 确保所有测试通过，如有问题请咨询用户。

- [x] 5. TaskAllocator 实现
  - [x] 5.1 创建 `server/core/task-allocator.ts`，实现 TaskAllocator 类：allocateTask、broadcastAssessment（并行评估 + 200ms 超时）、selectBestAgent（优先级排序）、forceAssign（兜底策略）、updateRejectRate（滑动窗口 50 次）、checkRejectRateAlert（60% 阈值）
    - 集成 SelfAssessment 和 CapabilityProfileManager
    - 超时未响应视为 REJECT
    - 全部 REJECT 时按推荐频次最高者 FORCE_ASSIGN
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x] 5.2 编写候选 Agent 筛选属性测试
    - **Property 12: 候选 Agent 筛选正确性**
    - **Validates: Requirements 3.1**
  - [x] 5.3 编写分配优先级属性测试
    - **Property 13: 分配优先级与兜底策略**
    - **Validates: Requirements 3.3, 3.4**
  - [x] 5.4 编写拒绝率滑动窗口属性测试
    - **Property 14: 拒绝率滑动窗口告警**
    - **Validates: Requirements 3.5**

- [x] 6. CompetitionEngine 与 JudgeAgent 实现
  - [x] 6.1 创建 `server/core/competition-engine.ts`，实现 CompetitionEngine 类：shouldTrigger（四条件判定）、computeUncertainty、selectContestants（多样性优先）、runCompetition、checkDataSecurity
    - 触发条件：critical priority / high quality / uncertainty > 0.7 / 手动指定
    - 多样性选择：种子为最高 fitness，后续最大余弦距离且 fitness >= 0.5
    - deadline = min(estimatedDurationMs \* 1.5, maxDeadlineMs)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [x] 6.2 创建 `server/core/judge-agent.ts`，实现 JudgeAgent 类：judge、verifyCorrectness、llmReview（匿名评审）、computeEfficiency、computeWeightedScores、checkMergeRequired（差距 < 5%）、onJudgmentOverridden
    - 四维度权重：correctness 0.35, quality 0.30, efficiency 0.20, novelty 0.15
    - 匿名评审去掉 Agent 标识
    - 第 1 名 rewardDelta=0.05，末位 penaltyDelta=0.03
    - judgeConfidenceScore 推翻时 -0.1，低于 0.5 触发告警
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - [x] 6.3 编写竞争触发条件属性测试
    - **Property 15: 竞争模式触发条件**
    - **Validates: Requirements 4.1**
  - [x] 6.4 编写竞争预算检查属性测试
    - **Property 16: 竞争预算检查**
    - **Validates: Requirements 4.2, 8.2**
  - [x] 6.5 编写多样性参赛者选择属性测试
    - **Property 17: 多样性优先参赛者选择**
    - **Validates: Requirements 4.3**
  - [x] 6.6 编写外部 Agent 安全校验属性测试
    - **Property 18: 外部 Agent 安全校验**
    - **Validates: Requirements 4.4**
  - [x] 6.7 编写 deadline 计算属性测试
    - **Property 19: 竞争 deadline 计算**
    - **Validates: Requirements 4.6**
  - [x] 6.8 编写裁判加权评分属性测试
    - **Property 20: 裁判加权评分公式**
    - **Validates: Requirements 5.1**
  - [x] 6.9 编写竞争结果能力回写属性测试
    - **Property 21: 竞争结果能力画像回写**
    - **Validates: Requirements 5.4**
  - [x] 6.10 编写 Judge 置信度下调属性测试
    - **Property 22: Judge 置信度下调**
    - **Validates: Requirements 5.5**
  - [x] 6.11 编写合并触发条件属性测试
    - **Property 23: 合并触发条件**
    - **Validates: Requirements 5.7**

- [x] 7. Checkpoint - 竞争执行模块验证
  - 确保所有测试通过，如有问题请咨询用户。

- [x] 8. TaskforceManager 实现
  - [x] 8.1 创建 `server/core/taskforce-manager.ts`，实现 TaskforceManager 类：formTaskforce、electLead、processApplications、handleHeartbeat、checkOfflineMembers、dissolveTaskforce、getActiveTaskforces
    - Lead 选举：fitnessScore 最高者
    - 应征条件：fitnessScore >= 0.5 且 loadFactor < 0.8
    - 角色：lead / worker / reviewer，可兼任
    - 心跳间隔 30s，连续 3 次未收到视为离线
    - 解散时注销 taskforceId，归档日志
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_
  - [x] 8.2 编写 Lead 选举属性测试
    - **Property 24: Lead 选举正确性**
    - **Validates: Requirements 6.1**
  - [x] 8.3 编写应征资格属性测试
    - **Property 25: 应征资格条件**
    - **Validates: Requirements 6.3**
  - [x] 8.4 编写 Taskforce 角色约束属性测试
    - **Property 26: Taskforce 角色约束**
    - **Validates: Requirements 6.5**
  - [x] 8.5 编写心跳离线检测属性测试
    - **Property 27: 心跳离线检测**
    - **Validates: Requirements 6.7**

- [x] 9. CostMonitor 实现
  - [x] 9.1 创建 `server/core/cost-monitor.ts`，实现 CostMonitor 类：checkCompetitionBudget、recordCompetitionCost、computeROI、getMetrics、isCompetitionDisabled
    - 预算检查：estimatedTokens > remainingBudget \* budgetRatio 时拒绝
    - ROI = winnerQuality / normalEstimate，< 1.0 触发告警
    - Prometheus 指标：assessment_duration_ms、competition_trigger_total、winner_quality_score、taskforce_formation_total、taskforce_duration_seconds
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [x] 9.2 编写 ROI 计算与告警属性测试
    - **Property 28: 竞争 ROI 计算与告警**
    - **Validates: Requirements 8.1**

- [x] 10. Checkpoint - 全部核心模块验证
  - 确保所有测试通过，如有问题请咨询用户。

- [x] 11. 工作流引擎集成与全局开关
  - [x] 11.1 修改 `server/core/workflow-engine.ts`，在 planning 阶段集成 TaskAllocator：当 autonomy.enabled 为 true 时使用智能分配，否则使用原有静态分配逻辑
    - 在 runPlanning 中注入 TaskAllocator
    - 竞争模式触发时调用 CompetitionEngine
    - REQUEST_ASSIST 时调用 TaskforceManager
    - _Requirements: 3.1, 3.3, 4.1, 6.1, 8.5_
  - [x] 11.2 修改 `server/core/mission-orchestrator.ts`，集成 autonomy 数据：将 AssessmentResult、CompetitionSession、TaskforceSession 写入 Mission 原生数据源
    - 扩展 MissionRecord 的 results 字段，添加 autonomy 子结构
    - _Requirements: 1.8, 5.3, 5.6, 6.8_
  - [x] 11.3 修改 `server/routes/workflows.ts`，在 GET /api/workflows/:id 响应中添加 results.autonomy 字段，包含 assessments、competitions、taskforces 子结构
    - _Requirements: 7.7_
  - [x] 11.4 创建 AutonomyConfig 配置加载逻辑，从 .env 读取 autonomy.enabled 等配置项，支持全局开关
    - _Requirements: 8.5_
  - [x] 11.5 编写全局开关回退属性测试
    - **Property 29: 全局开关回退**
    - **Validates: Requirements 8.5**

- [x] 12. 前端自治能力状态展示
  - [x] 12.1 创建 `client/src/lib/autonomy-store.ts`，实现 Zustand store：管理 assessments、competitions、taskforces 状态，监听 Socket.IO 事件（autonomy_assessment、autonomy_competition、autonomy_taskforce）
    - _Requirements: 7.1, 7.2, 7.4, 7.5_
  - [x] 12.2 扩展 `client/src/components/WorkflowPanel.tsx`，添加自治能力面板：Agent 分配过程展示（候选列表、fitnessScore、决策结果）、裁判评选雷达图、Taskforce 成员拓扑图
    - _Requirements: 7.1, 7.3, 7.4_
  - [x] 12.3 扩展 `server/core/socket.ts`，添加 autonomy 相关事件广播：autonomy_assessment（自评估完成）、autonomy_competition_progress（竞争进度）、autonomy_competition_result（评选结果）、autonomy_taskforce_update（工作组状态变更）
    - _Requirements: 7.5_
  - [x] 12.4 在 WorkflowPanel 的自治决策节点添加"介入"按钮，点击后进入人机协作审批流，允许用户覆盖系统决策
    - 复用现有 human-in-the-loop 的 decision 机制
    - _Requirements: 7.6_

- [x] 13. Final Checkpoint - 全部功能集成验证
  - 确保所有测试通过，如有问题请咨询用户。

## 备注

- 标记 `*` 的任务为可选测试任务，可跳过以加速 MVP 开发
- 每个任务引用了具体的需求编号以确保可追溯性
- Checkpoint 任务确保增量验证
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
- 前端可视化（需求 7.2 的 SwarmViz 3D 竞争进度）需要手动视觉验证，不包含在自动化测试中
