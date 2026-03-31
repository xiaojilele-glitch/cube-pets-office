# 自进化与心跳 设计文档

## 概述

自进化与心跳模块由三个核心组件构成：EvolutionService（绩效反馈 + 关键词学习）、CapabilityRegistry（能力注册）、HeartbeatScheduler（自主心跳调度）。它们共同实现智能体的持续学习和自主行为能力。

## 组件架构

```
工作流完成
  │
  ├── EvolutionService.evolveWorkflow(workflowId)
  │     ├── analyzeWeakDimensions() → 识别弱维度 → upsertBulletSection() → SOUL.md 补丁
  │     ├── buildKeywordSignals() → 关键词分析 → renderHeartbeatMarkdown() → HEARTBEAT.md
  │     └── 写入 evolution_log 表
  │
  └── CapabilityRegistry.registerWorkflow(tasks)
        └── registerTask() → 提取能力 → EMA 置信度更新 → agent_capabilities 表

定时触发
  │
  └── HeartbeatScheduler
        ├── tick(agentId) → search() → LLM 总结 → 报告落盘
        ├── scheduleNext() → 按间隔重新调度
        └── Socket 事件推送 (heartbeat_status / heartbeat_report_saved)
```

## EvolutionService (`server/core/evolution.ts`)

### 弱维度分析
```typescript
function analyzeWeakDimensions(tasks: TaskRow[]): {
  weakDimensions: Array<{ dimension: string; average: number }>;
  averages: Record<ScoreDimension, number>;
}
```
- 按 accuracy/completeness/actionability/format 四维度计算平均分
- 平均分 <3.0 的维度标记为弱维度

### SOUL.md 补丁机制
```typescript
function upsertBulletSection(
  soulMd: string,
  heading: string,       // 如 "## Accuracy Improvements"
  bullets: string[],     // 改进建议列表
  maxBullets: number     // 每个章节最大条目数
): string
```
- 如果章节已存在，追加新条目（去重）
- 如果章节不存在，在文件末尾新增
- 超过 maxBullets 时移除最旧的条目

### 关键词信号分析
```typescript
interface KeywordSignal {
  keyword: string;
  category: "effective" | "neutral" | "ineffective";
  correlation: number;      // 与高分的相关系数 (-1 到 1)
  occurrenceCount: number;
}
```
- 从任务 description 和 deliverable 中 tokenize 提取关键词
- 按关键词在高分任务（≥16）和低分任务（<12）中的出现比例计算 correlation
- correlation > 0.3 → effective，< -0.3 → ineffective，其余 → neutral

### HEARTBEAT.md 渲染
```typescript
function renderHeartbeatMarkdown(
  config: HeartbeatConfig,
  signals: KeywordSignal[]
): string
```
- 输出 Markdown 格式的心跳配置文件
- 包含：搜索关键词列表、间隔配置、关键词有效性分类

## CapabilityRegistry (`server/core/capability-registry.ts`)

### 能力提取规则
1. 从 `task.description` 和 `bestDeliverable(task)` 中按行切分候选语句
2. 通过 `cleanCapability()` 清洗：去除 Markdown 标记、序号、特殊字符
3. 通过 `hasActionSignal()` 过滤：必须包含动作关键词（设计/规划/分析/实现/优化等，中英文均支持）
4. 每个任务最多提取 5 个能力
5. 仅处理评分 ≥12 的任务

### 置信度更新 (EMA)
```
evidence = 0.35 + (totalScore / 20) * 0.6    // 评分映射到 0.35-0.95
confidence = previous * 0.7 + evidence * 0.3  // 指数移动平均
```

## HeartbeatScheduler (`server/core/heartbeat.ts`)

### 调度机制
- 服务启动时 `start()` 为每个智能体初始化状态和定时器
- 每个智能体独立调度，间隔从 HEARTBEAT.md 配置读取（默认 6 小时）
- 定时器到期后执行 `trigger(agentId, 'scheduled')`
- LLM 不可用时进入全局退避窗口 `openLLMUnavailableWindow(durationMs)`

### 心跳执行流程
```
trigger(agentId)
  → loadConfig(agentId)           // 读取 HEARTBEAT.md 配置
  → search(agent, config)         // 基于关键词搜索候选
  → scoreCandidate()              // 评分排序
  → LLM.call()                    // 总结搜索结果为趋势报告
  → 报告落盘 (JSON + Markdown)
  → Socket 事件推送
  → scheduleNext(agentId)         // 重新调度下一次
```

### 搜索候选评分
```typescript
function scoreCandidate(text: string, keywords: string[]): {
  score: number;
  matchedKeywords: string[];
}
```
- 基于关键词匹配数量评分
- 匹配的关键词列表用于后续关键词有效性分析

### 心跳报告结构
```typescript
interface HeartbeatLLMResult {
  title: string;
  summary: string;
  keywords: string[];
  insights: string[];
  recommendations: string[];
}
```

### 错误处理
- LLM 调用失败：记录错误，进入退避窗口，延迟重试
- 退避窗口内的心跳触发：跳过执行，等待窗口结束
- `parseRetryDelayMs()` 从错误中提取 rate limit 建议的等待时间
- 每个智能体有独立的 jitter（`heartbeatRetryJitterMs`）避免雷群效应

## 数据库表

### evolution_log
| 字段 | 类型 | 说明 |
|------|------|------|
| agent_id | VARCHAR(32) | 智能体 ID |
| workflow_id | VARCHAR(36) | 触发进化的工作流 |
| dimension | VARCHAR(32) | 弱维度名称 |
| old_score | DECIMAL(3,1) | 进化前平均分 |
| new_score | DECIMAL(3,1) | 进化后平均分 |
| patch_content | TEXT | SOUL.md 补丁内容 |

### heartbeat_keywords
| 字段 | 类型 | 说明 |
|------|------|------|
| agent_id | VARCHAR(32) | 智能体 ID |
| keyword | VARCHAR(128) | 关键词 |
| category | ENUM | effective / neutral / ineffective |
| correlation | DECIMAL(4,3) | 与高分的相关系数 |
| occurrence_count | INT | 出现次数 |

### agent_capabilities
| 字段 | 类型 | 说明 |
|------|------|------|
| agent_id | VARCHAR(32) | 智能体 ID |
| capability | VARCHAR(256) | 能力描述 |
| confidence | DECIMAL(4,3) | EMA 置信度 |
| demo_count | INT | 成功展示次数 |
