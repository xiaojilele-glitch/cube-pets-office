# 实施计划：Guest Agent（访客代理）

## 概述

基于已批准的需求和设计文档，将 Guest Agent 机制分解为增量编码任务。每个任务构建在前一个任务之上，最终将所有组件连接在一起。使用 TypeScript 实现，vitest 进行单元测试，fast-check 进行属性测试。

## 任务

- [ ] 1. 定义访客代理类型系统
  - [ ] 1.1 在 shared/organization-schema.ts 中新增 GuestSkillDescriptor、GuestAgentConfig、GuestAgentNode 接口
    - GuestAgentNode 继承 WorkflowOrganizationNode，新增 invitedBy、source、expiresAt、guestConfig 字段
    - GuestAgentConfig 包含 model、baseUrl、apiKey（可选）、skills、mcp、avatarHint
    - _Requirements: 1.1, 1.2_
  - [ ] 1.2 在 shared/runtime-agent.ts 的 RuntimeAgentConfig 中新增 isGuest 可选布尔字段
    - _Requirements: 1.3_
  - [ ] 1.3 新增 shared/guest-agent-utils.ts，实现 generateGuestId() 函数（返回 "guest_" + 8位随机hex）和 isGuestId(id) 判断函数，以及 sanitizeGuestConfig(config) 函数（将 apiKey 替换为 "***"）
    - _Requirements: 1.4, 7.3_
  - [ ]* 1.4 为 guest-agent-utils 编写属性测试
    - **Property 1: 访客代理创建返回 guest_ 前缀 ID**
    - **Property 10: GuestAgentConfig 序列化往返一致性**
    - **Property 11: API 响应隐藏 apiKey**
    - **Validates: Requirements 1.4, 2.1, 7.1, 7.2, 7.3**

- [ ] 2. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [ ] 3. 实现 GuestAgent 类和注册表扩展
  - [ ] 3.1 新增 server/core/guest-agent.ts，实现 GuestAgent 类继承 Agent
    - 构造函数接受 GuestAgentConfig，创建独立的 LLM provider（使用 config 中的 model/baseUrl/apiKey）
    - 生成 guest soul prompt（基于技能描述和角色信息）
    - _Requirements: 6.1, 6.2_
  - [ ] 3.2 扩展 server/core/registry.ts 的 AgentRegistry 类
    - 新增 guestAgents Map、registerGuest、unregisterGuest、getGuestAgents、getGuestCount、isGuest 方法
    - get(id) 方法同时查找 agents 和 guestAgents
    - registerGuest 中检查并发上限（MAX_GUESTS=5），超限抛出错误
    - _Requirements: 2.4, 2.6_
  - [ ]* 3.3 为 AgentRegistry 访客功能编写属性测试
    - **Property 2: register/unregister 往返**
    - **Property 4: 并发上限不变量**
    - **Validates: Requirements 2.4, 2.6, 2.7**
  - [ ]* 3.4 为 GuestAgent LLM 配置隔离编写属性测试
    - **Property 9: 访客代理使用独立 LLM 配置**
    - **Validates: Requirements 6.1**

- [ ] 4. 实现访客代理生命周期管理器
  - [ ] 4.1 新增 server/core/guest-lifecycle.ts，实现 GuestLifecycleManager 类
    - leaveOffice(guestId): 注销代理、递归删除工作区目录、发送 Socket 事件
    - onMissionComplete(workflowId): 遍历所有访客代理调用 leaveOffice
    - onMissionFailed(workflowId): 同上
    - _Requirements: 5.5, 2.5_
  - [ ]* 4.2 为生命周期管理器编写属性测试
    - **Property 3: 注销后注册表清空且工作区删除**
    - **Property 8: 任务结束自动清理所有访客代理**
    - **Validates: Requirements 2.3, 2.5, 5.5**

- [ ] 5. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [ ] 6. 实现 REST API 和消息总线扩展
  - [ ] 6.1 新增 server/routes/guest-agents.ts，实现 POST/GET/DELETE /api/agents/guest 端点
    - POST: 验证请求体，调用 registry.registerGuest，创建工作区，返回 sanitized 响应
    - GET: 返回 registry.getGuestAgents() 列表（apiKey 隐藏）
    - DELETE: 调用 lifecycleManager.leaveOffice，返回 204
    - _Requirements: 2.1, 2.2, 2.3, 2.7_
  - [ ] 6.2 在 server/index.ts 中注册 guest-agents 路由
    - _Requirements: 2.1_
  - [ ] 6.3 扩展 server/core/message-bus.ts 的 assertAgentExists 方法
    - 当 db.getAgent 找不到时，检查 registry.isGuest(id)，如果是访客代理则构造兼容的 AgentRow 返回
    - _Requirements: 5.2_
  - [ ]* 6.4 为 MessageBus 访客代理支持编写属性测试
    - **Property 6: MessageBus 层级验证支持访客代理**
    - **Validates: Requirements 5.2**

- [ ] 7. 实现自然语言邀请解析器
  - [ ] 7.1 新增 server/core/guest-invitation-parser.ts
    - parseInvitation(message): 使用正则匹配 "@Name" + 邀请关键词（"邀请"、"invite"、"请...加入"等）
    - 返回 ParsedInvitation { guestName, skills, context } 或 null
    - _Requirements: 3.1_
  - [ ]* 7.2 为邀请解析器编写属性测试
    - **Property 5: 自然语言邀请解析**
    - **Validates: Requirements 3.1**
  - [ ] 7.3 在 CEO Agent 的方向阶段集成邀请解析
    - 在 dynamic-organization.ts 的方向阶段检测邀请意图
    - 将解析结果传递给 CEO 进行审批判断
    - 审批通过后调用 registry.registerGuest 并发送 Socket 事件
    - _Requirements: 3.2, 3.4, 3.5_

- [ ] 8. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [ ] 9. 实现 AccessGuard 和记忆隔离
  - [ ] 9.1 验证现有 AccessGuard 对 guest_ 前缀 ID 的路径隔离
    - 确认 resolveAgentWorkspacePath 对 guest_xxx ID 正确隔离到 data/agents/guest_xxx/
    - 确认路径遍历攻击（"../other_agent/"）被阻止
    - _Requirements: 5.6_
  - [ ] 9.2 在 GuestAgent 类中实现记忆隔离
    - 覆盖 memoryRepo 的 buildPromptContext，仅返回当前 workflowId 的上下文
    - 覆盖 getSoulText，返回 guest 专用 soul 而非其他代理的 SOUL.md
    - _Requirements: 5.3, 5.4_
  - [ ]* 9.3 为 AccessGuard 和记忆隔离编写属性测试
    - **Property 7: AccessGuard 工作区隔离**
    - **Validates: Requirements 5.3, 5.6**

- [ ] 10. 实现前端 3D 场景扩展
  - [ ] 10.1 在 client/src/lib/agent-config.ts 中新增 resolveGuestAnimal(hint) 和 createGuestVisualConfig(node) 函数
    - 将 avatarHint 映射到现有 PET_MODELS 中的动物
    - 为访客代理生成 SceneAgentConfig，包含 Guest Pod 位置
    - _Requirements: 4.1_
  - [ ] 10.2 扩展 client/src/components/three/PetWorkers.tsx
    - 在 createDynamicSceneData 中处理 GuestAgentNode（检测 isGuest 或 guest_ 前缀）
    - 为访客代理分配 Guest Pod 位置（场景底部区域）
    - 名牌 HTML 中添加 "Guest" 徽章样式
    - _Requirements: 4.1, 4.2, 4.5_
  - [ ] 10.3 实现访客代理入场/退场动画
    - 入场：opacity 0→1 + scale 0.5→1 的 spring 动画
    - 退场：opacity 1→0 + scale 1→0.5 的动画
    - 通过 Socket 事件 guest_join / guest_leave 触发
    - _Requirements: 4.3, 4.4_
  - [ ]* 10.4 为 GuestAgentNode 与组织快照兼容性编写属性测试
    - **Property 12: GuestAgentNode 与组织快照兼容**
    - **Validates: Requirements 1.5**

- [ ] 11. 集成连接和飞书桥接
  - [ ] 11.1 在工作流完成/失败回调中集成 GuestLifecycleManager
    - 在 workflow engine 的 complete/fail 处理中调用 onMissionComplete/onMissionFailed
    - _Requirements: 5.5_
  - [ ] 11.2 在飞书桥接中集成 @GuestName 语法支持
    - 在飞书消息中继时检测 @GuestName 模式，触发邀请流程
    - _Requirements: 3.3_
  - [ ] 11.3 在工作流执行阶段集成访客代理任务分配
    - 确保 workflow engine 在 execution/review/revision 阶段能将任务分配给访客代理
    - _Requirements: 5.1_

- [ ] 12. 最终检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

## 备注

- 标记 `*` 的任务为可选测试任务，可跳过以加速 MVP
- 每个任务引用了具体的需求条目以确保可追溯性
- 检查点确保增量验证
- 属性测试验证通用正确性属性
- 单元测试验证具体示例和边界情况
