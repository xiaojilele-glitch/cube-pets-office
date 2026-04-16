# 记忆系统 设计文档

## 概述

记忆系统为智能体提供三级记忆架构，核心实现分布在 `server/memory/` 目录下。通过 `access-guard.ts` 强制工作空间隔离，确保每个智能体只能访问自己的记忆。

## 三级记忆架构

```
┌─────────────────────────────────────────────┐
│ 短期记忆 (Session Store)                     │
│ 当前工作流内的完整上下文                       │
│ LLM 交换记录 + 智能体间消息日志                │
│ 文件：data/agents/<id>/sessions/*.jsonl      │
├─────────────────────────────────────────────┤
│ 中期记忆 (Vector Store)                      │
│ 历史工作流摘要的向量化检索                     │
│ 本地 token hash 向量 (96维) + 余弦相似度      │
│ 文件：data/agents/<id>/memory/vectors.json   │
├─────────────────────────────────────────────┤
│ 长期记忆 (Soul Store)                        │
│ 智能体人设定义，跨工作流持续演化               │
│ 文件：data/agents/<id>/SOUL.md               │
│ 数据库：agents.soul_md (双向同步)             │
└─────────────────────────────────────────────┘
```

## 核心组件

### SessionStore (`server/memory/session-store.ts`)

- `buildPromptContext(agentId, query, workflowId)`: 构建 LLM 调用的上下文数组
- `appendLLMExchange(agentId, options)`: 记录每次 LLM 调用的 prompt/response
- `appendMessageLog(agentId, options)`: 记录智能体间消息（inbound/outbound）
- `materializeWorkflowMemories(workflowId)`: 工作流完成后持久化记忆

### VectorStore (`server/memory/vector-store.ts`)

向量化方案采用本地 token hash，不依赖外部 embedding 服务：

```
文本 → tokenize() → 中文按1-8字切分，英文按单词切分
     → hashToken() → FNV-1a 哈希
     → embedText() → 96维向量（hash % dimension 定位，奇偶决定正负）
     → normalizeVector() → L2 归一化
```

- `upsertMemorySummary(agentId, summary)`: 插入或更新工作流摘要向量
- `searchMemorySummaries(agentId, query, topK)`: 余弦相似度检索，返回 `VectorSearchHit[]`
- 索引文件格式：`VectorIndexFile { version: 1, dimension: 96, records: VectorRecord[] }`

### SoulStore (`server/memory/soul-store.ts`)

- `ensureSoulFile(agentId)`: 确保 SOUL.md 文件存在，文件优先于数据库
- `ensureAllSoulFiles()`: 服务启动时为所有智能体初始化
- `getSoulText(agentId)`: 读取当前人设文本
- `updateSoul(agentId, soulMd)`: 更新文件和数据库
- `appendLearnedBehaviors(agentId, behaviors)`: 在 `## Learned Behaviors` 章节追加，自动去重

### AccessGuard (`server/core/access-guard.ts`)

工作空间隔离的核心守卫：

```typescript
resolveAgentWorkspacePath(agentId, relativePath, scope)
  → ensureAgentWorkspace(agentId)        // 确保目录存在
  → getAgentWorkspaceScopeDir(agentId, scope)  // 获取 scope 目录
  → normalizeWorkspaceRelativePath()     // 规范化路径
  → assertInsideBaseDir()                // 防止路径遍历
```

Scope 类型：`root` | `sessions` | `memory` | `reports`

拦截规则：

- 绝对路径 → 拒绝
- `..` 路径遍历 → 拒绝
- 解析后路径不在 baseDir 内 → 拒绝

## 工作空间目录结构

```
data/agents/<agentId>/
├── SOUL.md              # 长期记忆：人设定义
├── HEARTBEAT.md         # 心跳配置
├── sessions/            # 短期记忆：会话记录 (JSONL)
├── memory/              # 中期记忆
│   └── vectors.json     # 向量索引
└── reports/             # 报告产物
    ├── dept_*.json
    ├── dept_*.md
    └── heartbeat_*.json
```

## 数据流

```
工作流执行中：
  Agent.invoke() → SessionStore.appendLLMExchange()
  MessageBus.send() → SessionStore.appendMessageLog() (双方)

工作流完成后：
  materializeWorkflowMemories()
    → 为每个参与智能体生成 VectorizedMemorySummary
    → VectorStore.upsertMemorySummary()
    → 会话记录持久化到 sessions/

进化阶段：
  EvolutionService → SoulStore.appendLearnedBehaviors()
  HeartbeatScheduler → SoulStore (通过 HEARTBEAT.md 更新)
```
