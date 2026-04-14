# 实施计划：intelligent-launch-convergence

## 概述

本 spec 负责把当前办公室和任务页里的双发起入口，收敛成一个统一智能入口。实施策略是：

- 先统一入口壳层
- 再打通 mission / workflow 返回值
- 最后逐步删除双入口心智和兼容代码

## Worktree 并行建议

- 建议单一 owner 负责 `OfficeTaskCockpit.tsx`、`TasksPage.tsx`、`nl-command-store.ts`、`workflow-store.ts`
- 若存在并行 worktree，不要同时大改办公室命令区和 workflow 提交契约
- 在统一入口落地前，不建议其他改动继续强化 `launchMode` 双按钮结构

## Tasks

- [x] 1. 盘点并抽取双入口的共享能力
  - [x] 1.1 盘点 `TasksCommandDock` 中可复用的能力
    - 文本输入
    - 澄清问答
    - 任务落队结果
    - 计划摘要
    - _Requirements: 1.1.2, 3.1.1, 3.1.2, 7.1.3_
  - [x] 1.2 盘点 `OfficeWorkflowLaunchPanel` 中可复用的能力
    - 附件添加和移除
    - 附件解析错误提示
    - directive 提交
    - 运行模式升级提示
    - _Requirements: 2.1.2, 4.1.1, 4.1.2, 5.1.1_

- [x] 2. 实现统一智能路由层
  - [x] 2.1 新增 `client/src/lib/launch-router.ts`
    - 实现 `mission / workflow / clarify / upgrade-required` 路由判断
    - 输出结构化路由原因
    - _Requirements: 2.1.1, 2.1.2, 2.1.3, 5.1.1_
  - [x] 2.2 为路由层补充单元测试
    - 无附件完整文本 -> mission
    - 信息不足 -> clarify
    - 带附件 -> workflow
    - 需要真实执行但当前前端模式 -> upgrade-required
    - _Requirements: 2.1.1, 2.1.2, 3.1.1, 5.1.1_

- [x] 3. 新增统一发起协调层
  - [x] 3.1 新增 `client/src/lib/unified-launch-coordinator.ts`
    - 统一调用 `nl-command-store`、`workflow-store`、`tasks-store`
    - 归一化提交结果模型
    - _Requirements: 2.1.4, 6.1.1, 7.1.1, 7.1.2, 7.1.3_
  - [x] 3.2 定义统一提交结果类型
    - `UnifiedLaunchInput`
    - `LaunchRouteDecision`
    - `UnifiedLaunchResult`
    - _Requirements: 7.1.3, 8.1.1_

- [x] 4. 扩展 workflow 提交契约，消费 missionId
  - [x] 4.1 更新 `client/src/lib/workflow-store.ts`
    - 扩展 `WorkflowCreateResponse`，包含 `missionId`
    - 调整 `submitDirective` 返回结构
    - _Requirements: 6.1.1, 6.1.2_
  - [x] 4.2 校准 `server/routes/workflows.ts` 返回契约
    - 确保新建 workflow、去重返回、兼容返回的字段一致
    - 必要时为去重场景补齐 `missionId`
    - _Requirements: 6.1.1, 6.1.2, 8.1.3_

- [x] 5. 实现统一用户可见组件
  - [x] 5.1 新增 `client/src/components/launch/UnifiedLaunchComposer.tsx`
    - 一个输入框
    - 一个附件入口
    - 一个提交按钮
    - 一个路由反馈条
    - 一个澄清区
    - _Requirements: 1.1.2, 3.1.2, 4.1.1, 5.1.2_
  - [x] 5.2 抽取共享子组件
    - 附件条
    - 路由结果提示条
    - 运行模式升级提示
    - _Requirements: 2.1.4, 4.1.2, 5.1.1, 5.1.3_

- [x] 6. 接入办公室驾驶舱
  - [x] 6.1 更新 `client/src/components/office/OfficeTaskCockpit.tsx`
    - 用 `UnifiedLaunchComposer` 替换现有 `launchMode` 双入口切换
    - 保留内部兼容逻辑，但隐藏用户可见双按钮
    - _Requirements: 1.1.1, 1.1.2, 7.1.4_
  - [x] 6.2 保留 workflow 回落兼容
    - 若已有 `missionId` 直接聚焦
    - 若暂无 `missionId` 继续保留 `pendingLaunch` fallback
    - _Requirements: 6.1.1, 6.1.2, 6.1.3_

- [x] 7. 接入任务页
  - [x] 7.1 更新 `client/src/pages/tasks/TasksPage.tsx`
    - 顶部命令区改为统一入口
    - 保持现有任务列表与详情联动
    - _Requirements: 1.1.3, 7.1.1, 8.1.3_
  - [x] 7.2 确保办公室和任务页复用同一入口模型
    - 避免再次分叉出两套文案和状态
    - _Requirements: 1.1.3, 7.1.3_

- [ ] 8. 收口 nl-command 与旧入口心智
  - [x] 8.1 更新 `client/src/lib/nl-command-store.ts`
    - 让其更明确承担统一入口下的草稿、澄清和计划摘要子能力
    - _Requirements: 3.1.3, 7.1.3_
  - [x] 8.2 清理用户可见的旧文案
    - “任务命令”
    - “高级发起”
    - 改为用户可理解的结果提示文案
    - _Requirements: 1.1.1, 2.1.4_

- [ ] 9. 测试与验证
  - [x] 9.1 编写路由规则测试
    - _Requirements: 2.1.1, 2.1.2, 2.1.3_
  - [x] 9.2 编写统一入口组件测试
    - 提交状态
    - 澄清状态
    - 附件状态
    - 运行模式升级提示
    - _Requirements: 3.1.2, 4.1.2, 5.1.1_
  - [x] 9.3 编写集成测试
    - mission 创建成功后自动聚焦
    - workflow 创建成功且返回 missionId 后自动聚焦
    - workflow 去重场景不丢失焦点
    - _Requirements: 6.1.1, 6.1.2, 6.1.3_
  - [ ] 9.4 手动验证桌面端闭环
    - 输入普通任务
    - 输入需澄清任务
    - 输入带附件任务
    - 输入需高级执行任务
    - _Requirements: 1.1.2, 2.1.2, 3.1.1, 5.1.1_

## Notes

- 这次改造的核心不是“把两个表单拼成一个”，而是“让用户不再承担内部路由判断”。
- Phase 1 的成功标准是：用户只看到一个统一入口，且能正常完成普通任务发起、高级附件发起和澄清补问三类主流程。
- 若短期内无法完全删除旧组件，也必须先把它们降为统一入口内部实现，而不是继续作为用户可见的并列主入口。
