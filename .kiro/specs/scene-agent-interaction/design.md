# Scene Agent Interaction - 设计文档

## 概述

本设计让办公室场景承担三个职责：Agent 详情入口、全局公告板、任务阶段流线。

## 设计原则

1. 交互优先于装饰
2. 场景中每个强化元素都要服务“理解当前执行”
3. 选中 Agent 后的信息层次要稳定
4. 演示模式也要可解释

## 交互结构

### 1. Agent 详情侧栏

建议新增：

- `AgentDetailDrawer`
- 数据来源：`workflow-store` + `tasks-store` + `reputation-store`
- 打开方式：点击 `PetWorkers` 中 Agent

侧栏内容建议顺序：

1. 基本身份
2. 当前状态与心跳
3. 当前任务 / 所属部门
4. 近期记忆
5. 报告与历史经验

### 2. 公告板

建议放在首页现有信息层附近，承载：

- 执行中任务数
- 被阻塞 Agent 数
- 预算 / Token 摘要
- 最近异常或待处理事项

### 3. 场景流线

建议新增稳定映射配置，例如：

- direction / planning -> A 区
- execution -> B/C 区
- review / audit -> D 区
- delivery / archive -> 终点区

不要把流线写死在组件内部，建议抽到独立配置文件，便于后续升级。

## 组件改造范围

- `client/src/pages/Home.tsx`
- `client/src/components/Scene3D.tsx`
- `client/src/components/three/PetWorkers.tsx`
- `client/src/components/three/OfficeRoom.tsx`
- 新增 `client/src/components/scene/AgentDetailDrawer.tsx` 或等效组件

## 数据策略

### 1. 选中状态

复用已有 `selectedPet` 能力，但扩展为可驱动侧栏打开与关闭。

### 2. 任务上下文

优先展示当前与选中 Agent 最相关的任务，而不是把全部 mission 摊开。

### 3. 缺失数据

心跳、记忆、报告任一缺失时，显示清晰空态，不显示技术报错。

## Worktree 并行建议

### 推荐 owner

- Worktree E: `Home.tsx`、`Scene3D.tsx`、`components/three/*`
- Worktree E: 新增 Agent 侧栏与流线配置

### 可以并行

- 可与 `api-fallback-empty-states` 并行补演示模式与空态文案
- 可与 `workspace-visual-unification` 在样式层后半段协同

### 不建议并行

- 不建议与 `navigation-convergence` 同时大改 `Home.tsx`
- 不建议在 `workflow-panel-decomposition` 未确定 `memory / reports` 数据接口前直接完成最终侧栏

## 测试策略

- Agent 点击开合测试
- 公告板摘要渲染测试
- 场景流线 stage 映射测试
- 演示模式降级测试

## 交付顺序

1. Agent 详情侧栏
2. 公告板
3. 流线映射与渲染
4. 演示模式与空态收尾
