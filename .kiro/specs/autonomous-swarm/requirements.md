# 需求文档

## 简介

实现跨 Pod 自主协作机制，让多个临时作战区（Pod，即当前系统中的 Department）能够自主发起子任务、互相委派、协同完成复杂目标，形成真正的"Agent 社会"。该功能扩展现有的 MessageBus 和 HeartbeatScheduler，新增 SwarmOrchestrator 协作引擎，并在 3D 场景中可视化跨 Pod 协作流。

## 术语表

- **Pod**：临时作战区，对应当前系统中的 `WorkflowOrganizationDepartment`，由一个 Manager 和若干 Worker 组成
- **SwarmOrchestrator**：跨 Pod 协作引擎，负责协作发现、请求路由、子任务委派和结果汇总
- **CollaborationRequest**：跨 Pod 协作请求，由源 Pod 的 Manager 发起，包含所需能力描述和上下文摘要
- **CollaborationSession**：一次完整的跨 Pod 协作会话，从请求发起到结果汇总的全生命周期
- **MessageBus**：Agent 间消息总线，当前仅支持层级内通信，需扩展支持跨 Pod 通道
- **HeartbeatScheduler**：心跳调度器，定期生成 Agent 状态报告，需升级为支持协作机会发现
- **MissionOrchestrator**：任务编排器，管理 Mission 生命周期，需集成跨 Pod 子任务结果
- **协作深度**：跨 Pod 协作的嵌套层数上限，防止无限递归协作（默认最大 3 层）
- **能力描述符**：Pod 对外声明的能力标签集合，用于协作匹配
- **粒子流**：3D 场景中表示跨 Pod 消息传递的可视化动画效果

## 需求

### 需求 1：跨 Pod 消息通道

**用户故事：** 作为系统开发者，我希望 MessageBus 支持跨 Pod 消息传递，以便不同 Pod 的 Manager 之间能够直接通信。

#### 验收标准

1. WHEN 一个 Manager 向另一个 Pod 的 Manager 发送跨 Pod 消息, THE MessageBus SHALL 验证双方均为 Manager 角色后投递消息
2. WHEN 一个非 Manager 角色的 Agent 尝试发送跨 Pod 消息, THE MessageBus SHALL 拒绝该消息并返回 `cross_pod_unauthorized` 错误码
3. WHEN 跨 Pod 消息发送成功, THE MessageBus SHALL 在消息元数据中标记 `crossPod: true` 并记录源 Pod 和目标 Pod 标识
4. WHEN 跨 Pod 消息发送成功, THE MessageBus SHALL 通过 Socket.IO 发射 `cross_pod_message` 事件，包含源 Pod、目标 Pod 和消息摘要
5. THE MessageBus SHALL 仅传递消息摘要（前 200 字符），完整内容需通过独立接口拉取

### 需求 2：协作协议类型定义

**用户故事：** 作为系统开发者，我希望有明确的跨 Pod 协作协议类型，以便各模块基于统一的数据结构进行协作通信。

#### 验收标准

1. THE 协作协议 SHALL 定义 `CollaborationRequest` 类型，包含请求 ID、源 Pod ID、所需能力描述、上下文摘要和协作深度
2. THE 协作协议 SHALL 定义 `CollaborationResponse` 类型，包含响应状态（accepted / rejected / busy）、目标 Pod ID 和预估完成时间
3. THE 协作协议 SHALL 定义 `CollaborationResult` 类型，包含结果摘要、子任务产出和完成状态
4. THE 协作协议 SHALL 定义 `CollaborationSession` 类型，包含会话 ID、请求、响应、结果和时间戳序列
5. WHEN 序列化 `CollaborationSession` 为 JSON 再反序列化, THE 协作协议 SHALL 产生与原始对象等价的结果

### 需求 3：协作机会自主发现

**用户故事：** 作为 Pod Manager，我希望系统能基于心跳报告自动发现跨 Pod 协作机会，以便在无需 CEO 干预的情况下发起协作。

#### 验收标准

1. WHEN HeartbeatScheduler 生成心跳报告, THE SwarmOrchestrator SHALL 分析报告中的 actionItems 和 observations 以识别潜在协作需求
2. WHEN 识别到协作需求, THE SwarmOrchestrator SHALL 基于目标 Pod 的能力描述符匹配最合适的协作目标
3. WHEN 匹配到合适的目标 Pod, THE SwarmOrchestrator SHALL 自动生成 `CollaborationRequest` 并发送给目标 Pod 的 Manager
4. IF 没有匹配到合适的目标 Pod, THEN THE SwarmOrchestrator SHALL 记录日志并放弃本次协作尝试，不产生错误

### 需求 4：子任务生成与委派

**用户故事：** 作为目标 Pod 的 Manager，我希望收到协作请求后能自动生成子任务并分配给 Worker 执行，以便高效完成跨 Pod 协作。

#### 验收标准

1. WHEN 目标 Pod 的 Manager 接受协作请求, THE SwarmOrchestrator SHALL 调用 LLM 生成与请求能力匹配的子任务描述
2. WHEN 子任务生成完成, THE SwarmOrchestrator SHALL 将子任务分配给目标 Pod 内的可用 Worker
3. WHEN 子任务执行完成, THE SwarmOrchestrator SHALL 将结果封装为 `CollaborationResult` 并回传给源 Pod
4. IF 子任务执行失败, THEN THE SwarmOrchestrator SHALL 在 `CollaborationResult` 中标记失败状态和错误原因

### 需求 5：协作安全与限制

**用户故事：** 作为系统管理员，我希望跨 Pod 协作有严格的权限和资源限制，以防止滥用和系统过载。

#### 验收标准

1. THE SwarmOrchestrator SHALL 限制协作深度上限为可配置值（默认 3 层），超过上限的协作请求被拒绝
2. THE SwarmOrchestrator SHALL 限制同时进行的跨 Pod 协作会话数量为可配置值（默认 3 个）
3. WHEN 一个 Pod 发起协作请求, THE SwarmOrchestrator SHALL 验证请求的能力描述符属于源 Pod 的合法请求范围
4. WHEN 协作会话超过可配置的超时时间（默认 5 分钟）, THE SwarmOrchestrator SHALL 自动终止该会话并通知双方
5. IF 当前活跃协作会话数已达上限, THEN THE SwarmOrchestrator SHALL 拒绝新的协作请求并返回 `swarm_capacity_exceeded` 状态

### 需求 6：协作结果汇总到 Mission

**用户故事：** 作为系统用户，我希望跨 Pod 协作的结果能自动汇总到主 Mission 报告中，以便完整了解任务执行情况。

#### 验收标准

1. WHEN 一个 CollaborationSession 完成, THE MissionOrchestrator SHALL 将协作结果追加到对应 Mission 的事件列表中
2. WHEN Mission 生成最终报告, THE MissionOrchestrator SHALL 在报告中包含所有关联的跨 Pod 协作摘要
3. WHEN 协作结果汇总时, THE MissionOrchestrator SHALL 记录源 Pod、目标 Pod、协作耗时和结果状态

### 需求 7：3D 场景跨 Pod 协作可视化

**用户故事：** 作为系统用户，我希望在 3D 场景中看到跨 Pod 消息的粒子流动画和协作高亮效果，以便直观理解 Agent 间的协作动态。

#### 验收标准

1. WHEN 跨 Pod 消息发送时, THE Scene3D SHALL 在源 Pod 和目标 Pod 之间渲染粒子流动画
2. WHEN 一个 CollaborationSession 处于活跃状态, THE Scene3D SHALL 高亮显示参与协作的 Pod 区域
3. WHEN CollaborationSession 结束, THE Scene3D SHALL 淡出粒子流动画和高亮效果
4. THE Scene3D SHALL 使用不同颜色区分不同的协作会话，并通过透明度控制避免视觉混乱
5. WHEN 收到 `cross_pod_message` Socket.IO 事件, THE Scene3D SHALL 在 200ms 内开始渲染对应的粒子流动画
