# 需求文档

## 简介

Agent 信誉系统模块为 Cube Brain 平台中的所有 Agent（包括动态组织生成物化的内部 Agent 和通过 A2A 协议网关 / Guest Agent 注册表接入的外部 Agent）建立统一的信誉评分机制。信誉分基于任务完成质量、响应速度、资源消耗、协作表现和可靠性等多维度持续计算，编排器在任务分配时将信誉分作为核心权重因子，优先将任务派发给高信誉 Agent。本模块与自评估机制协同工作——自评估回答"我能不能干"，信誉系统回答"它干得好不好"；与动态角色系统协同——信誉分按角色维度细分，同一 Agent 在不同角色下拥有独立的信誉档案。

## 术语表

- **ReputationProfile（信誉档案）**: Agent 的完整信誉数据结构，包含综合信誉分、五个维度子分、角色信誉映射和元数据
- **ReputationUpdateWorker（信誉更新工作器）**: 异步事件驱动的信誉更新处理器，监听 task.completed 事件并计算信誉变动
- **ReputationChangeEvent（信誉变更事件）**: 每次信誉变动生成的审计记录，包含变动维度、变动值和触发原因
- **RoleReputationRecord（角色信誉记录）**: 按角色维度独立维护的信誉数据，结构与整体信誉相同
- **TrustTier（信任层级）**: 基于信誉等级的粗粒度准入控制层级，分为 trusted、standard、probation 三级
- **TrustTierEvaluator（信任层级评估器）**: 在每次信誉更新后自动执行信任层级升降判定的组件
- **ReputationGrade（信誉等级）**: 将连续信誉分映射为离散等级（S/A/B/C/D）的分类机制
- **AgentDirectory（智能体注册表）**: server/core/registry.ts 中管理所有 Agent 实例的注册中心
- **WorkflowEngine（工作流引擎）**: server/core/workflow-engine.ts 中的十阶段工作流执行引擎
- **Mission_Orchestrator（Mission 编排器）**: server/core/mission-orchestrator.ts 中的任务编排组件
- **Exponential_Moving_Average（指数移动平均）**: 一种加权移动平均算法，近期数据权重更高，用于平滑信誉更新
- **Anomaly_Detector（异常检测器）**: 检测信誉分异常波动和恶意刷分行为的安全组件
- **Reputation_Audit_Log（信誉审计日志）**: 独立存储异常检测结果和防刷措施触发记录的安全审计日志

## 需求

### 需求 1：多维信誉评分模型

**用户故事：** 作为系统，我需要为每个 Agent 计算一个综合信誉分和多个维度子分，这样编排器和用户可以从不同角度评估 Agent 的可靠程度。

#### 验收标准

1. THE ReputationProfile SHALL 包含 overallScore（综合信誉分，整数 0-1000）和五个维度子分：qualityScore（任务完成质量，0-1000）、speedScore（响应速度与时效性，0-1000）、efficiencyScore（资源消耗效率，0-1000）、collaborationScore（协作表现，0-1000）、reliabilityScore（可靠性与稳定性，0-1000）
2. THE ReputationProfile SHALL 通过加权公式计算 overallScore：quality * 0.30 + speed * 0.15 + efficiency * 0.20 + collaboration * 0.15 + reliability * 0.20，权重可通过配置中心 reputation.weights 动态调整
3. WHEN 一个内部 Agent 首次注册时，THE ReputationProfile SHALL 将 overallScore 初始化为 500，各维度子分均初始化为 500
4. WHEN 一个外部 Agent 通过 Guest Agent 注册表接入时，THE ReputationProfile SHALL 将 overallScore 初始化为 400，各维度子分均初始化为 400，trustTier 标记为 "probation"
5. WHEN 调用 AgentDirectory.getReputation(agentId) 时，THE AgentDirectory SHALL 返回该 Agent 的完整 ReputationProfile
6. THE ReputationProfile SHALL 使用整数精度（0-1000）存储所有信誉分，避免浮点精度问题

### 需求 2：基于任务结果实时更新信誉分

**用户故事：** 作为系统，每次任务完成后，我需要根据任务的实际表现数据更新执行 Agent 的信誉分，这样信誉分始终反映 Agent 的最新状态而非历史快照。

#### 验收标准

1. WHEN 任务完成后，THE ReputationUpdateWorker SHALL 采集以下原始信号：taskQualityScore（0-100）、actualDurationMs、estimatedDurationMs、tokenConsumed、tokenBudget、wasRolledBack（布尔值）、downstreamFailures（整数）、collaborationRating（0-100，仅 Taskforce 场景）
2. WHEN 更新 qualityScore 时，THE ReputationUpdateWorker SHALL 基于 taskQualityScore 使用指数移动平均算法（alpha=0.15）计算新值；WHEN 更新 speedScore 时，THE ReputationUpdateWorker SHALL 基于 actualDurationMs / estimatedDurationMs 的比值线性映射（比值 <= 1.0 得 1000 分，>= 2.0 得 0 分，中间线性插值）；WHEN 更新 efficiencyScore 时，THE ReputationUpdateWorker SHALL 基于 tokenConsumed / tokenBudget 的比值线性映射（同理）；WHEN 存在 collaborationRating 时，THE ReputationUpdateWorker SHALL 基于 collaborationRating 使用指数移动平均算法（alpha=0.2）更新 collaborationScore；WHEN wasRolledBack 为 true 时，THE ReputationUpdateWorker SHALL 对 reliabilityScore 扣除 30 分；WHEN downstreamFailures > 0 时，THE ReputationUpdateWorker SHALL 对 reliabilityScore 每个下游失败扣除 15 分；WHEN 任务成功且无回滚时，THE ReputationUpdateWorker SHALL 对 reliabilityScore 恢复 5 分
3. WHEN task.completed 事件触发时，THE ReputationUpdateWorker SHALL 异步处理信誉更新，更新操作不阻塞主工作流
4. WHEN 计算维度子分变动时，THE ReputationUpdateWorker SHALL 将任意维度的单次变动幅度限制在 maxDeltaPerUpdate（默认 50 分）以内
5. WHEN 信誉变动完成后，THE ReputationUpdateWorker SHALL 生成 ReputationChangeEvent，包含 agentId、taskId、dimensionDeltas（各维度变动值）、newOverallScore 和 reason，写入 Mission 原生数据源

### 需求 3：信誉分按角色维度细分

**用户故事：** 作为系统，我需要为每个 Agent 按角色维度独立维护信誉分，这样编排器可以区分"这个 Agent 做 Coder 信誉很高但做 Reviewer 信誉一般"的情况。

#### 验收标准

1. THE ReputationProfile SHALL 包含 roleReputation 字段，类型为 Map<roleId, RoleReputationRecord>，每个 RoleReputationRecord 包含 overallScore 和五个维度子分
2. WHEN 任务完成后，THE ReputationUpdateWorker SHALL 根据 Agent 当时的 currentRoleId 更新对应的 RoleReputationRecord，同时更新 Agent 整体的 ReputationProfile
3. WHILE Agent 以某角色执行的累计任务数 totalTasksInRole < 10，THE ReputationProfile SHALL 将该角色的信誉数据标记为 lowConfidence: true，编排器使用该角色信誉分时乘以 0.6 的衰减系数，并将整体信誉分作为补充参考
4. WHEN 调用 AgentDirectory.getReputation(agentId).byRole(roleId) 时，THE AgentDirectory SHALL 返回该 Agent 在指定角色下的 RoleReputationRecord

### 需求 4：编排器基于信誉分加权分配任务

**用户故事：** 作为工作流引擎，在任务分配时，我需要将 Agent 的信誉分纳入分配决策的核心权重，这样高信誉 Agent 获得更多高价值任务，低信誉 Agent 逐步被边缘化或淘汰。

#### 验收标准

1. WHEN 工作流引擎分配任务时，THE WorkflowEngine SHALL 使用公式 assignmentScore = fitnessScore * 0.6 + reputationFactor * 0.4 计算分配得分，其中 reputationFactor = agent.overallScore / 1000，权重比例可通过配置中心 scheduling.reputationWeight 调整
2. WHEN 任务具有角色信息（task.requiredRole）时，THE WorkflowEngine SHALL 使用对应 roleReputation 的分数替代整体 overallScore；WHILE 角色信誉标记为 lowConfidence 时，THE WorkflowEngine SHALL 按衰减后的角色信誉 * 0.4 + 整体信誉 * 0.6 取加权平均
3. WHEN 竞争执行模式选择参赛者时，THE WorkflowEngine SHALL 要求所有参赛者的 overallScore >= competition.minReputationThreshold（默认 300），低于阈值的 Agent 不允许参赛
4. WHEN 组建 Taskforce 时，THE WorkflowEngine SHALL 要求 Lead 角色 overallScore >= 600，Worker 角色 overallScore >= 300，Reviewer 角色 qualityScore >= 500
5. WHEN 完成任务分配后，THE WorkflowEngine SHALL 在分配日志中记录每个候选 Agent 的 fitnessScore、reputationFactor、assignmentScore 和最终排名

### 需求 5：信誉等级与信任层级

**用户故事：** 作为系统，我需要将连续的信誉分映射为离散的信誉等级和信任层级，这样可以基于等级做粗粒度的准入控制和权限管理。

#### 验收标准

1. THE ReputationProfile SHALL 将 overallScore 映射为五级信誉等级：S（900-1000，卓越）、A（700-899，优秀）、B（500-699，合格）、C（300-499，待改进）、D（0-299，不合格），等级边界值可通过配置中心调整
2. THE ReputationProfile SHALL 将信誉等级映射为三级信任层级：trusted（等级 S 或 A，可执行敏感任务、担任 Lead、参与竞争评审）、standard（等级 B，可执行普通任务、担任 Worker）、probation（等级 C 或 D，仅可执行低风险任务、产出强制进入 review 流程）
3. WHEN 外部 Agent 首次接入时，THE TrustTierEvaluator SHALL 将其固定为 probation；WHEN 外部 Agent 累计完成 20 个任务且 overallScore >= 500 时，THE TrustTierEvaluator SHALL 自动升级为 standard；WHEN 外部 Agent 累计完成 50 个任务且 overallScore >= 700 时，THE TrustTierEvaluator SHALL 自动升级为 trusted
4. WHEN Agent 的信誉等级从高降到低时，THE TrustTierEvaluator SHALL 触发 REPUTATION_DOWNGRADE 事件，记录降级原因和触发任务；WHEN 降到 D 级时，THE TrustTierEvaluator SHALL 触发 AGENT_REPUTATION_CRITICAL 告警
5. WHEN 信任层级变更时，THE System SHALL 通过 WebSocket 推送 agent.trustTierChanged 事件，前端实时更新 Agent 标识

### 需求 6：信誉衰减与恢复机制

**用户故事：** 作为系统，我需要对长期不活跃的 Agent 进行信誉衰减，对持续表现良好的 Agent 给予信誉恢复加速，这样信誉分反映的是 Agent 的当前能力而非历史巅峰。

#### 验收标准

1. WHILE Agent 连续 inactivityDecayDays（默认 14 天）未执行任何任务，THE ReputationProfile SHALL 以 decayRate（默认 10 分/周）衰减 overallScore，衰减下限为 decayFloor（默认 300 分）
2. WHEN 信誉衰减发生时，THE ReputationProfile SHALL 仅衰减 overallScore，各维度子分保持不变
3. WHEN Agent 恢复活跃（重新完成任务）后，THE ReputationProfile SHALL 立即停止衰减，后续按正常更新规则恢复信誉
4. WHEN Agent 连续 10 次任务的 taskQualityScore >= 80 时，THE ReputationUpdateWorker SHALL 触发"连胜加速"，将后续信誉更新的 alpha 值临时提升为 alpha * 1.5；WHEN 连续记录断裂后，THE ReputationUpdateWorker SHALL 恢复正常 alpha 值
5. WHEN 衰减或连胜加速事件发生时，THE ReputationUpdateWorker SHALL 生成 ReputationChangeEvent，reason 分别标记为 "inactivity_decay" 和 "streak_bonus"

### 需求 7：信誉异常检测与防刷机制

**用户故事：** 作为系统，我需要检测和防范信誉分的异常波动和恶意刷分行为，这样信誉系统的可信度不会被破坏。

#### 验收标准

1. WHEN Agent 在 24 小时内信誉分变动超过 anomalyThreshold（默认 200 分）时，THE Anomaly_Detector SHALL 触发 REPUTATION_ANOMALY 告警，暂停该 Agent 的信誉更新；WHEN 运维人员审核通过后，THE Anomaly_Detector SHALL 恢复更新；WHEN 审核拒绝时，THE Anomaly_Detector SHALL 回滚到异常前的信誉快照
2. WHEN Agent 短时间内大量完成低复杂度任务（task.complexity: low 占比 > 80% 且 24 小时内完成数 > 30）时，THE Anomaly_Detector SHALL 对这些低复杂度任务的信誉更新权重降低为 lowComplexityWeight（默认 0.3）
3. WHEN 在 Taskforce 场景中两个 Agent 互相给出的 collaborationRating 持续高于 90 且与其他成员评分偏差 > 20 时，THE Anomaly_Detector SHALL 触发 COLLAB_RATING_SUSPICIOUS 告警，将可疑评分在信誉计算中降权为 0.5
4. WHILE 外部 Agent 处于 probation 阶段，THE ReputationUpdateWorker SHALL 对正向信誉更新额外施加 probationDamping（默认 0.7）系数
5. WHEN 异常检测或防刷措施触发时，THE Anomaly_Detector SHALL 将记录写入独立的 reputation_audit_log，与常规信誉变更日志分开存储

### 需求 8：信誉数据的可观测性与运维工具

**用户故事：** 作为运维人员，我需要对信誉系统的运行状况进行全面监控，这样可以及时发现评分异常、参数配置不合理等问题。

#### 验收标准

1. THE System SHALL 暴露以下 Prometheus 指标：agent_reputation_overall（按 agentId 分组的当前综合信誉分 gauge）、agent_reputation_by_dimension（按 agentId + dimension 分组的维度子分 gauge）、reputation_update_total（信誉更新总次数 counter）、reputation_update_duration_ms（信誉更新耗时 histogram）、reputation_anomaly_total（异常检测触发次数 counter）、trust_tier_distribution（各信任层级的 Agent 数量 gauge）
2. WHEN 收到 POST /api/admin/reputation/:agentId/adjust 请求时，THE System SHALL 根据请求体中的 dimension、delta 和 reason 手动调整信誉分，调整记录写入 reputation_audit_log
3. WHEN 收到 POST /api/admin/reputation/:agentId/reset 请求时，THE System SHALL 将指定 Agent 的信誉重置为初始值（内部 Agent 重置为 500，外部 Agent 重置为 400）
4. WHEN 收到 GET /api/admin/reputation/leaderboard 请求时，THE System SHALL 返回信誉排行榜，支持按 overallScore、各维度子分和 roleId 排序，支持分页和 trustTier 筛选
5. THE System SHALL 提供信誉分布直方图数据（全局 Agent 池的信誉分布情况）和信誉趋势曲线数据（按单个 Agent 或 trustTier 分组的历史走势）

### 需求 9：前端展示信誉信息

**用户故事：** 作为用户，我希望在前端直观地看到每个 Agent 的信誉等级、维度明细和信誉变化趋势，这样我可以评估 Agent 的可信赖程度并在必要时介入调整。

#### 验收标准

1. WHEN 展示 Agent 列表时，THE Frontend SHALL 为每个 Agent 展示信誉等级徽章（S/A/B/C/D，不同等级不同颜色）和信任层级标签（trusted/standard/probation）
2. WHEN 展示 Agent 详情面板时，THE Frontend SHALL 展示五维信誉雷达图（quality、speed、efficiency、collaboration、reliability）和信誉分时序曲线（最近 30 天的 overallScore 走势）
3. WHEN 展示 Agent 详情面板时，THE Frontend SHALL 展示信誉变更记录列表（最近 50 条 ReputationChangeEvent），每条包含触发任务、维度变动值和变动原因
4. WHEN 渲染 3D 场景中的 Agent 时，THE Scene3D SHALL 为信誉等级 S 和 A 的 Agent 添加金色/银色光环效果，为等级 D 的 Agent 添加警告色标识
5. WHEN 展示工作流面板的任务分配视图时，THE Frontend SHALL 在每个候选 Agent 旁展示信誉等级徽章和 assignmentScore 分解（fitnessScore 贡献 + reputationFactor 贡献）
6. WHEN 调用 GET /api/agents/:id/reputation 时，THE Server SHALL 返回完整 ReputationProfile；WHEN 信誉变动发生时，THE Server SHALL 通过 WebSocket 推送 agent.reputationChanged 事件
