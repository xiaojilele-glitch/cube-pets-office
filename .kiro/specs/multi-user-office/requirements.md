# 需求文档

## 简介

实现多人实时协作像素办公室功能。多个用户可同时进入同一个 3D 办公室房间，每人独立发布指令、生成各自的 Pod 和临时作战区，同时共享部分 Agent（如 CEO）和全局视图。系统通过 WebSocket 实现实时状态同步，支持办公室内聊天和权限隔离，单房间上限 8 人。

## 术语表

- **Room**：一个多人协作会话空间，由唯一 roomId 标识，包含参与者列表和共享状态
- **Pod**：用户发布指令后在 3D 场景中生成的独立工作区域，归属于特定用户
- **Shared_Agent**：房间内所有用户共享的 Agent 实例（如 CEO、公共服务 Agent）
- **Private_Agent**：仅归属于特定用户的 Agent 实例（如用户专属 Guest Agent）
- **Room_Service**：服务端负责房间生命周期管理的模块
- **Sync_Engine**：负责在房间内所有客户端之间同步状态变更的引擎
- **Avatar**：3D 场景中代表用户的像素小人模型
- **Room_Chat**：房间内的实时聊天系统，支持 @提及功能
- **Multi_User_Store**：客户端 Zustand store，管理多人协作相关的本地状态

## 需求

### 需求 1：房间生命周期管理

**用户故事：** 作为用户，我希望能创建或加入一个协作房间，以便与其他人在同一个 3D 办公室中协作。

#### 验收标准

1. WHEN 用户请求创建房间, THE Room_Service SHALL 生成唯一 roomId 并返回可分享的邀请链接
2. WHEN 用户通过邀请链接或 roomId 请求加入房间, THE Room_Service SHALL 将该用户添加到房间参与者列表并通知房间内所有现有成员
3. WHILE 房间参与者数量已达到 8 人上限, WHEN 新用户请求加入, THE Room_Service SHALL 拒绝加入请求并返回房间已满的提示
4. WHEN 用户主动离开房间或断开连接, THE Room_Service SHALL 将该用户从参与者列表移除并通知房间内剩余成员
5. WHILE 房间内无任何参与者且空闲时间超过 30 分钟, THE Room_Service SHALL 自动销毁该房间并释放相关资源
6. WHEN 用户请求获取房间列表, THE Room_Service SHALL 返回当前所有活跃房间的 roomId、名称和参与者数量

### 需求 2：用户独立指令与 Pod 生成

**用户故事：** 作为房间内的用户，我希望独立发布指令并生成属于自己的 Pod，以便在共享空间中进行个人工作。

#### 验收标准

1. WHEN 用户在房间内提交指令, THE Room_Service SHALL 为该用户创建一个关联 ownerUserId 的独立 Pod 和对应的动态组织
2. WHEN Pod 创建完成, THE Sync_Engine SHALL 将新 Pod 的位置和状态广播给房间内所有参与者
3. THE Room_Service SHALL 确保每个 Pod 的 ownerUserId 字段与创建者的用户标识一致
4. WHEN 用户提交多条指令, THE Room_Service SHALL 为每条指令分别创建独立的 Pod

### 需求 3：共享 Agent 与私有 Agent

**用户故事：** 作为房间内的用户，我希望能使用房间共享的 Agent（如 CEO），同时拥有自己的私有 Agent，以便在协作中保持独立性。

#### 验收标准

1. WHEN 房间创建时, THE Room_Service SHALL 实例化一组 Shared_Agent（CEO 和公共服务 Agent）供所有参与者使用
2. WHEN 用户提交指令生成 Pod, THE Room_Service SHALL 为该 Pod 创建归属于该用户的 Private_Agent 实例
3. THE Room_Service SHALL 确保 Private_Agent 仅响应其 ownerUserId 对应用户的请求
4. WHEN 用户离开房间, THE Room_Service SHALL 清理该用户的所有 Private_Agent 实例

### 需求 4：3D 场景多人渲染

**用户故事：** 作为房间内的用户，我希望在 3D 场景中看到其他用户的 Avatar 和他们的 Pod，以便了解协作全貌。

#### 验收标准

1. WHEN 用户加入房间, THE Scene3D SHALL 在 3D 场景中为该用户渲染一个像素小人 Avatar
2. WHEN 用户的 Avatar 位置发生变化, THE Sync_Engine SHALL 将位置更新广播给房间内所有参与者
3. WHEN 房间内存在多个用户的 Pod, THE Scene3D SHALL 同时渲染所有用户的 Pod 及其内部 Agent
4. WHEN 用户离开房间, THE Scene3D SHALL 从 3D 场景中移除该用户的 Avatar

### 需求 5：实时状态同步

**用户故事：** 作为房间内的用户，我希望实时看到其他用户的 Agent 移动、消息粒子流和 Pod 状态变化，以便保持对协作进展的感知。

#### 验收标准

1. WHEN Agent 位置发生变化, THE Sync_Engine SHALL 在 200ms 内将位置更新广播给房间内所有参与者
2. WHEN 消息粒子流产生, THE Sync_Engine SHALL 将粒子流数据广播给房间内所有参与者
3. WHEN Pod 状态发生变化（创建、进度更新、完成）, THE Sync_Engine SHALL 将状态变更广播给房间内所有参与者
4. WHEN Mission 进度更新, THE Sync_Engine SHALL 将进度数据广播给房间内所有参与者
5. THE Sync_Engine SHALL 对状态同步采用最后写入胜出策略和乐观更新机制来处理并发冲突

### 需求 6：房间内实时聊天

**用户故事：** 作为房间内的用户，我希望能与其他参与者实时聊天并 @提及特定用户，以便进行协作沟通。

#### 验收标准

1. WHEN 用户发送聊天消息, THE Room_Chat SHALL 将消息广播给房间内所有参与者
2. WHEN 用户在消息中使用 @用户名 语法, THE Room_Chat SHALL 解析提及内容并高亮显示被提及用户的消息
3. WHEN 用户加入房间, THE Room_Chat SHALL 向该用户发送最近 50 条聊天历史记录
4. THE Room_Chat SHALL 在每条消息中包含发送者用户名、发送时间戳和消息内容

### 需求 7：权限控制

**用户故事：** 作为房间内的用户，我希望只能操作自己的 Pod 和 Agent，以便保护其他用户的工作不被误操作。

#### 验收标准

1. WHEN 用户尝试操作非自己拥有的 Pod, THE Room_Service SHALL 拒绝该操作并返回权限不足的提示
2. WHEN 用户尝试向非自己拥有的 Private_Agent 发送请求, THE Room_Service SHALL 拒绝该请求
3. THE Room_Service SHALL 允许所有用户向 Shared_Agent 发送请求
4. THE Room_Service SHALL 通过比对操作请求中的 userId 与资源的 ownerUserId 来验证权限

### 需求 8：房间列表与邀请

**用户故事：** 作为用户，我希望能浏览可用房间列表并通过链接邀请他人加入，以便快速开始协作。

#### 验收标准

1. WHEN 用户访问房间列表页面, THE Room_Service SHALL 展示所有活跃房间的名称、参与者数量和创建时间
2. WHEN 房间创建者请求生成邀请链接, THE Room_Service SHALL 生成包含 roomId 的 URL 路径
3. WHEN 用户通过邀请链接访问应用, THE Multi_User_Store SHALL 自动解析 URL 中的 roomId 并发起加入房间请求
