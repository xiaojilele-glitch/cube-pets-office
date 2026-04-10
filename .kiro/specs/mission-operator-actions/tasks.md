# 实施计划：mission-operator-actions

## 概述

本任务在 `mission-cancel-control` 之后建立统一操作动作层，交付 Pause / Resume / Retry / Mark Blocked / Terminate 的后端协议、Mission 数据模型、前端操作栏和基础 executor 控制能力。

## Tasks

- [x] 1. 扩展共享类型与数据结构
  - [x] 1.1 更新 `shared/mission/contracts.ts`
    - 新增 `MissionOperatorState`
    - 新增 `MissionOperatorActionType`
    - 新增 `MissionOperatorActionRecord`
    - 扩展 `MissionRecord.operatorState`、`operatorActions`、`blocker`、`attempt`
    - _Requirements: 1.1.1, 1.1.2, 1.1.3, 1.1.4, 4.1.2_

  - [x] 1.2 更新前端任务类型
    - `client/src/lib/tasks-store.ts` 接入 operatorState / blocker / attempt
    - _Requirements: 7.1.2, 6.1.4_

- [x] 2. 建立后端操作动作服务
  - [x] 2.1 创建 `server/tasks/mission-operator-service.ts`
    - 集中处理动作可用性校验
    - 分发 pause / resume / retry / mark-blocked / terminate
    - 统一写入 operatorActions 历史
    - _Requirements: 1.2.1, 1.2.2, 6.1.1, 6.1.2_

  - [x] 2.2 实现动作可用性矩阵
    - 针对 Mission status + operatorState 决定动作是否允许
    - 不允许动作返回结构化 409 错误
    - _Requirements: 2.1.1, 2.2.1, 3.1.1, 4.1.1, 5.1.1_

  - [x] 2.3 实现 `mark-blocked`
    - 强制 reason 必填
    - 写入 blocker 对象
    - 设置 `operatorState = blocked`
    - _Requirements: 3.1.1, 3.1.2, 3.1.3, 3.1.4_

  - [x] 2.4 实现 `resume`
    - 支持从 paused / blocked 恢复到 active
    - 清理 blocker 高亮但保留历史
    - _Requirements: 2.2.1, 2.2.2, 3.2.1, 3.2.2_

  - [x] 2.5 实现 `retry`
    - 校验可重试状态
    - `attempt += 1`
    - 重新进入 Mission 执行链路
    - 保留历史记录
    - _Requirements: 4.1.1, 4.1.2, 4.1.3, 4.1.4, 4.1.5_

  - [x] 2.6 实现 `terminate`
    - 设置 `operatorState = terminating`
    - 调用 `cancelMission(...)`
    - 历史记录中写明 `terminate`
    - _Requirements: 5.1.1, 5.1.2, 5.1.3, 5.1.4, 5.1.5_

- [x] 3. 增加操作动作 API
  - [x] 3.1 在 `server/routes/tasks.ts` 中新增 `POST /:id/operator-actions`
    - 接收 `action`、`reason`、`requestedBy`
    - 返回最新 MissionRecord 与动作摘要
    - _Requirements: 1.2.1, 1.2.2, 1.2.3_

  - [x] 3.2 编写操作动作路由测试
    - pause / resume / retry / mark-blocked / terminate
    - invalid action / missing reason / invalid state
    - _Requirements: 2.1.1, 3.1.2, 4.1.5, 5.1.2_

- [x] 4. 扩展 MissionRuntime / MissionStore
  - [x] 4.1 增加 operatorState / blocker / attempt 持久化支持
    - Mission snapshot 正确保存与恢复
    - _Requirements: 1.1.3, 1.1.4, 3.1.4, 4.1.2_

  - [x] 4.2 广播动作导致的 Mission 更新
    - 复用 `mission_event`
    - 确保前端 1 秒内收到状态变化
    - _Requirements: 6.1.3, 6.1.4_

- [x] 5. 扩展 executor 控制能力
  - [x] 5.1 更新 `shared/executor/api.ts`
    - 增加 pause / resume 路由常量与请求响应类型
    - _Requirements: 2.1.3, 2.2.3_

  - [x] 5.2 在 `services/lobster-executor/src/service.ts` 中增加 pause/resume
    - queued job: 控制进入执行
    - running job: 调用 Docker pause/unpause
    - _Requirements: 2.1.3, 2.2.3_

  - [x] 5.3 在 `services/lobster-executor/src/app.ts` 中暴露 pause/resume API
    - _Requirements: 2.1.3, 2.2.3_

  - [x] 5.4 在 `services/lobster-executor/src/docker-runner.ts` 中实现容器 pause/unpause
    - `container.pause()`
    - `container.unpause()`
    - _Requirements: 2.1.3, 2.2.3_

  - [x] 5.5 编写 executor 控制测试
    - queued pause/resume
    - running pause/resume
    - 重复 pause/resume 幂等
    - _Requirements: 2.1.4, 2.2.4_

- [x] 6. 新增前端操作栏
  - [x] 6.1 创建 `client/src/components/tasks/OperatorActionBar.tsx`
    - 动态渲染可用动作
    - 每个动作独立 loading
    - _Requirements: 7.1.1, 7.1.2, 7.1.4_

  - [x] 6.2 接入 blocker 卡片与最新动作摘要
    - 展示 blocker reason / createdAt
    - 展示 latest operator action
    - _Requirements: 3.1.4, 6.1.4_

  - [x] 6.3 将 `OperatorActionBar` 集成到 `TaskDetailView.tsx`
    - 放在头部主信息区
    - 与现有决策面板、执行面板协同
    - _Requirements: 7.1.1, 7.2.1, 7.2.2, 7.2.3_

  - [x] 6.4 扩展 `client/src/lib/tasks-store.ts`
    - 暴露 `submitOperatorAction`
    - 维护 per-action loading 状态
    - 处理 Socket 更新
    - _Requirements: 1.2.3, 7.1.4_

  - [x] 6.5 为前端交互编写测试
    - 按钮显隐
    - blocker reason 必填
    - terminate 二次确认
    - paused / blocked 附加标签展示
    - _Requirements: 7.1.2, 7.2.2, 7.2.3_

- [x] 7. 最终验证
  - [x] 7.1 验证 pause -> resume 闭环
  - [x] 7.2 验证 mark-blocked -> resume 闭环
  - [x] 7.3 验证 failed/cancelled -> retry 闭环
  - [x] 7.4 验证 terminate 复用 cancel 闭环

## Notes

- `terminate` 不应另起停止链路，必须复用 `mission-cancel-control`
- `retry` 若一期无法在同 Mission 内完整复跑，可先实现为“重试当前 Mission attempt”，但需要在设计与 UI 中清楚标记 attempt 编号
- 若 executor pause/resume 需要拆期，可先做控制层状态与 UI 版本，再补容器级真控制
