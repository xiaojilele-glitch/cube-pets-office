# Implementation Plan: A2A Protocol

## Overview

实现 Agent-to-Agent 标准化协议，让 Cube Agent 与外部框架 Agent（CrewAI / LangGraph / Claude）实现双向互操作。实现顺序：协议类型定义 → ExternalAgentNode 扩展 → A2A Client → 框架适配器 → A2A Server → MessageBus 路由扩展 → API 路由 → 3D 可视化 → 集成联调。

## Tasks

- [x] 1. 定义 A2A 协议类型和工具函数
  - [x] 1.1 在 `shared/a2a-protocol.ts` 中定义所有 A2A 协议类型
    - 定义 A2AFrameworkType、A2AMethod、A2AEnvelope、A2AInvokeParams、A2AResponse、A2AResult、A2AArtifact、A2AError、A2AStreamChunk 接口
    - 定义 A2ASessionStatus、A2ASession、ExternalAgentRegistration 接口
    - 定义 A2A_ERROR_CODES 常量对象
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x] 1.2 在 `shared/a2a-protocol.ts` 中实现序列化/反序列化和工具函数
    - 实现 `serializeEnvelope(envelope)` 和 `deserializeEnvelope(json)` 函数
    - 实现 `serializeSession(session)` 和 `deserializeSession(json)` 函数
    - 实现 `validateContext(context)` 函数（检查长度不超过 2000 字符）
    - 实现 `createEnvelope(method, params, auth?)` 工厂函数（自动生成 UUID id，设置 jsonrpc 为 "2.0"）
    - _Requirements: 1.6, 9.1, 9.5_
  - [x] 1.3 编写 A2AEnvelope 序列化往返属性测试
    - 在 `server/tests/a2a-protocol.test.ts` 中使用 fast-check
    - 实现 `arbitraryA2AInvokeParams` 和 `arbitraryA2AEnvelope` 生成器
    - **Property 1: A2AEnvelope 序列化往返一致性**
    - **Validates: Requirements 1.6**
  - [x] 1.4 编写 A2ASession 序列化往返和上下文验证属性测试
    - 实现 `arbitraryA2ASession` 生成器
    - **Property 2: A2ASession 序列化往返一致性**
    - **Validates: Requirements 9.5**
    - **Property 3: 上下文长度验证**
    - **Validates: Requirements 1.2, 9.1**

- [x] 2. 扩展 ExternalAgentNode 类型
  - [x] 2.1 在 `shared/organization-schema.ts` 中定义 ExternalAgentNode 接口
    - 继承 GuestAgentNode（来自 agent-marketplace spec），新增 frameworkType、a2aEndpoint、a2aAuth 字段
    - 确保与现有 WorkflowOrganizationSnapshot 结构兼容
    - _Requirements: 6.1, 6.3_
  - [x] 2.2 编写 ExternalAgentNode 快照兼容性属性测试
    - 实现 `arbitraryExternalAgentNode` 生成器
    - **Property 13: ExternalAgentNode 快照兼容性**
    - **Validates: Requirements 6.3**

- [x] 3. Checkpoint - 确保协议类型层测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 4. 实现框架适配器
  - [x] 4.1 定义 FrameworkAdapter 接口并实现 CrewAI 适配器
    - 在 `server/core/a2a-adapters/types.ts` 中定义 FrameworkAdapter 接口
    - 在 `server/core/a2a-adapters/crewai.ts` 中实现 CrewAIAdapter
    - adaptRequest：将 A2AInvokeParams 转换为 CrewAI task execution 格式（agent role、task description、expected output）
    - adaptResponse：将 CrewAI 响应转换为 A2AResult
    - _Requirements: 4.1, 4.4_
  - [x] 4.2 实现 LangGraph 适配器
    - 在 `server/core/a2a-adapters/langgraph.ts` 中实现 LangGraphAdapter
    - adaptRequest：将 A2AInvokeParams 转换为 LangGraph graph invoke 格式（input state、config）
    - adaptResponse：将 LangGraph 响应转换为 A2AResult
    - _Requirements: 4.2, 4.4_
  - [x] 4.3 实现 Claude 适配器
    - 在 `server/core/a2a-adapters/claude.ts` 中实现 ClaudeAdapter
    - adaptRequest：将 A2AInvokeParams 转换为 Claude Messages API 格式（system prompt、messages、tools）
    - adaptResponse：将 Claude 响应转换为 A2AResult
    - _Requirements: 4.3, 4.4_
  - [x] 4.4 创建适配器注册表
    - 在 `server/core/a2a-adapters/index.ts` 中导出所有适配器和 `getAdapter(frameworkType)` 工厂函数
    - 不支持的框架类型返回错误并包含支持的框架列表
    - _Requirements: 4.5_
  - [x] 4.5 编写框架适配器属性测试
    - **Property 9: 框架适配器请求格式正确性**
    - **Validates: Requirements 4.1, 4.2, 4.3**
    - **Property 10: 框架适配器响应归一化**
    - **Validates: Requirements 4.4**
    - **Property 11: 不支持的框架类型拒绝**
    - **Validates: Requirements 4.5**

- [x] 5. 实现 A2A Client
  - [x] 5.1 在 `server/core/a2a-client.ts` 中实现 A2AClient 类
    - 实现 `invoke(params, frameworkType, endpoint, auth?)` 同步调用方法
    - 实现 `invokeStream(params, frameworkType, endpoint, auth?)` 流式调用方法
    - 实现 `cancel(sessionId)` 取消方法
    - 实现 `getActiveSessions()` 和 `getSession(sessionId)` 查询方法
    - 实现 `terminateTimedOutSessions()` 超时清理方法
    - 实现并发会话数量限制（默认 10）
    - 构建 A2AEnvelope 时自动包含 auth 令牌
    - 从工作流上下文提取摘要时截断到 2000 字符
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 5.3, 9.1, 9.3, 9.4_
  - [x] 5.2 编写 A2A Client 属性测试
    - **Property 4: 会话失败状态标记**
    - **Validates: Requirements 2.5, 9.4**
    - **Property 5: 并发会话数量限制**
    - **Validates: Requirements 2.6**
    - **Property 12: 出站信封包含认证令牌**
    - **Validates: Requirements 5.3**

- [x] 6. 实现 A2A Server
  - [x] 6.1 在 `server/core/a2a-server.ts` 中实现 A2AServer 类
    - 实现 `handleInvoke(envelope, apiKey)` 同步处理方法
    - 实现 `handleStream(envelope, apiKey)` 流式处理方法
    - 实现 `handleCancel(sessionId, apiKey)` 取消处理方法
    - 实现 `listExposedAgents()` 列出可调用 Agent
    - 实现 `validateApiKey(key)` API Key 验证（从环境变量 A2A_API_KEYS 读取）
    - 实现 `checkRateLimit(key)` 滑动窗口速率限制（默认每分钟 60 次）
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.1, 5.2, 5.4, 5.5_
  - [x] 6.2 编写 A2A Server 属性测试
    - **Property 6: 无效认证令牌拒绝**
    - **Validates: Requirements 3.6, 5.1**
    - **Property 7: 不存在的 Agent 返回错误**
    - **Validates: Requirements 3.7**
    - **Property 8: 速率限制执行**
    - **Validates: Requirements 5.4, 5.5**
    - **Property 15: 可调用 Agent 列表完整性**
    - **Validates: Requirements 3.5**

- [x] 7. Checkpoint - 确保 Client/Server 核心测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 8. 扩展 MessageBus A2A 路由
  - [x] 8.1 在 `server/core/message-bus.ts` 中扩展 A2A 路由
    - 实现 `sendA2A(fromId, toExternalId, content, workflowId, metadata?)` 方法
    - 在 send 方法中检测目标为 ExternalAgentNode 时自动路由到 A2A_Client
    - 实现 `deliverA2AResponse(sessionId, response, workflowId)` 方法
    - A2A 消息元数据标记 `a2a: true`、`frameworkType`、`sessionId`
    - 通过 Socket.IO 发射 `a2a_message` 事件
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x] 8.2 编写 MessageBus A2A 路由属性测试
    - **Property 14: A2A 消息路由与元数据正确性**
    - **Validates: Requirements 7.1, 7.3**

- [x] 9. 实现 A2A API 路由
  - [x] 9.1 在 `server/routes/a2a.ts` 中实现所有 A2A 端点
    - `POST /api/a2a/invoke`：验证 Bearer token → 解析 A2AEnvelope → 调用 A2AServer.handleInvoke → 返回 A2AResponse
    - `POST /api/a2a/stream`：验证 Bearer token → 解析 A2AEnvelope → 调用 A2AServer.handleStream → SSE 响应
    - `POST /api/a2a/cancel`：验证 Bearer token → 调用 A2AServer.handleCancel
    - `GET /api/a2a/agents`：调用 A2AServer.listExposedAgents
    - `GET /api/a2a/sessions`：调用 A2AClient.getActiveSessions
    - 错误处理：401/404/429/500 对应 JSON-RPC 错误格式
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.4, 5.5, 9.3_
  - [x] 9.2 在 `server/index.ts` 中注册 A2A 路由到 `/api/a2a`
    - 导入 a2a 路由并挂载
    - _Requirements: 3.1_
  - [x] 9.3 编写 API 路由单元测试
    - 测试 401（无效 token）、404（Agent 不存在）、429（速率限制）、500（内部错误）响应
    - 测试成功调用返回 A2AResponse
    - 测试 SSE 流式响应格式
    - _Requirements: 3.1, 3.6, 3.7, 5.4_

- [x] 10. Checkpoint - 确保 API 层测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 11. 实现 3D 场景跨框架可视化
  - [x] 11.1 创建 `client/src/lib/a2a-store.ts` A2A 状态 Store
    - 定义 A2AState 接口（activeSessions、a2aMessages）
    - 实现 Zustand store，监听 Socket.IO `a2a_message` 事件
    - _Requirements: 8.4_
  - [x] 11.2 创建 `client/src/components/three/CrossFrameworkParticles.tsx` 粒子流组件
    - 渲染菱形粒子 + 渐变色轨迹（区别于跨 Pod 圆形粒子）
    - 框架颜色映射：CrewAI 蓝色、LangGraph 紫色、Claude 橙色、Custom 灰色
    - 活跃会话显示框架类型标签
    - 完成时绿色脉冲，失败时红色脉冲
    - _Requirements: 8.1, 8.2, 8.3, 8.5_
  - [x] 11.3 在 `client/src/components/Scene3D.tsx` 中集成 CrossFrameworkParticles
    - 导入并渲染 CrossFrameworkParticles 组件
    - _Requirements: 8.1_

- [x] 12. 集成动态组织和工作流引擎
  - [x] 12.1 扩展 `server/core/dynamic-organization.ts` 支持 ExternalAgentNode
    - 在组织生成逻辑中识别 "@external-xxx" 引用模式
    - 为识别到的外部 Agent 创建 ExternalAgentNode 并纳入组织快照
    - _Requirements: 6.2_
  - [x] 12.2 扩展工作流引擎支持 ExternalAgentNode 任务分配
    - 在任务分配逻辑中检测 ExternalAgentNode，通过 A2A_Client 转发任务
    - 将 A2A 调用结果注入工作流上下文
    - 将完成的 A2ASession 追加到 Mission 事件列表
    - _Requirements: 6.4, 2.4, 9.2_

- [x] 13. Final Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

## Notes

- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP
- 每个任务引用了具体的需求编号以确保可追溯性
- 属性测试使用 fast-check 库，每个属性对应设计文档中的一个正确性属性
- 测试文件统一放在 `server/tests/a2a-protocol.test.ts`
- 3D 可视化效果（需求 8）需要手动视觉验证，不包含自动化测试
- 框架适配器当前为协议格式转换，实际外部 Agent 的 HTTP 调用在集成测试中使用 mock
