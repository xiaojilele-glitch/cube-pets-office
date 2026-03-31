<!--
 * @Author: wangchunji
 * @Date: 2026-03-31 15:37:16
 * @Description: 
 * @LastEditTime: 2026-03-31 16:35:11
 * @LastEditors: wangchunji
-->
# 动态组织生成 任务清单

- [x] 1. 设计动态组织 schema
  - [x] 1.1 定义 WorkflowOrganizationSnapshot 类型（departments、nodes、rootNodeId）
  - [x] 1.2 定义 WorkflowOrganizationNode 类型（role、responsibility、skills、mcp、model、execution）
  - [x] 1.3 定义 WorkflowSkillBinding 和 WorkflowMcpBinding 类型
  - [x] 1.4 定义 OrganizationGenerationDebugLog 类型
- [x] 2. 实现 LLM 驱动的组织生成
  - [x] 2.1 实现 buildPlannerPrompt()：构建包含角色目录、skill 目录、MCP 目录的 planner prompt
  - [x] 2.2 实现 generateWorkflowOrganization()：调用 LLM 生成 PlannerOutput
  - [x] 2.3 实现 extractJsonObject()：从 LLM 文本响应中提取 JSON 对象
  - [x] 2.4 实现 normalizePlan()：校验和规范化 LLM 输出为合法 PlannerOutput
  - [x] 2.5 实现 plannerCatalogSummary()：生成角色/skill/MCP 目录摘要供 prompt 使用
- [x] 3. 实现 Fallback 降级策略
  - [x] 3.1 实现 inferTaskProfile()：通过关键词匹配推断任务类型（coding/marketing/research/design/general）
  - [x] 3.2 实现 buildFallbackPlan()：为每种任务类型提供预定义的部门和角色模板
  - [x] 3.3 LLM 调用失败或 JSON 解析失败时自动切换到 fallback
  - [x] 3.4 fallback 组织的 source 字段标记为 "fallback"
- [x] 4. 实现 Skills 和 MCP 装配
  - [x] 4.1 实现 resolveSkills()：将 skillId 列表解析为 WorkflowSkillBinding 数组
  - [x] 4.2 实现 resolveMcp()：将 mcpId 列表解析为 WorkflowMcpBinding 数组
  - [x] 4.3 未找到的 skillId/mcpId 静默跳过
- [x] 5. 实现组织结构组装
  - [x] 5.1 实现 assembleOrganizationSnapshot()：将 PlannerOutput 转化为 WorkflowOrganizationSnapshot
  - [x] 5.2 实现 createNode()：为每个角色创建 WorkflowOrganizationNode
  - [x] 5.3 实现 buildNodeSoul()：根据角色职责、goals、skills 自动生成 SOUL.md 内容
  - [x] 5.4 实现 ensureDepartmentIds()：确保部门 ID 唯一性
- [x] 6. 实现组织物化
  - [x] 6.1 实现 materializeWorkflowOrganization()：将组织节点注册为数据库智能体记录
  - [x] 6.2 为每个节点创建工作空间目录和 SOUL.md 文件
  - [x] 6.3 物化后的智能体可通过 AgentDirectory 访问
- [x] 7. 实现调试日志
  - [x] 7.1 实现 persistOrganizationDebugLog()：记录 prompt、rawResponse、parsedPlan、fallbackReason
  - [x] 7.2 调试日志落盘到 CEO 的 reports/ 目录
- [x] 8. 前端组织展示
  - [x] 8.1 工作流面板展示动态生成的部门和角色
  - [x] 8.2 3D 场景区块标题由动态组织部门名称驱动
- [x] 9. 单元测试
  - [x] 9.1 组织生成主链路测试（server/tests/dynamic-organization.test.ts）
  - [x] 9.2 fallback 降级路径测试
