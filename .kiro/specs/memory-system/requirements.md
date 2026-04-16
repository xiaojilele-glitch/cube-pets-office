<!--
 * @Author: wangchunji
 * @Date: 2026-03-31 15:49:48
 * @Description:
 * @LastEditTime: 2026-03-31 16:13:18
 * @LastEditors: wangchunji
-->

# 记忆系统 需求文档

## 概述

记忆系统为每个智能体提供三级记忆架构（短期/中期/长期），支持工作流执行时的上下文注入、历史工作流的语义检索、以及跨工作流的人设持续演化。记忆严格隔离，每个智能体只能访问自己的记忆空间。

## 用户故事

### US-1: 短期记忆——当前工作流完整上下文注入

作为智能体，我在执行任务时需要获取当前工作流内的完整上下文（包括 CEO 方向、经理规划、已有交付物和反馈），这样我的输出可以基于充分的信息。

#### 验收标准

- AC-1.1: `MemoryRepository.buildPromptContext(agentId, query, workflowId)` 返回当前工作流内与该智能体相关的所有消息和任务上下文
- AC-1.2: 上下文按时间顺序排列，包含发送方、接收方、阶段和内容
- AC-1.3: 每次 LLM 调用后，通过 `appendLLMExchange()` 记录 prompt 和 response
- AC-1.4: 智能体间消息通过 `appendMessageLog()` 记录到发送方和接收方的会话中

### US-2: 中期记忆——向量检索历史工作流

作为智能体，我需要能够按语义相似度检索过去工作流中的经验摘要，这样我可以参考历史执行结果来提升当前任务的质量。

#### 验收标准

- AC-2.1: 每个工作流完成后，系统为参与的每个智能体生成 `VectorizedMemorySummary`（包含 directive、summary、keywords、role、stage）
- AC-2.2: 摘要通过本地 token hash 向量化（96 维），存储在智能体的 `memory/vectors.json` 中
- AC-2.3: `VectorStore.searchMemorySummaries(agentId, query, topK)` 通过余弦相似度返回最相关的历史摘要
- AC-2.4: 检索结果按相似度降序排列，支持 topK 参数控制返回数量
- AC-2.5: 空查询时返回最近的 topK 条记录

### US-3: 长期记忆——SOUL.md 人设文件持续演化

作为智能体，我的人设定义（SOUL.md）需要在每次工作流结束后根据评分反馈自动更新，这样我可以持续改进自己的行为模式。

#### 验收标准

- AC-3.1: `SoulStore.getSoulText(agentId)` 返回智能体当前的 SOUL.md 内容
- AC-3.2: `SoulStore.appendLearnedBehaviors(agentId, behaviors)` 在 SOUL.md 的 `## Learned Behaviors` 章节追加新行为
- AC-3.3: SOUL.md 文件与数据库 `soul_md` 字段双向同步：文件优先，启动时如果文件存在则同步到数据库
- AC-3.4: `SoulStore.ensureAllSoulFiles()` 在服务启动时为所有智能体确保 SOUL.md 文件存在
- AC-3.5: 追加行为时自动去重，不重复添加已存在的条目

### US-4: 记忆严格隔离

作为系统，我需要确保每个智能体只能访问自己的记忆空间，不能读写其他智能体的 sessions、memory、reports 目录。

#### 验收标准

- AC-4.1: `access-guard.ts` 的 `resolveAgentWorkspacePath()` 对路径做规范化和遍历检查
- AC-4.2: 绝对路径、`..` 路径遍历、跨智能体目录访问均被拦截并抛出异常
- AC-4.3: 工作空间按 scope 划分：root、sessions、memory、reports
- AC-4.4: `ensureAgentWorkspace(agentId)` 在首次访问时自动创建目录结构

### US-5: 工作流记忆物化

作为系统，我需要在工作流完成后将本轮的会话记录、消息日志和摘要持久化到每个参与智能体的记忆空间，这样中期记忆检索可以找到这些历史数据。

#### 验收标准

- AC-5.1: `materializeWorkflowMemories(workflowId)` 在工作流完成后被调用
- AC-5.2: 为每个参与智能体生成工作流摘要并写入向量存储
- AC-5.3: 会话记录持久化到智能体的 `sessions/` 目录
- AC-5.4: 物化过程不阻塞工作流完成事件的发射
