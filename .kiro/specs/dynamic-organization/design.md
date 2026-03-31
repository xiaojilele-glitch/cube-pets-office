# 动态组织生成 设计文档

## 概述

动态组织生成模块通过 LLM 将用户指令转化为结构化的多智能体组织定义，替代固定 18 智能体方案。核心实现在 `server/core/dynamic-organization.ts`，输出 `WorkflowOrganizationSnapshot`。

## 生成流程

```
用户指令
  │
  ▼
buildPlannerPrompt(workflowId, directive)
  │  构建包含角色目录、skill 目录、MCP 目录的 planner prompt
  │
  ▼
LLM.callJson<PlannerOutput>()
  │  LLM 返回结构化的组织规划
  │
  ├── 成功 → normalizePlan() → 校验和规范化
  │
  ├── JSON 解析失败 → extractJsonObject() 尝试从文本中提取
  │
  └── 完全失败 → buildFallbackPlan(directive)
       │  inferTaskProfile() 推断任务类型
       │  使用预定义模板生成默认组织
       │
       ▼
ensureDepartmentIds() → 确保部门 ID 唯一
  │
  ▼
assembleOrganizationSnapshot()
  │  为每个角色：
  │  ├── createNode() → 创建组织节点
  │  ├── resolveSkills() → 解析 skill 绑定
  │  ├── resolveMcp() → 解析 MCP 绑定
  │  └── buildNodeSoul() → 生成 SOUL.md 内容
  │
  ▼
WorkflowOrganizationSnapshot
  │
  ▼
materializeWorkflowOrganization()
  │  注册智能体到数据库 + 创建工作空间
  │
  ▼
persistOrganizationDebugLog()
  │  调试日志落盘
```

## 核心数据模型

### PlannerOutput (LLM 输出)
```typescript
interface PlannerOutput {
  taskProfile: string;       // 任务类型标签
  reasoning: string;         // LLM 推理过程
  departments: PlannerDepartment[];
}

interface PlannerDepartment {
  id: string;
  label: string;
  direction: string;         // 部门方向
  strategy: "parallel" | "sequential" | "batched";
  maxConcurrency: number;
  manager: RoleTemplate;
  workers: RoleTemplate[];
}

interface RoleTemplate {
  name: string;
  title: string;
  responsibility: string;
  responsibilities: string[];
  goals: string[];
  summaryFocus: string[];
  skillIds: string[];
  mcpIds: string[];
  model: { model: string; temperature: number; maxTokens: number };
  execution: { mode: string; strategy: string; maxConcurrency: number };
}
```

### WorkflowOrganizationNode
```typescript
interface WorkflowOrganizationNode {
  id: string;                // 节点 ID (sanitized)
  agentId: string;           // 智能体 ID (workflowId 前缀)
  parentId: string | null;
  departmentId: string;
  departmentLabel: string;
  name: string;
  title: string;
  role: "ceo" | "manager" | "worker";
  responsibility: string;
  responsibilities: string[];
  goals: string[];
  summaryFocus: string[];
  skills: WorkflowSkillBinding[];
  mcp: WorkflowMcpBinding[];
  model: WorkflowNodeModelConfig;
  execution: WorkflowNodeExecutionConfig;
}
```

## Fallback 策略

`inferTaskProfile()` 通过关键词匹配推断任务类型：

| 关键词模式 | 任务类型 | 默认部门配置 |
|-----------|---------|-------------|
| code/develop/implement/bug | coding | 架构部 + 开发部 + 测试部 |
| market/growth/campaign | marketing | 策略部 + 内容部 + 数据部 |
| research/analyze/investigate | research | 调研部 + 分析部 |
| design/ui/ux | design | 设计部 + 用户研究部 |
| 其他 | general | 规划部 + 执行部 + 质量部 |

## SOUL.md 生成规则

`buildNodeSoul()` 为每个节点生成人设文件：

```markdown
# {name} - {title}

## 身份
- 部门：{departmentLabel}
- 角色：{role}
- 职责：{responsibility}

## 专业领域
{responsibilities 列表}

## 目标
{goals 列表}

## 汇总关注点
{summaryFocus 列表}

## Skills
{skills 列表及 prompt}
```

## 调试日志

每次组织生成都会持久化 `OrganizationGenerationDebugLog`：
- `prompt`: 发送给 LLM 的完整 prompt
- `rawResponse`: LLM 原始返回
- `parsedPlan`: 解析后的 PlannerOutput
- `fallbackReason`: 如果降级，记录原因
- 落盘路径：`data/agents/<ceoId>/reports/`
