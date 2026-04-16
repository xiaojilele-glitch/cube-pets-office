# 需求文档：Agent 自治能力升级

## 简介

Agent 自治能力升级模块为 Cube Brain 平台的 Swarm 编排器引入三项核心能力：Agent 自评估机制（Self-Assessment）、Agent 竞争执行机制（Competitive Execution）、动态协作网络（Dynamic Collaboration）。目标是将 Agent 从被动的任务接收者演化为具备自我认知、主动决策和竞争择优能力的自治智能体。本模块与现有的动态组织生成模块协同工作——动态组织生成负责"建队"，自治能力升级负责让队伍里的每个成员"更聪明地干活"。

## 术语表

- **CapabilityProfile**: Agent 能力画像数据结构，包含技能向量、负载率、置信度、资源配额、擅长领域标签和分类别平均耗时
- **skillVector**: Map<string, float> 类型，记录 Agent 在各技能类别上的熟练度（0.0-1.0）
- **loadFactor**: float 类型，Agent 当前负载率，计算公式为 activeTasks / maxConcurrentTasks
- **confidenceScore**: float 类型，Agent 综合置信度，基于最近 100 次任务的成功率和质量分加权计算
- **fitnessScore**: float 类型，Agent 对特定任务的胜任度评分，基于技能匹配度、负载率、置信度和资源充足度加权计算
- **TaskRequest**: 工作流引擎分派给 Agent 的任务请求对象
- **AgentDirectory**: Agent 注册表，管理所有 Agent 实例及其能力画像
- **RingBuffer**: 固定大小的环形缓冲区，用于存储最近 N 次任务记录
- **Taskforce**: 临时工作组，由多个互补 Agent 协作完成复杂任务，完成后自动解散
- **RecruitmentManifest**: Lead Agent 发布的招募清单，包含所需技能、预估工作量和截止时间
- **Judge_Agent**: 裁判 Agent，负责对竞争执行结果进行多维度评分和排名
- **TelemetryOverlay**: 遥测叠加层，在 3D 场景中展示实时运行数据
- **SwarmViz**: 3D 场景中的 Swarm 可视化模块
- **Mission**: Cube Brain 平台的任务域概念，包含完整的任务生命周期
- **EMA**: 指数移动平均（Exponential Moving Average），用于平滑更新技能评分

## 需求

### 需求 1：Agent 维护实时能力画像

**用户故事：** 作为系统，我需要为每个 Agent（包括动态组织生成物化的节点和通过 Guest Agent 注册表接入的外部 Agent）维护一份实时更新的能力画像（CapabilityProfile），这样编排器和 Agent 自身都能基于准确的能力数据做出决策。

#### 验收标准

1. THE AgentDirectory SHALL 为每个 Agent 维护 CapabilityProfile 数据结构，包含 skillVector（Map<string, float>，技能类别及熟练度 0.0-1.0）、loadFactor（float，当前负载率）、confidenceScore（float，综合置信度）、resourceQuota（剩余 token 预算 / 内存 / CPU 配额）、specializationTags（string[]，擅长领域标签）、avgLatencyMs（Map<string, int>，分类别平均完成耗时）
2. WHEN 任务完成时，THE AgentDirectory SHALL 基于质量评分自动更新 skillVector，采用指数移动平均公式：newSkill = alpha _ taskQuality + (1 - alpha) _ oldSkill，其中 alpha = 0.1
3. WHEN 任务开始或结束时，THE AgentDirectory SHALL 实时更新 loadFactor，公式为 activeTasks / maxConcurrentTasks，任务开始时递增、结束时递减
4. THE AgentDirectory SHALL 基于最近 100 次任务（RingBuffer）的成功率和质量分加权计算 confidenceScore
5. WHEN 新 Agent 注册时（含外部 Agent），THE AgentDirectory SHALL 设置初始 confidenceScore = 0.5，并在前 20 次任务中强制标记 needsReview: true
6. WHILE 某技能分类超过 30 天未执行相关任务时，THE AgentDirectory SHALL 按 5%/周 衰减对应 skillVector 值
7. WHEN 调用 AgentDirectory.getProfile(agentId) 时，THE AgentDirectory SHALL 返回完整 CapabilityProfile 对象
8. WHEN 能力画像发生变更时，THE AgentDirectory SHALL 将变更记录写入 Mission 原生数据源，支持历史回溯

### 需求 2：Agent 接收任务时进行自评估

**用户故事：** 作为 Agent，当我收到工作流引擎分派的 TaskRequest 时，我需要基于自身能力画像对任务进行胜任度评估，返回评估结果和决策，这样系统可以实现智能化的任务分配而不是盲目推送。

#### 验收标准

1. WHEN Agent 收到 TaskRequest 时，THE SelfAssessment_Module SHALL 首先执行粗筛匹配：将 task.requiredSkills 与 agent.specializationTags 做交集检查，交集为空则直接返回 REJECT，粗筛耗时低于 5ms
2. WHEN Agent 通过粗筛后，THE SelfAssessment_Module SHALL 计算 fitnessScore，公式为：fitness = w1 _ skillMatch + w2 _ (1 - loadFactor) + w3 _ confidenceScore + w4 _ resourceAdequacy，默认权重 w1=0.4, w2=0.2, w3=0.25, w4=0.15，权重可通过配置中心动态调整
3. WHEN 计算 skillMatch 时，THE SelfAssessment_Module SHALL 使用任务所需技能与 Agent skillVector 的加权余弦相似度
4. WHEN fitnessScore 计算完成后，THE SelfAssessment_Module SHALL 基于分数返回四种决策之一：ACCEPT（>= 0.8）、ACCEPT_WITH_CAVEAT（0.6-0.8，标记需 review）、REQUEST_ASSIST（0.4-0.6，请求协助）、REJECT_AND_REFER（< 0.4，拒绝并推荐更合适的 Agent 列表）
5. WHEN 决策为 REJECT_AND_REFER 时，THE SelfAssessment_Module SHALL 基于 AgentDirectory 的 Agent 注册表按 fitnessScore 降序排列生成推荐列表，最多返回 3 个候选
6. THE SelfAssessment_Module SHALL 在自评估结果中包含 fitnessScore、decision、reason（自然语言解释）、referralList（仅 REJECT_AND_REFER 时有值），完整结构记录到调试日志
7. THE SelfAssessment_Module SHALL 确保单次自评估总耗时低于 50ms（不含网络开销）

### 需求 3：编排器基于自评估结果智能分配任务

**用户故事：** 作为工作流引擎，我需要将 TaskRequest 广播给候选 Agent 池，收集自评估结果后做出最优分配决策，这样任务总是由最合适的 Agent 执行。

#### 验收标准

1. WHEN 工作流引擎发送 TaskRequest 时，THE TaskAllocator SHALL 从 AgentDirectory 筛选出 specializationTags 与任务有交集的候选 Agent 列表
2. WHEN 候选 Agent 列表确定后，THE TaskAllocator SHALL 并行向所有候选 Agent 发送评估请求，设置超时阈值 200ms，超时未响应的 Agent 视为 REJECT
3. WHEN 所有评估结果收集完成后，THE TaskAllocator SHALL 按以下优先级分配：优先选择 ACCEPT 且 fitnessScore 最高的 Agent；若无 ACCEPT，选择 ACCEPT_WITH_CAVEAT 中最高分者；若仅有 REQUEST_ASSIST，触发动态协作网络组建
4. IF 所有候选 Agent 均返回 REJECT，THEN THE TaskAllocator SHALL 执行兜底策略：按 REJECT_AND_REFER 中推荐频次最高的 Agent 进行 FORCE_ASSIGN（强制分配），并记录 forceAssignReason
5. WHILE Agent 连续拒绝率（滑动窗口 50 次）超过 60% 时，THE TaskAllocator SHALL 触发告警事件 AGENT_REJECT_RATE_HIGH，同时该 Agent 在后续分配中优先级权重降低 20%
6. WHEN 分配决策完成后，THE TaskAllocator SHALL 将完整决策过程（候选列表、各 Agent 评估结果、最终选择及原因）记录到 ExecutionPlan 调试日志

### 需求 4：高价值任务触发竞争执行模式

**用户故事：** 作为工作流引擎，对于高价值或高不确定性的任务，我需要同时派发给多个 Agent 并行执行，待完成后由裁判模块选出最优结果，这样关键任务的产出质量得到保障。

#### 验收标准

1. WHEN 任务满足以下任一条件时，THE CompetitionEngine SHALL 触发竞争模式：任务 priority 为 critical；任务 qualityRequirement 为 high；任务不确定性评分大于 0.7（基于该类型历史失败率 + 最佳候选 fitnessScore 的反数 + 任务描述模糊度的加权计算）；用户在人机协作审批流中手动指定
2. WHEN 竞争模式触发前，THE CompetitionEngine SHALL 进行预算检查：估算单次 token 消耗乘以参赛 Agent 数不超过 mission.remainingTokenBudget，预算不足时自动降级为普通模式或减少参赛数，降级原因记录到 competitionDegradationReason
3. THE CompetitionEngine SHALL 默认选择 3 个参赛 Agent（可配置 2-5），选择策略为多样性优先：先选 fitnessScore 最高者为种子，后续依次选择与已选集合 skillVector 余弦距离最大且 fitnessScore 大于等于 0.5 的 Agent
4. WHEN 通过 A2A 协议网关邀请外部 Agent 参赛时，THE CompetitionEngine SHALL 额外校验 dataSecurityLevel，敏感任务不允许外部 Agent 参赛
5. THE CompetitionEngine SHALL 确保所有参赛 Agent 在安全沙箱 Docker 执行器中获得独立容器，互不可见、互不干扰
6. THE CompetitionEngine SHALL 设置统一 deadline = task.estimatedDurationMs \* 1.5，上限由 competition.maxDeadlineMs 配置（默认 300000ms），超时未提交视为放弃
7. WHEN 竞争执行进行中时，THE CompetitionEngine SHALL 通过 TelemetryOverlay 在 3D 场景中展示实时进度

### 需求 5：裁判模块评选竞争结果

**用户故事：** 作为系统，当竞争执行的所有参赛者提交结果后，我需要通过多维度评分选出最优结果并反馈给所有参赛者，这样竞争机制形成闭环且持续优化 Agent 能力画像。

#### 验收标准

1. THE Judge_Agent SHALL 按四个维度评分：correctness（权重 0.35，通过预定义测试用例或约束条件自动验证）、quality（权重 0.30，由 Judge_Agent 使用高能力 LLM 匿名评审）、efficiency（权重 0.20，基于耗时 / token 消耗 / 资源占用归一化）、novelty（权重 0.15，方案间语义相似度取反）
2. THE Judge_Agent SHALL 依次执行评选流程：自动化验证过滤不合格结果 → LLM 匿名评审（去掉 Agent 标识）打分并输出排名理由 → 加权计算总分 → 选出 Top 1
3. THE Judge_Agent SHALL 在评审结果中包含 scores（各维度分数）、ranking、rationaleText（排名理由），完整结构记录到 Mission 原生数据源
4. WHEN 评选完成后，THE Judge_Agent SHALL 将排名结果回写到所有参赛 Agent 的 CapabilityProfile：第 1 名对应 skillVector 上浮 rewardDelta = 0.05，末位下调 penaltyDelta = 0.03，中间名次不调整
5. THE Judge_Agent SHALL 维护 judgeConfidenceScore，IF 评选结果被用户在审批流中推翻，THEN THE Judge_Agent SHALL 将 judgeConfidenceScore 下调 0.1，低于 0.5 时触发 JUDGE_RELIABILITY_LOW 告警
6. WHEN 评选完成后，THE Judge_Agent SHALL 将非最优竞争结果归档到 Mission 原生数据源，标注各维度得分；各方案的优点由 LLM 提取后作为知识条目写入三级记忆系统
7. IF 无明显胜出者（Top 1 与 Top 2 总分差小于 5%），THEN THE Judge_Agent SHALL 触发 MERGE_TASK，由高能力 Agent 融合多方案优点生成最终结果

### 需求 6：自评估返回 REQUEST_ASSIST 时自动组建临时工作组

**用户故事：** 作为系统，当 Agent 自评估返回 REQUEST_ASSIST 或任务被标记为 complexity: high 时，我需要自动组建一个临时工作组（Taskforce），由多个互补 Agent 协作完成任务，完成后自动解散。

#### 验收标准

1. WHEN Taskforce 组建时，THE TaskforceManager SHALL 选举 fitnessScore 最高的 Agent 为 Lead，负责任务分解和协调；若触发者即为最高分，则由其担任 Lead
2. WHEN Lead Agent 确定后，THE TaskforceManager SHALL 由 Lead 分析任务并生成 RecruitmentManifest（包含 requiredSkills、estimatedEffort、deadline），通过 A2A 协议网关广播给所有可用 Agent
3. WHEN Agent 收到招募广播后，THE TaskforceManager SHALL 要求收到广播的 Agent 执行自评估，fitnessScore 大于等于 0.5 且 loadFactor 小于 0.8 的 Agent 返回应征响应（含能力画像摘要和预估完成时间）
4. WHEN 应征响应收集完成后，THE TaskforceManager SHALL 由 Lead 从应征者中选择最优组合（优先技能互补性，其次负载均衡），确认后在编排器注册为 Taskforce，分配唯一 taskforceId
5. THE TaskforceManager SHALL 在工作组内定义角色为 Lead（协调 + 整合）、Worker（执行子任务）、Reviewer（交叉审查），一个 Agent 可兼任 Worker 和 Reviewer
6. THE TaskforceManager SHALL 确保成员通过基于 WebSocket Room 子房间的专用消息通道通信，消息类型包括 TASK_ASSIGN、PROGRESS_UPDATE、HELP_REQUEST、REVIEW_REQUEST、REVIEW_RESULT、MERGE_REQUEST
7. WHILE Taskforce 活跃期间，THE TaskforceManager SHALL 要求成员每 30 秒发送心跳，连续 3 次未收到则视为离线，Lead 将其未完成子任务重新分配给其他 Worker 或发起二次招募
8. WHEN 所有子任务完成且 Lead 确认合并后，THE TaskforceManager SHALL 自动解散 Taskforce，注销 taskforceId，将协作日志和产出归档到 Mission 原生数据源

### 需求 7：前端展示自治能力运行状态

**用户故事：** 作为用户，我希望在前端实时看到 Agent 的自评估决策过程、竞争执行进度和工作组协作状态，这样我可以理解系统的自治决策并在必要时介入。

#### 验收标准

1. WHEN 任务分配进行中时，THE WorkflowPanel SHALL 展示当前任务的 Agent 分配过程：候选列表、各 Agent 的 fitnessScore 和决策结果、最终分配结果
2. WHILE 竞争模式执行中时，THE SwarmViz SHALL 在 3D 场景中同时展示所有参赛 Agent 的执行进度条、已消耗 token 和中间产出预览
3. WHEN 裁判评选完成后，THE WorkflowPanel SHALL 展示各参赛者的维度得分雷达图和排名理由摘要
4. WHILE 工作组模式活跃时，THE WorkflowPanel SHALL 展示 Taskforce 成员拓扑图（Lead / Worker / Reviewer 关系）、子任务分配和完成状态
5. WHEN 自治决策事件发生时（自评估、竞争触发、裁判评选、工作组组建/解散），THE TelemetryOverlay SHALL 以事件流形式实时推送到前端
6. WHEN 用户点击任意自治决策节点的"介入"按钮时，THE WorkflowPanel SHALL 进入人机协作审批流，允许用户手动覆盖系统决策
7. WHEN 前端请求自治能力运行数据时，THE API_Server SHALL 通过 GET /api/workflows/:id 的 results.autonomy 字段返回数据，包含 assessments、competitions、taskforces 子结构

### 需求 8：自治能力的成本控制与可观测性

**用户故事：** 作为运维人员，我需要对自治能力模块的资源消耗进行监控和治理，这样竞争执行等高消耗模式不会导致成本失控。

#### 验收标准

1. WHEN 竞争执行完成后，THE CostMonitor SHALL 记录 competitionCost（所有参赛者 token 消耗总和）和 competitionROI（最终采纳结果质量分 / 普通模式预估质量分），IF ROI 小于 1.0，THEN THE CostMonitor SHALL 触发 COMPETITION_LOW_ROI 告警
2. THE CostMonitor SHALL 支持 Mission 级别配置 autonomy.competitionBudgetRatio（竞争模式允许占用的 token 预算比例，默认 30%），WHEN 超出时，THE CostMonitor SHALL 自动禁用竞争触发
3. THE CostMonitor SHALL 通过 Prometheus 监控暴露 Agent 自评估、竞争执行、裁判评选、工作组协作的关键指标，包括：agent_assessment_duration_ms（自评估耗时直方图）、competition_trigger_total（竞争触发次数）、competition_winner_quality_score（获胜方案质量分）、taskforce_formation_total（工作组组建次数）、taskforce_duration_seconds（工作组存续时间）
4. THE CostMonitor SHALL 聚合展示自治能力模块的整体 token 消耗趋势、竞争 ROI 趋势和 Agent 能力画像演化曲线
5. THE CostMonitor SHALL 支持通过配置中心全局开关 autonomy.enabled 一键关闭所有自治能力，回退到静态分配模式，关闭后现有工作流正常运行不受影响
