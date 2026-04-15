# 全链路上线前修复与发布门禁总方案 v1

## 目标

本方案用于当前仓库的真实可达链路上线前收口，目标是让“已接线、已挂路由、已能从页面或 API 进入”的系统流程达到可发布状态。

本轮不覆盖以下方向：

- 多租户
- K8s
- VR
- 边缘部署
- 其他尚未接线或仅停留在实验稿的能力

外部前置条件记录如下：

- 线上入口沿用 Linux + FRP + 本地 `3000` 端口
- 域名、反代、公网拓扑不纳入本轮实现

## 发布门禁

### 必须满足

- 生产构建必须通过
- 服务端必须能在生产模式启动并暴露 `/api/health`
- TypeScript 类型检查必须通过
- 发布门禁内测试必须全绿
- 发布门禁脚本必须可由仓库根目录统一执行

### 不接受的状态

- 共享接口已漂移但长期靠 `any` 或测试绕过
- 已知失败测试长期挂起但不分类处理
- 首页、任务、执行器、回调、Socket、Artifacts、Replay、Lineage、Knowledge、Permission、Feishu 等主链路断链
- 生产启动脚本仅在单一 shell 下可用

## 流程矩阵

### 前台主流程

- `/`
- `/tasks`
- `/tasks/:taskId`
- `/command-center`
- `/replay/:missionId`
- `/lineage`

### 核心任务链路

- Mission 创建
- Mission 刷新
- Mission 取消
- Mission 暂停 / 恢复
- 决策提交
- Artifacts 预览 / 下载

### 执行链路

- Executor dispatch
- Callback 回传
- Log stream
- Screenshot stream
- Sandbox 预览
- Socket.IO 实时事件

### 系统服务链路

- Feishu 回传与卡片动作
- Knowledge / RAG
- Permission
- A2A
- Guest Agent
- Telemetry
- Voice
- Vision
- Export
- Analytics
- Config

## 发布范围原则

- 以“真实可用”优先，不做新产品扩展
- 优先修复现有契约和运行链路，不新增业务协议
- 可以清理陈旧测试和陈旧断言，但不能掩盖真实运行问题
