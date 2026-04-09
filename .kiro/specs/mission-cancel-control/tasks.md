# 实施计划：mission-cancel-control

## 概述

本任务将为 Mission 补齐端到端取消能力，涉及 shared contracts、server 任务路由、MissionRuntime、lobster-executor 取消接口、Docker 运行时停止逻辑，以及前端任务详情取消交互。

## Tasks

- [ ] 1. 扩展共享合同与状态枚举
  - [ ] 1.1 更新 `shared/mission/contracts.ts`
    - `MISSION_STATUSES` 新增 `cancelled`
    - 为 `MissionRecord` 增加 `cancelledAt?`、`cancelledBy?`、`cancelReason?`
    - 如采用独立事件类型，则补充 `MISSION_EVENT_TYPES` 的 `cancelled`
    - _Requirements: 4.1.1, 4.1.2, 1.2.3_

  - [ ] 1.2 更新 `shared/mission/socket.ts`
    - 新增 `MISSION_SOCKET_TYPES.recordCancelled`
    - 扩展 `MissionSocketRecordEvent` 联合类型
    - _Requirements: 4.1.4_

  - [ ] 1.3 更新前端本地状态类型
    - `client/src/lib/tasks-store.ts` 和相关 helper 支持 `cancelled`
    - 状态标签、色板、筛选函数识别 `cancelled`
    - _Requirements: 4.1.3, 5.2.1_

- [ ] 2. 实现 Mission 侧取消能力
  - [ ] 2.1 在 `server/tasks/mission-store.ts` 中新增 `markCancelled()`
    - 写入 `status = cancelled`
    - 清理 `waitingFor` 与 `decision`
    - 记录取消原因与时间
    - 追加事件并持久化
    - _Requirements: 2.1.3, 4.1.2, 1.2.1, 1.2.2_

  - [ ] 2.2 在 `server/tasks/mission-runtime.ts` 中新增 `cancelMission()`
    - 封装 store 操作
    - 广播 `mission.record.cancelled`
    - _Requirements: 2.1.4, 4.1.4_

  - [ ] 2.3 为 Mission cancel 编写单元测试
    - 普通取消
    - waiting Mission 取消
    - 重复取消幂等
    - _Requirements: 2.2.1, 2.2.2, 2.2.3_

- [ ] 3. 增加任务取消路由
  - [ ] 3.1 在 `server/routes/tasks.ts` 中新增 `POST /:id/cancel`
    - 解析 `reason`、`requestedBy`、`source`
    - Mission 不存在返回 404
    - 已终态 Mission 幂等返回当前数据
    - _Requirements: 1.1.1, 1.1.2, 1.1.3_

  - [ ] 3.2 接入 executor cancel 转发逻辑
    - Mission 具备有效 `executor.jobId` 时调用 executor cancel API
    - 无 jobId 时走本地取消
    - executor 不可达时返回明确错误
    - _Requirements: 2.1.1, 2.1.2_

  - [ ] 3.3 为取消路由编写集成测试
    - 本地取消路径
    - executor 转发路径
    - 已终态幂等路径
    - _Requirements: 1.1.4, 2.2.1, 2.2.2_

- [ ] 4. 实现 executor cancel API
  - [ ] 4.1 更新 `shared/executor/api.ts`
    - 明确 cancel 路由请求/响应类型
    - _Requirements: 3.1.1_

  - [ ] 4.2 在 `services/lobster-executor/src/service.ts` 中新增 `cancel()`
    - queued job 直接取消
    - waiting job 直接取消
    - running job 转发给运行时控制
    - 已终态幂等返回
    - _Requirements: 3.1.2, 3.1.3, 3.1.4, 3.1.6_

  - [ ] 4.3 在 `services/lobster-executor/src/app.ts` 中实现 `POST /api/executor/jobs/:id/cancel`
    - 去掉 `501`
    - 返回结构化结果
    - _Requirements: 3.1.1_

  - [ ] 4.4 为 executor cancel 编写服务层测试
    - 不存在 job
    - queued job
    - waiting job
    - 已终态 job
    - _Requirements: 3.1.2, 3.1.3, 3.1.4, 3.1.6_

- [ ] 5. 打通 Docker 运行中任务停止
  - [ ] 5.1 扩展 `StoredJobRecord` 保存取消上下文
    - 记录 `cancelRequested`
    - 保存运行中容器标识或控制句柄
    - _Requirements: 3.1.5_

  - [ ] 5.2 在 `services/lobster-executor/src/docker-runner.ts` 中实现运行中 cancel
    - 优先 stop
    - 超时后 kill
    - 发出 `job.cancelled`
    - 保留现有 artifacts 和日志文件
    - _Requirements: 3.1.5, 3.2.1, 3.2.2, 3.2.3_

  - [ ] 5.3 为 Docker cancel 编写测试
    - stop 成功
    - stop 超时后 kill
    - cancel 过程中日志追加
    - _Requirements: 3.1.5, 3.2.1, 3.2.3_

- [ ] 6. 调整 executor callback 到 Mission 状态映射
  - [ ] 6.1 更新 `server/index.ts`
    - `job.cancelled` -> `mission.cancelled`
    - 不再与 `failed` 复用同一路径
    - _Requirements: 4.2.1, 4.2.2, 4.2.3_

  - [ ] 6.2 编写事件映射测试
    - `job.cancelled` 事件后 Mission 进入 `cancelled`
    - waiting Mission 收到取消后清空决策
    - _Requirements: 4.2.1, 4.2.3_

- [ ] 7. 增加前端取消交互
  - [ ] 7.1 扩展 `client/src/lib/mission-client.ts` 或任务客户端
    - 新增 `cancelMission(taskId, payload)`
    - _Requirements: 5.1.1, 5.1.2_

  - [ ] 7.2 扩展 `client/src/lib/tasks-store.ts`
    - 暴露 cancel action
    - 维护提交中状态
    - 处理 Socket 回写
    - _Requirements: 5.1.3, 5.1.4, 5.2.2_

  - [ ] 7.3 更新 `client/src/components/tasks/TaskDetailView.tsx`
    - 增加取消按钮
    - 增加确认对话框与原因输入
    - 终态后隐藏继续执行类按钮
    - _Requirements: 5.1.1, 5.1.2, 5.2.3_

  - [ ] 7.4 更新任务列表页状态展示
    - 任务列表显示 `cancelled`
    - 状态色与文案区分 `failed`
    - _Requirements: 5.2.1_

  - [ ] 7.5 编写前端测试
    - 按钮显隐
    - 提交 loading
    - 取消后状态回显
    - _Requirements: 5.1.3, 5.1.4, 5.2.1, 5.2.2_

- [ ] 8. 最终验证
  - [ ] 8.1 运行 server 相关测试
  - [ ] 8.2 运行 executor 相关测试
  - [ ] 8.3 运行前端任务面板相关测试
  - [ ] 8.4 手动验证 queued / running / waiting 三种取消路径

## Notes

- 本 spec 完成后，`mission-operator-actions` 可以直接复用 cancel 链路实现 `terminate`
- 若运行中取消存在 callback 延迟，前端可先显示“Cancel requested”，但 Mission 终态仍以 `job.cancelled` 为准
