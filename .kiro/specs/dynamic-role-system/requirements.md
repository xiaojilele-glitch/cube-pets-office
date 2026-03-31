# 需求文档：动态角色系统（Dynamic Role System）

## 简介

动态角色系统模块为 Cube Brain 平台引入 Agent 角色的运行时切换能力。在现有的动态组织生成模块中，Agent 在物化时被绑定一个固定角色（如 Coder、Reviewer、PM），整个 Mission 生命周期内不会改变。动态角色系统打破这一限制，允许同一个 Agent 根据任务上下文在不同 Mission 甚至同一 Mission 的不同阶段中切换角色，从而将 Agent 从"专岗专人"演化为"一人多岗、按需上场"。

核心收益：大幅提升 Agent 池的资源利用率，减少空闲 Agent 数量，同时让每个 Agent 在多角色实践中积累更全面的能力画像。

## 术语表

- **Role_Template**：角色模板，包含角色定义的完整信息（职责 prompt、技能集、MCP 工具、模型配置、权限等级），与 Agent 实例解耦
- **Role_Registry**：角色模板注册表，全局单例，管理所有角色模板的注册、查询和生命周期
- **Role_Matcher**：角色匹配器，根据任务上下文和 Agent 能力画像，为任务推荐最优的 Agent-角色组合
- **Role_Performance_Record**：角色绩效记录，记录 Agent 在特定角色下的历史表现数据
- **Capability_Profile**：能力画像，Agent 的综合能力描述，包含技能向量和分角色绩效历史
- **Execution_Plan**：执行计划，Mission 的结构化执行方案，包含阶段划分和 Agent-角色分配
- **Agent**：智能体实例，Cube Brain 平台中的 AI 工作者
- **Mission**：任务域，用户发起的一次完整任务执行
- **Phase**：阶段，Mission 执行计划中的一个执行步骤
- **Role_Load_Policy**：角色加载策略，控制角色模板的 model 配置如何与 Agent 自身配置合并
- **Authority_Level**：权限等级，角色的操作权限级别（high/medium/low）
- **Ring_Buffer**：环形缓冲区，固定大小的循环数据结构，用于存储最近 N 条记录

## 需求

### 需求 1：角色模板注册表

**用户故事：** 作为系统，我需要维护一个全局的角色模板注册表，将角色的定义与 Agent 实例解耦，这样角色可以作为独立资源被任意 Agent 在运行时加载。

#### 验收标准

1. THE Role_Template SHALL contain the following fields: roleId (unique identifier), roleName (e.g. Coder, Reviewer, Architect, PM, QA, TechWriter), responsibilityPrompt (system prompt fragment for role responsibilities), requiredSkillIds (minimum skill set for the role), mcpIds (MCP tool configuration for the role), defaultModelConfig (recommended model/temperature/maxTokens), and authorityLevel (permission level determining task assignment and approval capabilities)
2. WHEN a role template is registered via RoleRegistry.register(roleTemplate), THE Role_Registry SHALL store the template and make it retrievable via RoleRegistry.get(roleId) and listable via RoleRegistry.list()
3. WHEN a role template declares an extends field referencing a parentRoleId, THE Role_Registry SHALL merge the parent template's responsibilityPrompt, requiredSkillIds, and mcpIds into the child template, allowing the child to override any inherited field
4. WHEN the dynamic organization module generates role definitions via LLM, THE Role_Registry SHALL automatically register the generated templates with source field set to "generated"; WHEN a role template is predefined manually, THE Role_Registry SHALL store the template with source field set to "predefined"
5. WHEN a role template is created, modified, or deprecated, THE Role_Registry SHALL append a change log entry containing changedBy, changedAt, and diff fields

### 需求 2：Agent 运行时加载和卸载角色

**用户故事：** 作为系统，我需要在任务分配时将角色模板动态加载到目标 Agent 上，任务完成后卸载，这样 Agent 可以在不同任务间灵活切换身份。

#### 验收标准

1. WHEN agent.loadRole(roleId) is invoked, THE Agent SHALL execute the following sequence: retrieve the role template from Role_Registry, inject the responsibilityPrompt after the SOUL.md base prompt, load role-associated skills via resolveSkills(), load role-associated MCP tools via resolveMcp(), and update the Agent's currentRoleId field
2. WHEN agent.unloadRole() is invoked, THE Agent SHALL remove the role-injected responsibilityPrompt, unload role-associated skills and MCP tools while preserving the Agent's base configuration, and set currentRoleId to null
3. WHEN a role switch from role A to role B is requested, THE Agent SHALL execute unloadRole() followed by loadRole(newRoleId) within a single transaction; IF the switch fails at any step, THEN THE Agent SHALL rollback to the pre-switch state with role A fully restored
4. WHEN a role is loaded and the roleLoadPolicy is set to "override", THE Agent SHALL replace its model configuration with the role template's defaultModelConfig; WHEN roleLoadPolicy is "prefer_agent", THE Agent SHALL retain its own model configuration; WHEN roleLoadPolicy is "merge", THE Agent SHALL use the lower temperature and higher maxTokens from both configurations
5. WHEN a role is loaded or unloaded, THE Agent SHALL write an operation log entry containing agentId, roleId, action (load/unload), timestamp, and triggerSource (the Mission or workflow that triggered the operation)

### 需求 3：基于任务上下文自动匹配最优角色

**用户故事：** 作为工作流引擎，当我需要为一个任务分配执行者时，我不仅要选择最合适的 Agent，还要为该 Agent 选择最合适的角色，这样 Agent 以最佳身份进入任务执行。

#### 验收标准

1. WHEN the workflow engine assigns a task, THE Role_Matcher SHALL accept a call to RoleMatcher.match(task, candidateAgents) and return a List of AgentRoleRecommendation, each containing agentId, recommendedRoleId, roleMatchScore, and reason
2. THE Role_Matcher SHALL compute roleMatchScore using the following weighted factors: task requiredSkills vs role requiredSkillIds match (weight 0.35), Agent CapabilityProfile.skillVector competency for the role (weight 0.30), Agent rolePerformanceHistory average quality score for the role (weight 0.25), and Agent current loadFactor (weight 0.10)
3. WHEN a task does not declare a requiredRole, THE Role_Matcher SHALL use LLM analysis of the task description to infer 1 to 3 candidate roles with fitness rationale, then select the Agent-role combination with the highest roleMatchScore
4. WHEN a task explicitly declares a requiredRole, THE Role_Matcher SHALL select the optimal Agent within that role scope only, skipping the role inference step
5. WHEN a matching result is produced, THE Role_Matcher SHALL record all candidate combinations with their roleMatchScore values and the final selection rationale to the ExecutionPlan debug log

### 需求 4：Agent 维护多角色绩效档案

**用户故事：** 作为系统，我需要为每个 Agent 分角色记录历史绩效数据，这样角色匹配和自评估可以基于 Agent 在特定角色下的真实表现而非笼统的整体数据。

#### 验收标准

1. THE Capability_Profile SHALL include a rolePerformanceHistory field of type Map<roleId, RolePerformanceRecord>
2. THE Role_Performance_Record SHALL contain the following fields: totalTasks (cumulative task count for the role), avgQualityScore (average quality score 0-100), avgLatencyMs (average completion time), successRate (success ratio), lastActiveAt (timestamp of most recent task execution in this role), and recentTasks (a Ring_Buffer of the last 50 task entries, each containing taskId, qualityScore, latencyMs, and timestamp)
3. WHEN a task is completed, THE Agent SHALL update the Role_Performance_Record corresponding to the Agent's currentRoleId at the time of completion, and simultaneously update the Agent's overall Capability_Profile
4. WHILE an Agent's totalTasks for a given role is less than 10, THE Role_Matcher SHALL mark that role's performance data as lowConfidence: true and apply a 0.6 decay coefficient to the performance weight in roleMatchScore calculation
5. WHEN rolePerformanceHistory is queried via AgentDirectory.getProfile(agentId).rolePerformance, THE Capability_Profile SHALL support filtering by roleId

### 需求 5：同一 Mission 内的阶段性角色切换

**用户故事：** 作为工作流引擎，在一个多阶段 Mission 中，我需要支持同一个 Agent 在不同阶段切换角色（例如阶段 1 以 Coder 身份写代码，阶段 2 切换为 Reviewer 审查其他 Agent 的代码），这样减少 Agent 总数的同时保持流程完整。

#### 验收标准

1. THE Execution_Plan SHALL support specifying different roleId values for the same agentId at the Phase level, using the format phases[].assignments[].agentId combined with phases[].assignments[].roleId
2. WHEN a phase transition occurs, THE Workflow_Engine SHALL automatically execute role switching: complete the current phase, invoke agent.unloadRole(), enter the next phase, and invoke agent.loadRole(nextPhaseRoleId) with the total switch duration under 500ms
3. WHEN a role switch occurs during a Mission, THE Agent SHALL retain short-term memory (current Mission context) while completely replacing the role-related system prompt and tool set; WHERE allowSelfReview is set to true, THE Agent SHALL be permitted to review content produced in a previous phase under a different role
4. WHILE allowSelfReview is set to false (the default), THE Workflow_Engine SHALL prohibit the same Agent from reviewing its own output when switching from an execution role (Coder, Writer) to a review role (Reviewer, QA), and SHALL automatically assign the review task to a different Agent
5. WHEN a phase-level role switch occurs, THE Mission SHALL record the complete transition trace containing agentId, fromRoleId, toRoleId, phaseId, and timestamp to the Mission native data source for retrospective analysis

### 需求 6：角色切换的约束与安全机制

**用户故事：** 作为系统，我需要对角色切换施加约束规则，防止不合理的切换导致安全风险或执行质量下降。

#### 验收标准

1. WHEN a role template declares compatibleRoles (whitelist) or incompatibleRoles (blacklist), THE Agent SHALL validate the target role against these lists before executing loadRole(); IF the switch violates the constraint, THEN THE Agent SHALL return a ROLE_SWITCH_DENIED error
2. WHILE an Agent is within the roleSwitchCooldownMs period (default 60000ms) after a role switch, THE Agent SHALL reject any subsequent role switch request to prevent context confusion and performance overhead
3. WHEN an Agent switches from a role with authorityLevel "high" (e.g. Architect, Lead) to a role with authorityLevel "low" (e.g. Worker), THE Agent SHALL automatically downgrade permissions by revoking task assignment and approval capabilities; WHEN switching in the reverse direction (low to high), THE Agent SHALL require orchestrator approval before the switch completes
4. WHILE an Agent has incomplete tasks, THE Agent SHALL reject role switch requests by returning an AGENT_BUSY error; the caller SHALL wait for task completion or transfer the task via the orchestrator before retrying
5. WHEN any role switch constraint validation fails, THE Agent SHALL record the event to the debug log containing agentId, requestedRoleId, denialReason, and timestamp

### 需求 7：角色使用率分析与自动优化

**用户故事：** 作为运维人员，我需要对角色的使用情况进行分析，识别利用率低的角色和频繁切换的 Agent，这样可以优化角色模板设计和 Agent 池配置。

#### 验收标准

1. THE Role_Analytics_Service SHALL expose the following metrics via Prometheus: role_load_total (grouped by roleId), role_active_duration_seconds (grouped by roleId), role_switch_total (grouped by agentId), and role_match_score_histogram (distribution of role match scores)
2. THE Cost_Monitor_Module SHALL aggregate and display a role usage heatmap (showing high-frequency and idle roles) and an Agent role-switch timeline chart
3. WHEN a role has role_load_total equal to 0 for 7 consecutive days, THE Role_Analytics_Service SHALL trigger a ROLE_UNUSED alert recommending the operations team review whether the role should be deprecated or merged
4. WHEN an Agent's role_switch_total exceeds 20 within a 24-hour period, THE Role_Analytics_Service SHALL trigger an AGENT_ROLE_THRASHING alert indicating potential role matching strategy anomalies or overly granular task decomposition
5. WHEN the GET /api/analytics/roles endpoint is called, THE Role_Analytics_Service SHALL return roleUsageSummary (usage statistics per role) and agentRoleDistribution (role distribution pie chart data per Agent)

### 需求 8：前端展示 Agent 的动态角色状态

**用户故事：** 作为用户，我希望在前端实时看到每个 Agent 当前加载的角色、角色切换历史和多角色绩效对比，这样我可以理解 Agent 的角色调度逻辑。

#### 验收标准

1. WHEN the Agent detail panel is displayed, THE Frontend SHALL show currentRole (current role name and load time) and roleHistory (the most recent 20 role switch records containing fromRole, toRole, Mission name, and timestamp)
2. WHEN the Agent detail panel is displayed, THE Frontend SHALL render a multi-role performance radar chart with each roleId as an axis, displaying the Agent's avgQualityScore for each role to visualize the Agent's role strength distribution
3. WHEN an Agent's role changes in the 3D scene, THE Frontend SHALL dynamically update the Agent's visual identity (color, icon, overhead label) to reflect the current role, with a transition animation during role switches
4. WHEN the workflow panel displays a Mission timeline, THE Frontend SHALL show role switch nodes for each Agent, using different colors to indicate different role execution periods
5. WHEN the GET /api/agents/:id endpoint is called, THE Backend SHALL return currentRole and roleHistory fields; WHEN a role change occurs, THE Backend SHALL push an agent.roleChanged event via WebSocket for real-time notification
