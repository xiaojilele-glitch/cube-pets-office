# 动态组织生成 需求文档

## 概述

动态组织生成模块负责根据用户指令内容，通过 LLM 自动生成适合当前任务的多智能体组织结构（CEO/Manager/Worker 层级），替代原有的固定 18 智能体方案。每个组织节点携带职责、skills、MCP 工具配置和模型参数进入工作流执行链路。

## 用户故事

### US-1: 按任务内容动态生成组织结构

作为系统，我需要根据用户指令的内容和类型，自动生成一个包含 CEO、经理和 Worker 的层级组织结构，这样不同类型的任务可以得到不同的专业团队配置。

#### 验收标准

- AC-1.1: 系统调用 LLM 分析指令，输出 `PlannerOutput`（包含部门列表、每个部门的经理和 Worker 角色定义）
- AC-1.2: 编程类任务和营销类任务生成的组织结构应有明显差异（不同部门、不同角色名称和职责）
- AC-1.3: 生成的组织结构符合 `WorkflowOrganizationSnapshot` schema，包含 `departments`、`nodes`、`rootNodeId`
- AC-1.4: 每个节点包含 `id`、`agentId`、`role`、`responsibility`、`goals`、`summaryFocus` 等字段
- AC-1.5: 组织生成过程记录调试日志（prompt、rawResponse、parsedPlan），便于回放和排障

### US-2: 为组织节点自动装配 Skills

作为系统，我需要根据每个组织节点的角色类型，自动从预定义的 skill 目录中匹配并挂载 prompt/skill 集，这样节点在执行时可以获得专业能力增强。

#### 验收标准

- AC-2.1: LLM 生成的角色定义中包含 `skillIds` 字段
- AC-2.2: 系统通过 `resolveSkills()` 将 skillId 解析为 `WorkflowSkillBinding`（包含 id、name、summary、prompt）
- AC-2.3: 解析后的 skills 绑定到对应的 `WorkflowOrganizationNode.skills` 数组
- AC-2.4: 未找到的 skillId 静默跳过，不阻塞组织生成

### US-3: 为组织节点自动装配 MCP 工具配置

作为系统，我需要根据任务类型为节点声明所需的 MCP 工具和连接信息，这样节点在执行时可以调用外部工具。

#### 验收标准

- AC-3.1: LLM 生成的角色定义中包含 `mcpIds` 字段
- AC-3.2: 系统通过 `resolveMcp()` 将 mcpId 解析为 `WorkflowMcpBinding`（包含 server、connection、tools）
- AC-3.3: MCP 配置绑定到对应的 `WorkflowOrganizationNode.mcp` 数组
- AC-3.4: 每个 MCP 绑定包含 transport 类型、endpoint 和可用工具列表

### US-4: 组织生成失败时降级回退

作为系统，当 LLM 返回无效结果或调用失败时，我需要回退到基于关键词推断的安全默认组织，这样工作流不会因为组织生成失败而中断。

#### 验收标准

- AC-4.1: LLM 返回无法解析的 JSON 时，系统调用 `buildFallbackPlan()` 生成默认组织
- AC-4.2: fallback 通过 `inferTaskProfile()` 分析指令关键词，推断任务类型（如 coding、marketing、research）
- AC-4.3: 不同任务类型对应不同的 fallback 部门和角色模板
- AC-4.4: fallback 组织的 `source` 字段标记为 `"fallback"`，与 LLM 生成的 `"generated"` 区分
- AC-4.5: 降级原因记录在调试日志的 `fallbackReason` 字段中

### US-5: 组织结构物化为智能体实例

作为系统，我需要将生成的组织结构物化为可执行的智能体实例（注册到数据库、创建工作空间、生成 SOUL.md），这样工作流引擎可以通过 AgentDirectory 调用它们。

#### 验收标准

- AC-5.1: `materializeWorkflowOrganization()` 为每个节点创建数据库记录
- AC-5.2: 每个节点的 SOUL.md 由 `buildNodeSoul()` 根据角色职责、goals、skills 自动生成
- AC-5.3: 节点的 `model` 配置（model name、temperature、maxTokens）从组织定义中读取
- AC-5.4: 物化后的智能体可通过 `AgentDirectory.get(agentId)` 获取

### US-6: 前端展示动态组织信息

作为用户，我希望在前端看到当前工作流使用的组织结构，包括部门划分、角色名称和职责，这样我可以理解系统是如何组队的。

#### 验收标准

- AC-6.1: 工作流面板展示当前组织的部门列表和角色分布
- AC-6.2: 3D 场景的区块标题由动态组织的部门名称驱动
- AC-6.3: 组织信息通过 `GET /api/workflows/:id` 的 `results.organization` 字段返回
