# 需求文档：Plugin / Skill 体系

## 简介

Plugin / Skill 体系为 Agent 提供模块化能力框架。每个 Skill 是独立的功能单元，包含专业 prompt、工具绑定和执行上下文。不同 Mission 可按需组合加载 Skill，实现热插拔式的能力扩展，避免单一 Agent 能力臃肿。系统支持 Skill 的注册、版本管理、依赖解析、动态启用/禁用、性能监控以及前端可视化展示。

## 术语表

- **Skill**: 独立的功能单元，包含 id、name、category、summary、prompt 模板、requiredMcp、version、tags 等字段
- **SkillBinding**: Skill 与 Agent 节点的绑定关系，包含解析后的 Skill 定义、MCP 绑定、配置覆盖和启用状态
- **SkillRegistry**: 全局 Skill 仓库，维护 Skill 目录，支持查询、版本管理和依赖解析
- **MCP_Tool**: Model Context Protocol 工具，Agent 执行时可调用的外部工具
- **McpBinding**: MCP 工具的绑定实例，包含连接信息和工具列表
- **WorkflowOrganizationNode**: 工作流组织中的 Agent 节点，包含 skills 数组
- **Prompt_Template**: Skill 的核心 prompt 模板，包含 `{context}` 和 `{input}` 占位符
- **Execution_Metrics**: Skill 执行性能数据，包含激活时间、执行时间、token 消耗、成功率
- **Canary_Config**: 灰度发布配置，控制新版本 Skill 的流量比例

## 需求

### 需求 1：定义和注册 Skill

**用户故事：** 作为系统管理员，我需要定义新的 Skill 并注册到全局仓库，这样不同 Agent 可以复用这些能力。

#### 验收标准

1. THE Skill SHALL 包含以下必填字段：id（全局唯一标识符）、name（可读名称）、category（分类）、summary（功能描述）、prompt（核心 prompt 模板）、requiredMcp（依赖的 MCP 工具列表）、version（版本号）、tags（标签集合）
2. WHEN 调用 registerSkill() 接口时，THE SkillRegistry SHALL 验证 Skill 定义的完整性并将 Skill 持久化到数据库
3. WHEN 注册同一 skillId 的不同版本时，THE SkillRegistry SHALL 保留所有版本并通过 version 字段区分
4. WHEN 注册 Skill 时，THE SkillRegistry SHALL 验证 prompt 模板包含有效的占位符格式（检查 `{context}` 和 `{input}` 占位符的存在性和格式正确性）
5. WHEN 注册成功时，THE SkillRegistry SHALL 返回 Skill 的完整定义和元数据（包含 id、version、createdAt）

### 需求 2：为 Agent 节点动态装配 Skill 组合

**用户故事：** 作为工作流引擎，我需要根据任务类型和 Agent 角色，为节点自动选择和装配合适的 Skill 组合。

#### 验收标准

1. WHEN LLM 生成角色定义时，THE Dynamic_Organization SHALL 在角色定义中包含 skillIds 数组
2. WHEN 调用 resolveSkills(skillIds) 时，THE SkillRegistry SHALL 将 skillId 列表解析为 SkillBinding 数组
3. WHEN 解析 Skill 列表时，THE SkillRegistry SHALL 自动递归解析 Skill 的依赖关系（如果 Skill A 依赖 Skill B，自动包含 B）
4. IF 某个 skillId 未找到，THEN THE SkillRegistry SHALL 记录警告日志但继续处理，返回所有可用的 Skill 列表
5. WHEN 解析完成时，THE SkillRegistry SHALL 将解析后的 SkillBinding 数组绑定到 WorkflowOrganizationNode.skills

### 需求 3：Skill 在 Agent 执行时的激活和应用

**用户故事：** 作为 Agent 执行引擎，我需要在 Agent 处理任务时，根据当前上下文激活相关 Skill，并将 Skill 的 prompt 注入到 Agent 的系统提示中。

#### 验收标准

1. WHEN Agent 执行前，THE Workflow_Engine SHALL 调用 activateSkills(node.skills, taskContext) 筛选适用的 Skill
2. WHEN Skill 被激活时，THE Workflow_Engine SHALL 按优先级顺序将激活的 Skill 的 prompt 拼接到 Agent 的系统提示中
3. WHEN 拼接 Skill prompt 时，THE Workflow_Engine SHALL 将 prompt 中的 `{context}` 占位符替换为当前任务上下文
4. WHEN Skill 被激活时，THE Workflow_Engine SHALL 将激活的 Skill 列表记录在执行日志中
5. WHILE Agent 执行任务时，THE Workflow_Engine SHALL 限制单个 Agent 最多激活 N 个 Skill（N 可配置，默认 5），超出部分按相关度排序后截断

### 需求 4：Skill 与 MCP 工具的绑定

**用户故事：** 作为系统，我需要管理 Skill 与 MCP 工具的对应关系，确保 Skill 执行时能访问所需的外部工具。

#### 验收标准

1. THE Skill SHALL 在 requiredMcp 字段中列出所需的 MCP 工具 ID
2. WHEN 调用 resolveMcpForSkill(skill) 时，THE SkillRegistry SHALL 将 MCP ID 解析为 McpBinding 数组
3. IF Skill 所需的 MCP 工具不可用，THEN THE SkillRegistry SHALL 记录警告日志但允许 Skill 继续执行（降级模式）
4. WHEN MCP 解析完成时，THE SkillRegistry SHALL 将解析后的 McpBinding 存储在 SkillBinding.mcpBindings 中
5. WHEN Agent 执行时，THE Workflow_Engine SHALL 通过 Skill 的上下文将 MCP 工具传递给 LLM

### 需求 5：Skill 的动态启用/禁用

**用户故事：** 作为系统管理员，我需要在运行时动态启用或禁用某些 Skill，这样可以快速响应问题或进行灰度测试。

#### 验收标准

1. THE SkillRegistry SHALL 提供 enableSkill(skillId, version) 和 disableSkill(skillId, version) 接口
2. WHEN 调用 resolveSkills() 时，THE SkillRegistry SHALL 过滤掉所有已禁用的 Skill
3. WHEN 启用或禁用操作执行时，THE SkillRegistry SHALL 立即生效，无需重启服务
4. WHEN 启用或禁用操作执行时，THE SkillRegistry SHALL 记录审计日志，包含操作者、时间和原因

### 需求 6：Skill 版本管理和灰度发布

**用户故事：** 作为系统，我需要支持 Skill 的多版本并存和灰度发布，这样可以安全地迭代 Skill 能力。

#### 验收标准

1. THE Skill SHALL 包含 version 字段，遵循语义化版本格式（如 1.0.0、1.1.0）
2. WHEN 为 Agent 或 Mission 指定 Skill 时，THE SkillRegistry SHALL 支持指定特定版本
3. WHEN 调用 getSkillVersions(skillId) 时，THE SkillRegistry SHALL 返回该 Skill 的所有版本列表
4. WHERE 灰度发布配置启用时，THE SkillRegistry SHALL 根据 canary 字段控制新版本的流量比例（如 10% 流量使用新版本）
5. WHEN 版本切换时，THE SkillRegistry SHALL 记录变更日志

### 需求 7：Skill 的性能监控和优化

**用户故事：** 作为系统，我需要收集 Skill 的执行性能数据，用于优化和问题诊断。

#### 验收标准

1. WHEN Skill 被激活和执行时，THE Skill_Monitor SHALL 记录 Execution_Metrics（激活时间、执行时间、token 消耗、成功率）
2. WHEN 调用 getSkillMetrics(skillId, timeRange) 时，THE Skill_Monitor SHALL 返回该 Skill 在指定时间范围内的性能数据
3. WHEN 查询性能数据时，THE Skill_Monitor SHALL 支持按版本、Agent 角色、任务类型维度聚合
4. WHEN Skill 的失败率超过配置的阈值时，THE Skill_Monitor SHALL 触发告警通知

### 需求 8：Skill 的依赖管理

**用户故事：** 作为系统，我需要管理 Skill 之间的依赖关系，确保依赖的 Skill 被正确加载。

#### 验收标准

1. THE Skill SHALL 在 dependencies 字段中列出依赖的其他 Skill ID
2. WHEN 调用 resolveSkills() 时，THE SkillRegistry SHALL 自动递归解析依赖，返回完整的 Skill 闭包
3. IF 检测到循环依赖，THEN THE SkillRegistry SHALL 返回错误信息而非无限递归
4. WHEN 依赖解析完成时，THE SkillRegistry SHALL 将解析结果记录在执行日志中

### 需求 9：Skill 的上下文隔离

**用户故事：** 作为系统，我需要确保不同 Skill 的执行上下文相互隔离，避免状态污染。

#### 验收标准

1. WHEN Skill 执行时，THE Skill_Runtime SHALL 为每个 Skill 创建独立的上下文对象（包含 input、output、state）
2. THE Skill_Runtime SHALL 确保 Skill 之间通过显式的输入输出接口通信，不共享内部状态
3. WHEN Skill 执行产生副作用时，THE Skill_Runtime SHALL 将副作用（如文件修改、数据库操作）记录在上下文中，便于回滚

### 需求 10：前端展示 Agent 的 Skill 组合

**用户故事：** 作为用户，我希望在前端看到当前 Agent 装配的 Skill 列表，包括 Skill 名称、功能描述和状态。

#### 验收标准

1. WHEN 用户查看工作流面板时，THE Workflow_Panel SHALL 展示每个 Agent 节点的 Skill 列表
2. WHEN 展示 Skill 信息时，THE Skill_Card SHALL 显示 name、summary、category、version 和 enabled 状态
3. WHEN 用户点击 Skill 卡片时，THE Skill_Card SHALL 展示详细信息（完整 prompt、依赖的 MCP 工具、性能指标）
4. WHEN 前端请求 Skill 数据时，THE API_Server SHALL 通过 GET /api/workflows/:id/nodes/:nodeId/skills 接口返回 Skill 信息
