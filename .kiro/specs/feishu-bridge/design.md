# 飞书集成 设计文档

## 概述

飞书集成模块由 FeishuProgressBridge（核心桥接器）、relay 鉴权、webhook 去重、消息投递等组件构成。从 `openclaw-feishu-progress` 项目迁移而来，重写为 Express 路由风格。核心实现在 `server/feishu/` 目录下。

## 组件架构

```
飞书 / OpenClaw Relay
  │
  ▼
POST /api/feishu/relay
  │
  ├── relay-auth.ts → 鉴权校验
  ├── webhook-dedup-store.ts → 事件去重
  │
  ▼
ingress.ts → 解析请求 → 创建 Mission
  │
  ▼
FeishuProgressBridge
  ├── bindTask(taskId, target) → 绑定飞书对话
  ├── createRequestAck() → 生成 ACK 消息
  ├── handleTaskUpdate(task) → 状态变化时投递消息
  │     ├── progress → 进度消息
  │     ├── waiting → 等待确认消息
  │     ├── done → 完成消息
  │     └── failed → 失败消息
  │
  ▼
delivery.ts → FeishuBridgeDelivery 接口
  ├── send(message) → 发送新消息
  └── update(messageId, message) → 更新已有消息（卡片模式）
```

## 核心类：FeishuProgressBridge (`server/feishu/bridge.ts`)

### 消息格式

支持两种格式（由 `FEISHU_MESSAGE_FORMAT` 控制）：

1. **text** — 纯文本消息，包含进度条 emoji 和状态描述
2. **card** — 飞书交互卡片，包含彩色 header、进度条、按钮

### 卡片 Header 颜色映射
| Mission 状态 | 卡片 template |
|-------------|--------------|
| running/progress | blue |
| waiting | orange |
| done/complete | green |
| failed | red |

### 消息投递队列
每个 taskId 维护独立的投递队列（`enqueueDelivery`），确保同一任务的消息按顺序发送。队列使用 Promise 链实现串行化。

### 终态摘要控制
`resolveFinalSummaryMode()` 根据配置决定是否发送终态摘要：
- `"none"` — 不发送
- `"complete"` — 仅完成时发送
- `"failed"` — 仅失败时发送
- `"both"` — 完成和失败都发送

### 回复上下文
首次发送消息后记录 `messageId`，后续消息自动携带 `replyMessageId` 回复到同一线程。卡片模式下支持 `update()` 更新已有卡片而非发送新消息。

## 文件清单

| 文件 | 职责 |
|------|------|
| `bridge.ts` | FeishuProgressBridge 核心类、卡片构建、消息格式化 |
| `config.ts` | 飞书配置读取（环境变量） |
| `delivery.ts` | FeishuBridgeDelivery 接口定义和实现 |
| `ingress.ts` | 请求解析和 Mission 创建 |
| `relay.ts` | Relay 路由处理 |
| `relay-auth.ts` | Relay 鉴权校验 |
| `runtime.ts` | 飞书运行时初始化 |
| `task-start.ts` | 任务启动逻辑 |
| `task-store.ts` | 飞书侧任务状态存储 |
| `webhook-dedup-store.ts` | 事件 ID 去重（TTL 自动清理） |
| `webhook-security.ts` | Webhook 签名校验 |
| `workflow-dispatcher.ts` | 工作流调度桥接 |
| `workflow-tracker.ts` | 工作流状态跟踪 |

## REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/feishu/relay | 接收 OpenClaw relay 请求 |
| POST | /api/feishu/relay/event | 手动推送 relay 事件 |
| POST | /api/feishu/webhook | 接收飞书 webhook/卡片回调 |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| FEISHU_ENABLED | 是否启用飞书集成 | false |
| FEISHU_MODE | mock / relay / webhook | mock |
| FEISHU_RELAY_SECRET | Relay 鉴权密钥 | - |
| FEISHU_BASE_TASK_URL | 任务页面 URL 前缀 | - |
| FEISHU_MESSAGE_FORMAT | text / card | text |
| FEISHU_SUPPRESS_FINAL_SUMMARY | 是否抑制终态摘要 | false |
