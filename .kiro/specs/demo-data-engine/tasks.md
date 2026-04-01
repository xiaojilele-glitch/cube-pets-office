# 实施计划：Demo Data Engine（预录演示数据引擎）

## 概述

将演示数据引擎设计转化为可执行的编码任务。所有代码使用 TypeScript，数据模块存放在 `client/src/runtime/demo-data/` 目录下，测试使用 vitest + fast-check。

## 任务

- [x] 1. 创建 DemoDataBundle 类型定义和目录结构
  - [x] 1.1 创建 `client/src/runtime/demo-data/schema.ts`，定义 DemoDataBundle、DemoMemoryEntry、DemoEvolutionLog、DemoTimedEvent 类型
    - 导入 shared/ 下的 AgentRecord、WorkflowRecord、MessageRecord、TaskRecord、AgentEvent、WorkflowOrganizationSnapshot
    - 定义 MemoryEntryKind 类型（short_term | medium_term | long_term）
    - 定义 DemoDataBundle 接口，包含 version、scenarioName、scenarioDescription、organization、workflow、agents、messages、tasks、memoryEntries、evolutionLogs、events 字段
    - _Requirements: 2.1_

- [x] 2. 实现序列化与反序列化
  - [x] 2.1 创建 `client/src/runtime/demo-data/serializer.ts`，实现 serializeDemoData 和 deserializeDemoData 函数
    - serializeDemoData：使用 JSON.stringify(bundle, null, 2) 输出格式化 JSON
    - deserializeDemoData：JSON.parse 后调用 validateDemoDataBundle 进行结构验证
    - validateDemoDataBundle：检查 version、organization、workflow、agents、messages、tasks、memoryEntries、evolutionLogs、events 字段的存在性和类型
    - 验证失败时抛出包含字段路径的描述性错误
    - _Requirements: 2.2, 2.3, 2.5, 2.6_

  - [ ]* 2.2 编写序列化 round-trip 属性测试
    - 创建 `client/src/runtime/demo-data/__tests__/serializer.property.test.ts`
    - 构建 DemoDataBundle 的 fast-check Arbitrary 生成器
    - **Property 1: 序列化 Round-Trip 一致性**
    - **Validates: Requirements 2.2, 2.3, 2.4**

  - [ ]* 2.3 编写序列化器单元测试
    - 创建 `client/src/runtime/demo-data/__tests__/serializer.test.ts`
    - 测试空字符串、null、部分字段缺失、version 不匹配等边界情况
    - **Validates: Requirements 2.6**

- [x] 3. Checkpoint - 确保序列化模块测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 4. 构建预录演示数据
  - [x] 4.1 创建 `client/src/runtime/demo-data/organization.ts`，构建演示组织快照
    - 基于 seed.ts 中的 agent 定义，选取 ceo、pixel、nexus、nova、blaze、flux、tensor 共 7 个角色
    - 构建符合 WorkflowOrganizationSnapshot 类型的组织快照
    - 场景：设计手游营销推广方案
    - _Requirements: 1.2_

  - [x] 4.2 创建 `client/src/runtime/demo-data/agents.ts`，导出演示智能体记录数组
    - 基于 seed.ts 中选取的 7 个 agent 构建 AgentRecord 数组
    - _Requirements: 1.9_

  - [x] 4.3 创建 `client/src/runtime/demo-data/workflow.ts`，导出演示工作流记录
    - 构建一条 WorkflowRecord，status 为 completed，覆盖全部十阶段
    - _Requirements: 1.1_

  - [x] 4.4 创建 `client/src/runtime/demo-data/messages.ts`，导出演示消息记录数组
    - 构建至少 20 条 MessageRecord
    - 覆盖 CEO→Manager、Manager→Worker、Worker→Manager 消息流转
    - 消息内容围绕"手游营销推广方案"场景
    - _Requirements: 1.4_

  - [x] 4.5 创建 `client/src/runtime/demo-data/tasks.ts`，导出演示任务记录数组
    - 构建至少 4 条 TaskRecord
    - 每条包含 deliverable、四维评分（score_accuracy、score_completeness、score_actionability、score_format）和 manager_feedback
    - _Requirements: 1.5_

  - [x] 4.6 创建 `client/src/runtime/demo-data/memory.ts`，导出演示记忆条目数组
    - 构建覆盖 short_term、medium_term、long_term 三种类型的 DemoMemoryEntry 数组
    - 短期记忆关联 execution 阶段，中期记忆关联 summary 阶段，长期记忆关联 evolution 阶段
    - _Requirements: 1.6_

  - [x] 4.7 创建 `client/src/runtime/demo-data/evolution.ts`，导出演示进化日志数组
    - 构建 DemoEvolutionLog 数组，包含 old_score → new_score 变化和 SOUL.md 补丁内容
    - _Requirements: 1.7_

  - [x] 4.8 创建 `client/src/runtime/demo-data/events.ts`，导出演示事件序列
    - 构建按 timestampOffset 升序排列的 DemoTimedEvent 数组
    - 覆盖全部十阶段，包含 stage_change、agent_active、message_sent、score_assigned、task_update、workflow_complete 事件类型
    - 总时长 30 秒（0-30000ms）
    - _Requirements: 1.1, 1.3_

- [x] 5. 组装数据包并创建统一导出
  - [x] 5.1 创建 `client/src/runtime/demo-data/bundle.ts`，组装所有数据模块为完整的 DEMO_BUNDLE 实例
    - 导入 organization、agents、workflow、messages、tasks、memory、evolution、events 模块
    - 导出 DEMO_BUNDLE 常量，类型为 DemoDataBundle
    - _Requirements: 1.1, 1.8_

  - [x] 5.2 创建 `client/src/runtime/demo-data/index.ts`，统一导出类型和函数
    - 导出 DemoDataBundle 等类型
    - 导出 serializeDemoData、deserializeDemoData 函数
    - 导出 DEMO_BUNDLE 常量
    - _Requirements: 1.8_

- [ ] 6. 数据完整性验证
  - [ ]* 6.1 编写数据完整性单元测试
    - 创建 `client/src/runtime/demo-data/__tests__/bundle.test.ts`
    - 验证 DEMO_BUNDLE 覆盖全部 10 个工作流阶段
    - 验证组织快照包含 1 CEO、2 Manager、4 Worker
    - 验证消息数量 ≥ 20 且覆盖三种流转路径
    - 验证任务数量 ≥ 4 且包含完整评分
    - 验证记忆条目覆盖三级记忆类型
    - 验证进化日志包含评分变化和补丁内容
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7_

  - [ ]* 6.2 编写事件序列时间戳属性测试
    - **Property 2: 事件序列时间戳单调递增**
    - **Validates: Requirements 1.3**

  - [ ]* 6.3 编写序列化输出格式属性测试
    - **Property 3: 序列化输出为格式化 JSON**
    - **Validates: Requirements 2.5**

  - [ ]* 6.4 编写反序列化错误处理属性测试
    - **Property 4: 反序列化无效输入产生描述性错误**
    - **Validates: Requirements 2.6**

- [x] 7. 最终 Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP 交付
- 每个任务引用具体需求以确保可追溯性
- 属性测试使用 fast-check 库，每个属性至少运行 100 次迭代
- 单元测试使用 vitest
- 所有数据模块必须通过 TypeScript 类型检查（tsc --noEmit）
