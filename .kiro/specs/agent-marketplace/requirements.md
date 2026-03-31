# 需求文档

## 简介

Guest Agent（访客代理）机制允许用户在任务执行期间邀请外部代理（第三方 LLM、其他 Cube 实例、Claude、CrewAI 代理等）临时加入像素办公室。访客代理在 3D 场景中以宠物角色呈现，参与工作流各阶段，并在任务结束后自动离开。

## 术语表

- **Guest_Agent（访客代理）**: 临时加入办公室参与单次任务的外部代理实例
- **GuestAgentNode**: 组织快照中表示访客代理的节点类型，继承自 WorkflowOrganizationNode
- **GuestAgentConfig**: 访客代理的配置对象，包含模型、连接信息、技能和视觉提示
- **AgentDirectory（代理注册表）**: server/core/registry.ts 中管理所有代理实例的注册中心
- **Scene3D（3D 场景）**: client 端基于 React Three Fiber 的 3D 办公室渲染组件
- **MessageBus（消息总线）**: 代理间通信系统，强制执行层级路由规则
- **AccessGuard（访问守卫）**: 工作区路径隔离机制，防止跨代理目录访问
- **Mission（任务）**: 一次完整的工作流执行周期，从指令下发到汇总完成
- **Feishu_Bridge（飞书桥接）**: 飞书消息中继服务

## 需求

### 需求 1：访客代理类型系统

**用户故事：** 作为开发者，我希望有一套完善的访客代理类型定义，以便访客代理能在组织结构、注册表和 3D 场景中被正确表示。

#### 验收标准

1. THE shared/organization-schema.ts SHALL 定义 GuestAgentNode 接口，继承 WorkflowOrganizationNode，新增字段：invitedBy（string，邀请者）、source（string，来源如 "manual"、"feishu"、"natural_language"）、expiresAt（number，过期时间戳）、guestConfig（GuestAgentConfig）
2. THE GuestAgentConfig SHALL 包含以下字段：model（string）、baseUrl（string）、apiKey（string，可选）、skills（技能描述数组）、mcp（MCP 绑定数组）、avatarHint（string，建议的动物/表情用于 3D 渲染）
3. THE shared/runtime-agent.ts SHALL 扩展 RuntimeAgentConfig，新增 isGuest 布尔字段以区分访客代理和常驻代理
4. THE System SHALL 对所有访客代理 ID 使用 "guest_" 前缀，防止与现有代理命名冲突
5. THE GuestAgentNode SHALL 与现有 WorkflowOrganizationSnapshot 结构兼容，使 PetWorkers.tsx 无需特殊处理即可渲染访客代理

### 需求 2：访客代理注册 API

**用户故事：** 作为开发者，我希望有 REST API 端点来创建、列出和移除访客代理。

#### 验收标准

1. WHEN 收到 POST /api/agents/guest 请求时，THE Server SHALL 接受 GuestAgentConfig 并返回创建的访客代理记录及其生成的 ID
2. WHEN 收到 GET /api/agents/guest 请求时，THE Server SHALL 返回当前活跃的访客代理列表
3. WHEN 收到 DELETE /api/agents/guest/:id 请求时，THE Server SHALL 移除指定访客代理并清理其工作区
4. THE AgentDirectory SHALL 支持通过 registerGuest(config) 和 unregisterGuest(id) 方法进行访客代理的临时注册和注销
5. WHEN 注册访客代理时，THE System SHALL 在 data/agents/guest_xxx/ 下创建临时工作区目录，该目录在访客离开时自动删除
6. THE System SHALL 强制限制最多 5 个并发访客代理，防止资源耗尽
7. IF 访客代理数量已达上限，THEN THE Server SHALL 返回 HTTP 409 错误并附带描述性消息

### 需求 3：自然语言邀请

**用户故事：** 作为用户，我希望通过聊天或飞书消息中的自然语言命令邀请访客代理。

#### 验收标准

1. WHEN 用户消息包含邀请模式（如 "邀请 @Claude-Researcher 一起分析竞品" 或 "invite @DataAnalyst to help"）时，THE System SHALL 解析意图并创建访客代理
2. THE Dynamic_Organization_Generator SHALL 在方向阶段识别访客邀请意图，并将访客代理纳入组织快照
3. THE Feishu_Bridge SHALL 支持中继消息中的 "@GuestName" 语法，触发访客代理创建
4. THE CEO_Agent SHALL 基于任务相关性（LLM 判断）批准或拒绝访客邀请
5. IF 邀请被批准，THEN THE System SHALL 发出 Socket 事件通知前端在 3D 场景中渲染新的访客代理

### 需求 4：3D 场景可视化

**用户故事：** 作为用户，我希望看到访客代理在 3D 办公室场景中以适当的动画出现和消失。

#### 验收标准

1. WHEN 访客代理加入时，THE Scene3D SHALL 在"访客区域"或临时 Pod 中渲染新的宠物角色，使用 GuestAgentConfig 中的 avatarHint 选择动物模型
2. THE Guest_Agent 的名牌 SHALL 包含 "Guest" 徽章，以视觉方式区分访客代理和常驻代理
3. WHEN 访客代理加入时，THE Scene3D SHALL 播放入场动画（淡入 + 缩放放大 + 粒子效果）
4. WHEN 访客代理离开时，THE Scene3D SHALL 播放退场动画（淡出 + 缩放缩小）
5. THE Guest_Agent SHALL 参与工作流执行期间的消息流路径（代理之间的动画连线）

### 需求 5：工作流集成与权限隔离

**用户故事：** 作为开发者，我希望访客代理能参与工作流阶段，同时与其他代理的私有数据隔离。

#### 验收标准

1. THE Workflow_Engine SHALL 允许访客代理在执行、评审和修订阶段被分配任务
2. THE MessageBus SHALL 允许 Guest → Manager 和 Manager → Guest 通信，遵循现有层级规则
3. THE Guest_Agent SHALL 无法访问其他代理的 SOUL.md 文件或长期记忆
4. THE Guest_Agent SHALL 仅能访问当前任务的上下文（消息、任务、组织快照）
5. WHEN 任务完成或失败时，THE System SHALL 自动触发所有访客代理的 leaveOffice()，清理其工作区并从注册表和 3D 场景中移除
6. THE AccessGuard SHALL 对访客代理强制执行工作区隔离，防止路径遍历到其他代理的目录

### 需求 6：访客代理 LLM 调用

**用户故事：** 作为开发者，我希望访客代理使用独立的 LLM 配置进行调用，与系统默认配置隔离。

#### 验收标准

1. THE GuestAgent SHALL 使用 GuestAgentConfig 中指定的 model、baseUrl 和 apiKey 进行 LLM 调用，而非系统默认配置
2. THE GuestAgent SHALL 复用现有 RuntimeAgent 的 invoke/invokeJson 接口，仅替换底层 LLM 提供者
3. IF 访客代理的 LLM 调用失败，THEN THE System SHALL 记录错误并通知其上级 Manager，不影响其他代理的执行

### 需求 7：访客代理序列化与反序列化

**用户故事：** 作为开发者，我希望访客代理配置能正确序列化到组织快照和 API 响应中，并能从中恢复。

#### 验收标准

1. THE System SHALL 将 GuestAgentConfig 序列化为 JSON 格式存入组织快照
2. FOR ALL 合法的 GuestAgentConfig 对象，序列化后再反序列化 SHALL 产生等价的对象（往返一致性）
3. THE API 响应 SHALL 在返回访客代理信息时隐藏 apiKey 字段（替换为 "***"）
