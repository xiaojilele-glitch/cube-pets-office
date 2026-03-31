# 多人实时协作办公室 设计文档

## 概述

在现有 Socket.IO 实时通信基础上，引入 Room 概念实现多人协作。每个 Room 是一个独立的协作空间，最多容纳 8 人。用户通过邀请链接加入同一 Room 后，各自独立发布指令生成 Pod，同时共享 CEO 等公共 Agent，3D 场景实时渲染所有参与者的 Avatar、Pod 和消息粒子流。

## 系统架构

```
用户 A (浏览器)                    用户 B (浏览器)
  │                                  │
  ├── Multi_User_Store (Zustand)     ├── Multi_User_Store (Zustand)
  ├── Scene3D (Avatar + Pod 渲染)    ├── Scene3D (Avatar + Pod 渲染)
  │                                  │
  └──────── Socket.IO ───────────────┘
                  │
                  ▼
          ┌─────────────────┐
          │   Room_Service   │
          │  (server/core/   │
          │   room-manager)  │
          ├─────────────────┤
          │ rooms: Map<      │
          │   roomId,        │
          │   RoomState>     │
          ├─────────────────┤
          │ Sync_Engine      │
          │ (Socket.IO Room  │
          │  broadcast)      │
          ├─────────────────┤
          │ Room_Chat        │
          │ (消息历史缓存)    │
          └─────────────────┘
                  │
                  ▼
          现有模块（不修改核心逻辑）
          ├── dynamic-organization.ts (增加 ownerUserId)
          ├── workflow-engine.ts
          ├── mission-orchestrator.ts
          └── socket.ts (扩展 Room 支持)
```

## 核心数据模型

### RoomUser
```typescript
interface RoomUser {
  userId: string;        // 唯一用户标识（UUID）
  username: string;      // 显示名称
  avatarColor: string;   // Avatar 颜色（从预设色板分配）
  joinedAt: string;      // ISO 时间戳
  socketId: string;      // 当前 Socket.IO 连接 ID
}
```

### RoomState
```typescript
interface RoomState {
  roomId: string;           // 唯一房间标识（UUID）
  name: string;             // 房间名称
  createdBy: string;        // 创建者 userId
  createdAt: string;        // ISO 时间戳
  users: RoomUser[];        // 当前参与者列表（≤8）
  sharedAgentIds: string[]; // 共享 Agent ID 列表（CEO 等）
  pods: RoomPod[];          // 所有用户的 Pod
  chatHistory: ChatMessage[]; // 最近 50 条聊天记录
  lastActivityAt: string;   // 最后活跃时间（用于超时清理）
}
```

### RoomPod
```typescript
interface RoomPod {
  podId: string;            // 唯一 Pod 标识
  ownerUserId: string;      // 归属用户
  directive: string;        // 用户指令
  workflowId?: string;      // 关联的工作流 ID
  missionId?: string;       // 关联的 Mission ID
  status: "creating" | "running" | "completed" | "failed";
  position: { x: number; y: number; z: number }; // 3D 场景位置
  createdAt: string;
}
```

### ChatMessage
```typescript
interface ChatMessage {
  messageId: string;
  roomId: string;
  senderId: string;
  senderName: string;
  content: string;
  mentions: string[];       // 被 @提及的 userId 列表
  timestamp: string;        // ISO 时间戳
}
```


## 新增文件清单

| 文件路径 | 职责 |
|---------|------|
| `shared/room.ts` | Room 相关类型定义（RoomState、RoomUser、RoomPod、ChatMessage、Socket 事件） |
| `server/core/room-manager.ts` | Room_Service 核心实现（房间 CRUD、用户管理、超时清理） |
| `server/routes/rooms.ts` | REST API 路由（`/api/rooms`） |
| `client/src/lib/multi-user-store.ts` | Zustand store（房间状态、Socket 监听、聊天） |
| `client/src/components/RoomChatPanel.tsx` | 房间内聊天面板组件 |
| `server/tests/room-manager.test.ts` | Room_Service 单元测试 |
| `scripts/multi-user-room-smoke.mjs` | 多人房间 smoke 测试 |
| `docs/multi-user-office.md` | 使用文档 |

## 修改文件清单

| 文件路径 | 修改内容 |
|---------|---------|
| `server/core/socket.ts` | 扩展 `initSocketIO` 支持 Room 事件注册 |
| `server/index.ts` | 注册 `/api/rooms` 路由 |
| `server/core/dynamic-organization.ts` | `WorkflowOrganizationSnapshot` 增加 `ownerUserId` 字段 |
| `shared/organization-schema.ts` | 类型定义增加 `ownerUserId` |
| `client/src/components/Scene3D.tsx` | 渲染其他用户 Avatar 和多用户 Pod |
| `client/src/lib/store.ts` | 增加 `currentRoomId`、`currentUserId` 状态 |
| `client/src/App.tsx` | 增加 `/room/:roomId` 路由 |

## Socket.IO Room 事件协议

利用 Socket.IO 原生 Room 机制，所有房间内事件仅广播给同一 Room 的成员。

### 客户端 → 服务端事件

| 事件名 | payload | 说明 |
|--------|---------|------|
| `room:join` | `{ roomId, userId, username }` | 请求加入房间 |
| `room:leave` | `{ roomId, userId }` | 请求离开房间 |
| `room:chat` | `{ roomId, userId, content }` | 发送聊天消息 |
| `room:avatar-move` | `{ roomId, userId, position }` | Avatar 位置更新 |

### 服务端 → 客户端事件（Room 广播）

| 事件名 | payload | 说明 |
|--------|---------|------|
| `room:state` | `RoomState` | 加入房间后的完整状态快照 |
| `room:user-joined` | `RoomUser` | 新用户加入通知 |
| `room:user-left` | `{ userId }` | 用户离开通知 |
| `room:pod-created` | `RoomPod` | 新 Pod 创建通知 |
| `room:pod-updated` | `Partial<RoomPod> & { podId }` | Pod 状态更新 |
| `room:chat-message` | `ChatMessage` | 聊天消息广播 |
| `room:avatar-moved` | `{ userId, position }` | Avatar 位置广播 |
| `room:agent-moved` | `{ agentId, ownerUserId, position }` | Agent 位置广播 |
| `room:particle-flow` | `{ fromAgentId, toAgentId, ownerUserId, color }` | 消息粒子流广播 |
| `room:error` | `{ code, message }` | 错误通知（房间满、权限不足等） |

## REST API

| 方法 | 路径 | 说明 | 请求体 | 响应 |
|------|------|------|--------|------|
| POST | `/api/rooms` | 创建房间 | `{ name, userId, username }` | `{ roomId, inviteUrl }` |
| GET | `/api/rooms` | 房间列表 | - | `RoomListItem[]` |
| GET | `/api/rooms/:roomId` | 房间详情 | - | `RoomState` |
| DELETE | `/api/rooms/:roomId` | 销毁房间 | - | `{ ok: true }` |

## Room_Service 核心逻辑

### 房间生命周期

```typescript
class RoomManager {
  private rooms: Map<string, RoomState> = new Map();
  private cleanupTimer: NodeJS.Timeout;

  // 创建房间：生成 roomId，初始化共享 Agent
  createRoom(name: string, creator: RoomUser): RoomState

  // 加入房间：校验人数上限，分配 Avatar 颜色，广播 user-joined
  joinRoom(roomId: string, user: RoomUser): RoomState

  // 离开房间：移除用户，清理私有 Agent，广播 user-left
  leaveRoom(roomId: string, userId: string): void

  // 定时清理：每 5 分钟扫描，空闲超过 30 分钟的房间自动销毁
  startCleanupScheduler(): void
}
```

### 权限校验

```typescript
function assertOwnership(userId: string, resource: { ownerUserId: string }): void {
  if (resource.ownerUserId !== userId) {
    throw new RoomPermissionError("权限不足：只能操作自己的资源");
  }
}
```

所有涉及 Pod 操作和 Private Agent 请求的接口，在执行前调用 `assertOwnership` 校验。Shared Agent 请求跳过此校验。

### Avatar 颜色分配

预设 8 色色板：`["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F"]`

用户加入时按顺序分配，离开后颜色回收。每个用户的 Pod 边框和消息粒子流使用相同颜色。

## 3D 场景多人渲染

### Avatar 渲染
- 使用简单的 Box 几何体 + 用户颜色材质作为像素小人
- 头顶显示用户名标签（Billboard Text）
- 位置通过 `room:avatar-moved` 事件实时同步

### Pod 区分
- 每个 Pod 使用 ownerUserId 对应的颜色作为边框/光晕颜色
- 非当前用户的 Pod 透明度降低至 0.7，避免视觉干扰

### 消息粒子流
- 跨用户粒子流使用发送方用户的颜色
- 同一用户内部粒子流保持现有白色

## 状态同步策略

- 采用最后写入胜出（Last Write Wins）策略处理并发更新
- 客户端使用乐观更新：先本地更新 UI，再等待服务端确认
- Agent 位置同步频率限制为 5fps（200ms 间隔），避免网络拥塞
- Pod 状态变更立即广播，不做节流

## 房间超时清理

- `RoomManager` 启动时注册 `setInterval`，每 5 分钟扫描一次
- 房间 `lastActivityAt` 距当前时间超过 30 分钟且无在线用户时，自动销毁
- 销毁时清理所有关联的 Pod、Private Agent 和聊天历史
- 用户的任何操作（发指令、聊天、移动 Avatar）都会更新 `lastActivityAt`

## 测试框架

使用 Vitest 编写单元测试和属性测试。

## 正确性属性

### P1: 房间人数上限不变量
对于任意房间 r，在任意时刻 `r.users.length ≤ 8`。

### P2: Pod 归属一致性
对于任意 Pod p，`p.ownerUserId` 必须是当前房间参与者列表中某个用户的 `userId`，或该用户已离开但 Pod 尚未清理。

### P3: 权限隔离正确性
对于任意用户 u 和资源 r（Pod 或 Private Agent），若 `r.ownerUserId !== u.userId`，则 u 对 r 的任何写操作必须被拒绝。

### P4: 聊天历史有界性
对于任意房间 r，`r.chatHistory.length ≤ 50`。新消息加入时，若超出上限则移除最早的消息。

### P5: Avatar 颜色唯一性
对于任意房间 r 中的任意两个用户 u1、u2，若 `u1.userId !== u2.userId`，则 `u1.avatarColor !== u2.avatarColor`。

### P6: 房间清理安全性
房间被销毁时，其关联的所有 Pod、Private Agent 和聊天历史必须同步清理，不留孤立数据。
