# 自进化与心跳 需求文档

## 概述

自进化与心跳模块实现论文 M7 的三个并行学习闭环（绩效反馈、关键词学习、能力注册）以及智能体自主心跳行为（定时搜索、趋势报告生成）。目标是让智能体在无人触发时也能自主工作，并从每次执行中持续学习。

## 用户故事

### US-1: 绩效反馈闭环——评分驱动人设修补
作为系统，我需要在每轮工作流结束后分析所有智能体的评分数据，识别弱维度并自动生成 SOUL.md 补丁，这样智能体可以针对性地改进。

#### 验收标准
- AC-1.1: `EvolutionService.evolveWorkflow(workflowId)` 提取本轮所有 TaskRecord 的四维度评分
- AC-1.2: 按智能体分组计算各维度平均分，识别平均分 <3/5 的弱维度
- AC-1.3: 为弱维度生成改进建议，通过 `upsertBulletSection()` 追加到 SOUL.md 对应章节
- AC-1.4: 进化日志写入数据库 evolution_log 表（agent_id、dimension、old_score、new_score、patch_content）

### US-2: 关键词学习——高分/低分交付物关键词分析
作为系统，我需要从高分和低分交付物中提取关键词，分析哪些关键词与高分相关，并更新 HEARTBEAT.md 配置，这样心跳搜索可以聚焦更有效的关键词。

#### 验收标准
- AC-2.1: `buildKeywordSignals()` 从本轮所有任务的 description 和 deliverable 中提取关键词
- AC-2.2: 按关键词出现频率和关联评分计算 `KeywordSignal`（keyword、category、correlation、occurrenceCount）
- AC-2.3: 关键词分为 effective（与高分正相关）、neutral、ineffective（与低分正相关）三类
- AC-2.4: 分析结果通过 `renderHeartbeatMarkdown()` 更新到 HEARTBEAT.md 的关键词章节
- AC-2.5: 关键词数据同步写入数据库 heartbeat_keywords 表

### US-3: 能力注册——从执行日志中提取已展示能力
作为系统，我需要从 Worker 的任务描述和交付物中提取已展示的能力，维护动态能力注册表，这样系统可以了解每个智能体擅长什么。

#### 验收标准
- AC-3.1: `CapabilityRegistry.registerTask(task)` 从评分 ≥12 的任务中提取能力描述
- AC-3.2: 能力提取规则：从 description 和 deliverable 中识别包含动作关键词（设计/规划/分析/实现等）的语句
- AC-3.3: 每个能力的置信度通过 EMA（指数移动平均）更新：`confidence = previous * 0.7 + evidence * 0.3`
- AC-3.4: 能力数据写入数据库 agent_capabilities 表（agent_id、capability、confidence、demo_count）
- AC-3.5: `registerWorkflow(tasks)` 批量处理一轮工作流的所有任务

### US-4: 心跳调度——智能体定时自主搜索和报告
作为系统，我需要按配置的间隔定时触发智能体执行自主搜索和趋势报告生成，这样智能体在无用户指令时也能持续工作。

#### 验收标准
- AC-4.1: `HeartbeatScheduler.start()` 启动定时调度，为每个智能体按 HEARTBEAT.md 中的间隔配置触发
- AC-4.2: 每次心跳执行：搜索（基于关键词）→ LLM 总结 → 报告生成 → 落盘
- AC-4.3: 心跳报告以 JSON 和 Markdown 格式写入智能体的 `reports/` 目录
- AC-4.4: 心跳状态通过 Socket 事件 `heartbeat_status` 推送前端
- AC-4.5: 报告保存后通过 Socket 事件 `heartbeat_report_saved` 通知前端
- AC-4.6: LLM 不可用时进入退避窗口，避免频繁重试
- AC-4.7: 支持手动触发 `trigger(agentId, 'manual')`

### US-5: 心跳搜索与候选评分
作为系统，心跳搜索需要基于智能体的关键词配置和历史任务，找到最相关的搜索候选并评分排序。

#### 验收标准
- AC-5.1: 搜索候选来源包括：历史工作流任务、关键词匹配结果
- AC-5.2: `scoreCandidate()` 基于关键词匹配数量和文本相关性评分
- AC-5.3: 候选按评分降序排列，取 topK 进入 LLM 总结
- AC-5.4: 搜索结果包含匹配的关键词列表，便于分析关键词有效性
