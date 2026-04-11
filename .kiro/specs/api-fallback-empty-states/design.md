# API Fallback Empty States - 设计文档

## 概述

本设计通过“轻量公共请求封装 + 页面级空态/错误态组件 + 分批接入”的方式，统一系统的请求兜底与无数据体验。

## 设计原则

1. 技术错误不直出
2. 用户能理解当前是离线、演示、空数据还是失败
3. 先轻量封装，再逐页接入
4. retry 要就地完成，不依赖整页刷新

## 请求层策略

建议新增轻量公共能力，例如：

- `fetchJsonSafe()`
- `ApiError` 结构
- `isDemoModeFallback` 判断

统一处理：

- 非 JSON 响应
- HTML fallback
- 4xx / 5xx 响应
- 网络错误

## 页面层策略

### 1. 空态

统一空态结构：

- 为什么为空
- 下一步建议
- 可选 CTA

### 2. 错误态

统一错误结构：

- 发生了什么
- 是否可重试
- 推荐动作

## 分批接入建议

### 第一批：低冲突 store

- `lineage-store`
- `audit-store`
- `permission-store`
- `reputation-store`
- `telemetry-store`
- `cost-store`

### 第二批：高频路径

- `workflow-store`
- `tasks` 相关请求
- `ChatPanel`

第二批需要与主路径 worktree 协调接入顺序。

## Worktree 并行建议

### 推荐 owner

- Worktree C: 新增公共请求工具、治理低冲突 store、补空态与错误态组件

### 可以并行

- 可立即启动，不依赖导航结构冻结
- 可与 `workspace-visual-unification` 协同统一空态和错误态视觉

### 不建议并行

- 不建议在 `task-hub-convergence` 正在大改 `TasksPage` 和任务高频 store 时同时接入第二批文件
- 不建议在 `workflow-panel-decomposition` 正在重构 `workflow-store` 时并线其高频改动

## 测试策略

- 非 JSON 响应处理测试
- 演示模式文案测试
- 空态 CTA 测试
- retry 交互测试

## 交付顺序

1. 公共请求工具
2. 低冲突 store 接入
3. 重点页面空态与错误态
4. 高频路径接入
