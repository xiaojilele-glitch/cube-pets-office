---
inclusion: auto
---

# Cube Pets Office 项目总览

## 项目定位

多智能体可视化教学平台。用户输入自然语言指令，系统动态组建 AI 团队，通过十阶段管道协作执行，3D 办公场景实时展示过程。支持纯浏览器预演和服务端完整执行两种模式。

## 技术栈

- 前端：React 19 + Vite + TypeScript + Zustand + Three.js (React Three Fiber)
- 后端：Express + Socket.IO + TypeScript
- AI：OpenAI 兼容接口（当前主 LLM 为 GLM-5-turbo）
- 存储：浏览器 IndexedDB / 服务端本地 JSON

## 系统架构

```
┌─────────────────────────────────────────────────────┐
│                    入口层                             │
│  用户浏览器 · 飞书 Relay                              │
├─────────────────────────────────────────────────────┤
│                    前端层                             │
│  3D 场景 · 工作流面板 · 任务驾驶舱 · 配置面板          │
│  浏览器运行时 (IndexedDB + Web Worker)                │
│  i18n (中/英) · 移动端适配                            │
├─────────────────────────────────────────────────────┤
│                  Cube Brain (服务端)                  │
│  动态组织生成 · 十阶段工作流引擎 · Mission Runtime     │
│  ExecutionPlan 构建 · Executor Client                │
│  飞书 Bridge                                         │
├─────────────────────────────────────────────────────┤
│                    记忆层                             │
│  短期记忆 (会话) · 中期记忆 (向量检索)                 │
│  长期记忆 (SOUL.md) · 心跳调度 · 自进化引擎           │
├─────────────────────────────────────────────────────┤
│                    执行层                             │
│  Lobster Executor (Docker 参考执行器)                 │
│  HMAC 签名回调 · 工件管理                             │
├─────────────────────────────────────────────────────┤
│                   持久化层                            │
│  database.json · Mission 快照 · Agent 工作空间        │
│  IndexedDB (浏览器端)                                 │
└─────────────────────────────────────────────────────┘
```

## 完整目录结构

```
cube-pets-office/
├── client/                          # 前端应用
│   ├── index.html                   # HTML 入口
│   ├── public/                      # 静态资源
│   │   ├── favicon.svg
│   │   ├── kenney_cube-pets_1.0/    # 宠物 GLB 模型（bunny/cat/dog/lion 等 15 种）
│   │   └── kenney_furniture-kit/    # 家具 GLTF 模型（桌椅/书架/沙发等 140 种）
│   └── src/
│       ├── App.tsx                  # 路由入口（wouter）
│       ├── main.tsx                 # React 挂载点
│       ├── index.css                # Tailwind 全局样式
│       ├── const.ts                 # 前端常量
│       ├── vite-env.d.ts            # Vite 类型声明
│       ├── components/
│       │   ├── Scene3D.tsx          # 3D 办公场景主组件
│       │   ├── WorkflowPanel.tsx    # 工作流进度面板（三级信息密度）
│       │   ├── ChatPanel.tsx        # 聊天面板（Browser Direct / Server Proxy）
│       │   ├── ConfigPanel.tsx      # 配置面板（Frontend/Advanced 模式切换）
│       │   ├── Toolbar.tsx          # 顶部工具栏（配置/工作流/对话/帮助）
│       │   ├── LoadingScreen.tsx    # 像素风毛玻璃加载页
│       │   ├── GitHubRepoBadge.tsx  # GitHub 仓库入口徽章
│       │   ├── ErrorBoundary.tsx    # React 错误边界
│       │   ├── ManusDialog.tsx      # Manus 对话框
│       │   ├── Map.tsx              # 地图组件
│       │   ├── PdfViewer.tsx        # PDF 查看器
│       │   ├── three/               # Three.js 子组件（灯光/家具/宠物/区域）
│       │   ├── tasks/               # 任务驾驶舱组件
│       │   │   ├── TaskDetailView.tsx      # 任务详情（Overview/Execution/Artifacts）
│       │   │   ├── TaskPlanetInterior.tsx  # 六阶段环形可视化
│       │   │   ├── CreateMissionDialog.tsx # 创建 Mission 对话框
│       │   │   └── task-helpers.ts         # 任务辅助函数
│       │   └── ui/                  # shadcn/ui 基础组件
│       ├── contexts/
│       │   └── ThemeContext.tsx      # 主题上下文
│       ├── hooks/
│       │   ├── useComposition.ts    # 输入法组合状态
│       │   ├── useMobile.tsx        # 移动端检测
│       │   ├── usePersistFn.ts      # 持久化回调
│       │   └── useViewportTier.ts   # 视口档位（≥1280/768-1279/<768）
│       ├── i18n/
│       │   ├── index.ts             # useI18n() hook
│       │   └── messages.ts          # 中英文文案字典
│       ├── lib/
│       │   ├── store.ts             # Zustand 全局 store（locale/模式/面板开关）
│       │   ├── workflow-store.ts    # 工作流 store（列表/详情/Socket 监听）
│       │   ├── tasks-store.ts       # Mission store（2800+ 行，mission-first + workflow 补充层）
│       │   ├── mission-client.ts    # Mission REST API 封装
│       │   ├── ai-config.ts         # AI 配置管理
│       │   ├── agent-config.ts      # 智能体配置
│       │   ├── browser-llm.ts       # 浏览器端 LLM 直连
│       │   ├── browser-runtime-storage.ts  # IndexedDB 持久化层（12 个 store）
│       │   ├── browser-runtime-sync.ts     # 浏览器/服务端数据同步
│       │   ├── workflow-attachments.ts     # 附件解析（PDF/Word/Excel/OCR）
│       │   ├── deploy-target.ts     # 部署目标检测（GitHub Pages/本地）
│       │   ├── locale.ts            # 语言工具
│       │   ├── assets.ts            # 资源路径工具
│       │   ├── utils.ts             # 通用工具
│       │   └── runtime/             # 运行时辅助
│       ├── pages/
│       │   ├── Home.tsx             # 首页（3D 场景 + 面板）
│       │   ├── NotFound.tsx         # 404 页面
│       │   └── tasks/
│       │       ├── TasksPage.tsx    # 任务驾驶舱页面
│       │       └── TaskDetailPage.tsx # 任务详情页面
│       └── runtime/
│           └── browser-runtime.ts   # 浏览器端 WorkflowRuntime 实现
│
├── server/                          # 服务端
│   ├── index.ts                     # Express 入口（路由注册/Socket/执行器回调/Smoke 路由）
│   ├── core/
│   │   ├── workflow-engine.ts       # 十阶段工作流引擎（1300+ 行）
│   │   ├── dynamic-organization.ts  # LLM 驱动的动态组织生成（1100+ 行）
│   │   ├── mission-orchestrator.ts  # Mission 编排器（800+ 行）
│   │   ├── execution-plan-builder.ts # 结构化执行计划构建
│   │   ├── executor-client.ts       # 远端执行器 HTTP 客户端
│   │   ├── agent.ts                 # Agent 基类（LLM 调用/上下文注入）
│   │   ├── registry.ts              # 智能体注册表（AgentDirectory 实现）
│   │   ├── message-bus.ts           # 层级消息总线（CEO↔Manager↔Worker）
│   │   ├── llm-client.ts            # LLM API 封装（主模型 + fallback）
│   │   ├── heartbeat.ts             # 心跳调度器（定时搜索/LLM 总结/报告）
│   │   ├── evolution.ts             # 自进化引擎（弱维度分析/SOUL 补丁/关键词学习）
│   │   ├── capability-registry.ts   # 能力注册表（EMA 置信度更新）
│   │   ├── access-guard.ts          # 工作空间隔离守卫（路径遍历防护）
│   │   ├── ai-config.ts             # AI 配置读取（.env 唯一真源）
│   │   └── socket.ts                # Socket.IO 初始化和事件广播
│   ├── db/
│   │   ├── index.ts                 # 本地 JSON 数据库（agents/workflows/tasks/messages/scores）
│   │   ├── seed.ts                  # 18 个智能体种子数据
│   │   └── mission-storage.ts       # Mission 快照文件持久化
│   ├── memory/
│   │   ├── session-store.ts         # 短期记忆（会话上下文构建/LLM 交换记录）
│   │   ├── vector-store.ts          # 中期记忆（96 维本地向量化/余弦相似度检索）
│   │   ├── soul-store.ts            # 长期记忆（SOUL.md 文件管理/数据库双向同步）
│   │   ├── report-store.ts          # 报告生成与落盘（部门报告/最终报告）
│   │   └── workspace.ts             # 工作空间目录管理
│   ├── tasks/
│   │   ├── index.ts                 # 任务模块入口
│   │   ├── mission-store.ts         # Mission 状态机（六阶段/create/running/waiting/done/failed）
│   │   ├── mission-store.file.ts    # Mission 文件快照存储
│   │   ├── mission-runtime.ts       # Mission 运行时（store + Socket 广播）
│   │   └── mission-decision.ts      # Mission 决策提交（幂等）
│   ├── feishu/
│   │   ├── bridge.ts                # FeishuProgressBridge（ACK/进度/等待/完成/失败回传）
│   │   ├── config.ts                # 飞书配置
│   │   ├── delivery.ts              # 消息投递接口
│   │   ├── ingress.ts               # 请求解析
│   │   ├── relay.ts                 # Relay 路由
│   │   ├── relay-auth.ts            # Relay 鉴权
│   │   ├── runtime.ts               # 飞书运行时初始化
│   │   ├── task-start.ts            # 任务启动
│   │   ├── task-store.ts            # 飞书侧任务状态
│   │   ├── webhook-dedup-store.ts   # 事件 ID 去重（TTL 清理）
│   │   ├── webhook-security.ts      # Webhook 签名校验
│   │   ├── workflow-dispatcher.ts   # 工作流调度桥接
│   │   └── workflow-tracker.ts      # 工作流状态跟踪
│   ├── routes/
│   │   ├── agents.ts                # GET /api/agents
│   │   ├── chat.ts                  # POST /api/chat
│   │   ├── config.ts                # GET /api/config/ai
│   │   ├── feishu.ts                # /api/feishu/* 路由
│   │   ├── reports.ts               # /api/reports/* 路由
│   │   ├── tasks.ts                 # /api/tasks/* 路由（Mission CRUD + 决策）
│   │   └── workflows.ts             # /api/workflows/* 路由
│   ├── runtime/
│   │   └── server-runtime.ts        # 服务端 WorkflowRuntime 组装
│   └── tests/
│       ├── mission-store.test.ts           # Mission 状态机测试
│       ├── mission-routes.test.ts          # Mission REST API 测试
│       ├── mission-orchestrator.test.ts    # 编排器测试
│       ├── mission-storage.test.ts         # 快照持久化测试
│       ├── feishu-bridge.test.ts           # 飞书 Bridge 测试
│       ├── feishu-routes.test.ts           # 飞书路由测试
│       ├── dynamic-organization.test.ts    # 动态组织测试
│       ├── phase1-access-guard.test.ts     # 工作空间隔离测试
│       ├── phase1-message-bus.test.ts      # 消息总线测试
│       ├── phase1-registry.test.ts         # 注册表测试
│       └── phase1-workspace.test.ts        # 工作空间测试
│
├── shared/                          # 前后端共享类型与契约
│   ├── const.ts                     # 全局常量
│   ├── message-bus-rules.ts         # 消息总线层级校验规则
│   ├── organization-schema.ts       # 动态组织 schema（Node/Department/Snapshot）
│   ├── runtime-agent.ts             # 运行时智能体类型
│   ├── workflow-input.ts            # 工作流输入（directiveContext/inputSignature）
│   ├── workflow-kernel.ts           # 工作流内核（浏览器端精简版引擎）
│   ├── workflow-runtime.ts          # WorkflowRuntime 抽象接口（7 个子接口）
│   ├── mission/
│   │   ├── contracts.ts             # Mission 契约（MissionRecord/Stage/Event/Decision/Artifact）
│   │   ├── api.ts                   # Mission REST API 路由常量和请求/响应类型
│   │   ├── socket.ts                # Mission Socket 事件常量
│   │   ├── topic.ts                 # topicId 生成规则
│   │   └── index.ts                 # 模块导出
│   └── executor/
│       ├── contracts.ts             # Executor 契约（ExecutionPlan/Job/Step/Artifact）
│       ├── api.ts                   # Executor REST API 路由和回调 Header 常量
│       └── index.ts                 # 模块导出
│
├── services/
│   └── lobster-executor/            # Docker 参考执行器（当前 mock-first）
│       ├── src/
│       │   ├── index.ts             # 服务入口
│       │   ├── app.ts               # Express 应用（/health, /api/executor/jobs）
│       │   ├── service.ts           # LobsterExecutorService（job 队列/mock runner）
│       │   ├── config.ts            # 配置
│       │   ├── errors.ts            # 错误类型
│       │   ├── request-schema.ts    # 请求校验
│       │   ├── types.ts             # 类型定义
│       │   └── app.test.ts          # 单元测试
│       ├── tsconfig.json
│       └── vitest.config.ts
│
├── data/                            # 运行时数据（gitignored）
│   ├── database.json                # 本地 JSON 数据库
│   ├── ai-config.json               # AI 配置快照
│   ├── progress.md                  # 进度记录
│   └── agents/                      # 智能体工作空间
│       └── <agentId>/
│           ├── SOUL.md              # 长期记忆：人设定义
│           ├── HEARTBEAT.md         # 心跳配置
│           ├── sessions/            # 短期记忆：会话记录 (JSONL)
│           ├── memory/              # 中期记忆
│           │   └── vectors.json     # 向量索引（96 维）
│           └── reports/             # 报告产物
│               ├── dept_*.json/md   # 部门报告
│               ├── final_*.json/md  # 最终综合报告
│               └── heartbeat_*.json/md # 心跳报告
│
├── scripts/                         # 开发与验证脚本
│   ├── dev-all.mjs                  # 同时启动前端 + 服务端
│   ├── dev-stop.mjs                 # 停止本地开发进程
│   ├── build-pages.mjs              # GitHub Pages 构建
│   ├── mission-integration-smoke.mjs # Mission 集成 smoke 测试
│   ├── mission-restart-smoke.mjs    # Mission 重启恢复 smoke 测试
│   ├── lobster-executor-smoke.mjs   # 执行器 smoke 测试
│   └── mission-smoke-shared.mjs     # Smoke 共享工具
│
├── docs/                            # 文档
│   ├── mission-contract-freeze.md   # Mission/Executor/Socket 契约冻结说明
│   ├── mission-worktree-bootstrap.md # 多 worktree 启动指南
│   ├── mission-worktree-dual-repo.md # 双仓参考与并行改造边界
│   └── executor/
│       └── lobster-executor.md      # Lobster Executor 说明
│
├── .github/workflows/
│   └── deploy-pages.yml             # GitHub Pages 自动部署
│
├── .kiro/                           # Kiro 规范文档
│   ├── steering/
│   │   └── project-overview.md      # 本文件（项目总览，auto inclusion）
│   └── specs/                       # 模块 Spec 归档
│       ├── workflow-engine/         # 十阶段工作流引擎
│       ├── dynamic-organization/    # 动态组织生成
│       ├── memory-system/           # 三级记忆系统
│       ├── evolution-heartbeat/     # 自进化与心跳
│       ├── mission-runtime/         # Mission 任务域
│       ├── feishu-bridge/           # 飞书集成
│       ├── browser-runtime/         # 纯前端运行时
│       ├── frontend-3d/             # 3D 场景与前端
│       ├── demo-data-engine/        # 预录演示数据引擎
│       ├── demo-guided-experience/  # 演示引导体验
│       ├── mission-native-projection/ # Mission 原生投影
│       ├── scene-mission-fusion/    # 3D 场景 Mission 融合
│       ├── sandbox-live-preview/    # 沙箱实时预览
│       ├── workflow-decoupling/     # Workflow 寄生依赖解耦
│       ├── lobster-executor-real/   # Docker 真实容器执行器
│       ├── agent-marketplace/      # Guest Agent 访客代理市场
<<<<<<< HEAD
│       └── autonomous-swarm/      # 跨 Pod 自主协作 (Swarm)
=======
│       └── multi-user-office/     # 多人实时协作办公室
>>>>>>> feat/multi-user-office
│
├── .env                             # 环境变量（唯一配置真源，不进 Git）
├── .env.example                     # 环境变量模板
├── package.json                     # 依赖与脚本
├── tsconfig.json                    # TypeScript 配置
├── vite.config.ts                   # Vite 配置（含 GitHub Pages base path）
├── README.md                        # 项目说明
├── ROADMAP.md                       # 开发路线图
└── CHANGELOG.md                     # 变更记录
```

## 模块清单与 Spec 索引

| 模块 | Spec 目录 | 核心文件 | 状态 |
|------|-----------|---------|------|
| 工作流引擎 | `.kiro/specs/workflow-engine/` | `server/core/workflow-engine.ts` | ✅ 已完成 |
| 动态组织生成 | `.kiro/specs/dynamic-organization/` | `server/core/dynamic-organization.ts` | ✅ 已完成 |
| 记忆系统 | `.kiro/specs/memory-system/` | `server/memory/vector-store.ts` `server/memory/soul-store.ts` `server/memory/session-store.ts` | ✅ 已完成 |
| 自进化与心跳 | `.kiro/specs/evolution-heartbeat/` | `server/core/evolution.ts` `server/core/heartbeat.ts` `server/core/capability-registry.ts` | ✅ 已完成 |
| Mission 任务域 | `.kiro/specs/mission-runtime/` | `server/core/mission-orchestrator.ts` `server/core/execution-plan-builder.ts` `server/core/executor-client.ts` `server/tasks/mission-store.ts` | ✅ 核心完成，Docker 执行层开发中 |
| 飞书集成 | `.kiro/specs/feishu-bridge/` | `server/feishu/bridge.ts` | ✅ 已完成 |
| 纯前端运行时 | `.kiro/specs/browser-runtime/` | `client/src/runtime/browser-runtime.ts` `client/src/lib/browser-runtime-storage.ts` | ✅ 已完成 |
| 3D 场景与前端 | `.kiro/specs/frontend-3d/` | `client/src/components/Scene3D.tsx` `client/src/lib/tasks-store.ts` `client/src/components/WorkflowPanel.tsx` | ✅ 已完成 |
| 预录演示数据引擎 | `.kiro/specs/demo-data-engine/` | `client/src/runtime/demo-data/schema.ts` `client/src/runtime/demo-data/bundle.ts` `client/src/runtime/demo-data/serializer.ts` | 🔲 待开发 |
| 演示引导体验 | `.kiro/specs/demo-guided-experience/` | `client/src/runtime/demo-playback/engine.ts` `client/src/lib/demo-store.ts` `client/src/hooks/useDemoMode.ts` `client/src/components/demo/MemoryTimeline.tsx` | 🔲 待开发 |
| Mission 原生投影 | `.kiro/specs/mission-native-projection/` | `server/routes/planets.ts` `client/src/lib/mission-client.ts` `client/src/lib/tasks-store.ts` | 🔲 待开发 |
| 3D 场景 Mission 融合 | `.kiro/specs/scene-mission-fusion/` | `client/src/components/three/MissionIsland.tsx` `client/src/components/tasks/MissionMiniView.tsx` `client/src/components/tasks/MissionDetailOverlay.tsx` | 🔲 待开发 |
| 沙箱实时预览 | `.kiro/specs/sandbox-live-preview/` | `shared/executor/contracts.ts` `server/core/sandbox-relay.ts` `client/src/components/three/SandboxMonitor.tsx` `client/src/components/sandbox/TerminalPreview.tsx` | 🔲 待开发 |
| Workflow 寄生依赖解耦 | `.kiro/specs/workflow-decoupling/` | `client/src/lib/tasks-store.ts` `server/core/mission-orchestrator.ts` `shared/mission/contracts.ts` | 🔲 待开发 |
| Docker 真实容器执行器 | `.kiro/specs/lobster-executor-real/` | `services/lobster-executor/src/service.ts` `services/lobster-executor/src/docker-runner.ts` `services/lobster-executor/src/callback-sender.ts` | 🔲 待开发 |
| Guest Agent 访客代理 | `.kiro/specs/agent-marketplace/` | `shared/organization-schema.ts` `server/core/registry.ts` `server/routes/guest-agents.ts` `server/core/guest-agent.ts` | 🔲 待开发 |
| 多模态视觉能力 | `.kiro/specs/multi-modal-vision/` | `server/core/vision-provider.ts` `server/routes/vision.ts` `client/src/lib/workflow-attachments.ts` `shared/workflow-input.ts` `shared/workflow-runtime.ts` | 🔲 待开发 |
| 跨 Pod 自主协作 (Swarm) | `.kiro/specs/autonomous-swarm/` | `server/core/swarm-orchestrator.ts` `shared/swarm.ts` `shared/message-bus-rules.ts` `server/core/heartbeat.ts` `client/src/components/three/CrossPodParticles.tsx` | 🔲 待开发 |
| 跨框架导出 | `.kiro/specs/cross-framework-export/` | `shared/export-schema.ts` `server/core/exporter.ts` `server/core/export-adapters/crewai.ts` `server/core/export-adapters/langgraph.ts` `server/core/export-adapters/autogen.ts` `server/routes/export.ts` `client/src/components/ExportDialog.tsx` | 🔲 待开发 |
| 实时遥测仪表盘 | `.kiro/specs/telemetry-dashboard/` | `shared/telemetry.ts` `server/core/telemetry-store.ts` `server/routes/telemetry.ts` `client/src/components/TelemetryDashboard.tsx` `client/src/lib/telemetry-store.ts` | 🔲 待开发 |
| 多人协作办公室 | `.kiro/specs/multi-user-office/` | `server/core/room-manager.ts` `shared/room.ts` `client/src/lib/multi-user-store.ts` `server/routes/rooms.ts` | 🔲 待开发 |
| Human-in-the-Loop 决策系统 | `.kiro/specs/human-in-the-loop/` | `shared/mission/contracts.ts` `shared/mission/decision-templates.ts` `server/tasks/mission-decision.ts` `server/core/mission-orchestrator.ts` `client/src/components/tasks/DecisionPanel.tsx` `client/src/components/tasks/DecisionHistory.tsx` | 🔲 待开发 |

## 核心数据流

### 预演主线（Frontend Mode）
```
用户 → 浏览器运行时 (browser-runtime.ts)
     → BrowserWorkflowRepository (内存)
     → BrowserAgentDirectory → browser-llm.ts (fetch 直连 LLM)
     → BrowserEventEmitter (回调) → Zustand → React UI
     → IndexedDB 持久化
```

### 执行主线（Advanced Mode）
```
用户 → POST /api/workflows → WorkflowEngine.startWorkflow()
     → 动态组织生成 (LLM) → WorkflowOrganizationSnapshot
     → 十阶段管道 (direction→planning→execution→review→meta_audit→revision→verify→summary→feedback→evolution)
     → Socket.IO 事件 → Zustand → React UI
     → database.json + Agent 工作空间持久化
```

### Mission 执行链路
```
用户/飞书 → POST /api/tasks → MissionStore.create()
          → MissionOrchestrator.startMission()
          → ExecutionPlanBuilder.build() → 结构化 ExecutionPlan
          → ExecutorClient.dispatchPlan() → POST /api/executor/jobs (远端 Docker 执行器)
          → /api/executor/events (HMAC 签名回调) → MissionStore 状态更新
          → Socket mission_event → 前端任务驾驶舱实时展示
          → FeishuProgressBridge → 飞书 ACK/进度/完成/失败回传
```

### 记忆与进化链路
```
工作流执行中：
  Agent.invoke() → SessionStore.appendLLMExchange() (短期记忆)
  MessageBus.send() → SessionStore.appendMessageLog() (双方记录)

工作流完成后：
  materializeWorkflowMemories() → VectorStore.upsertMemorySummary() (中期记忆)
  EvolutionService.evolveWorkflow() → SoulStore.appendLearnedBehaviors() (长期记忆)
  CapabilityRegistry.registerWorkflow() → agent_capabilities 表

定时心跳：
  HeartbeatScheduler.trigger() → search() → LLM 总结 → 报告落盘
```

## REST API 总览

### 工作流
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/workflows | 启动新工作流 |
| GET | /api/workflows | 工作流列表 |
| GET | /api/workflows/:id | 工作流详情 |

### Mission
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/tasks | 创建 Mission |
| GET | /api/tasks | Mission 列表 |
| GET | /api/tasks/:id | Mission 详情 |
| GET | /api/tasks/:id/events | Mission 事件流 |
| POST | /api/tasks/:id/decision | 提交决策（幂等） |
| POST | /api/executor/events | 执行器回调（HMAC 签名） |

### 飞书
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/feishu/relay | OpenClaw Relay 入口 |
| POST | /api/feishu/relay/event | 手动推送 Relay 事件 |
| POST | /api/feishu/webhook | 飞书 Webhook 回调 |

### 其他
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/chat | 服务端聊天代理 |
| GET | /api/agents | 智能体列表 |
| GET | /api/config/ai | AI 配置（只读） |
| GET | /api/reports/* | 报告查询 |
| GET | /api/health | 健康检查 |

## 开发规范

- TypeScript 严格模式，`npm run check` 必须通过
- 智能体工作空间隔离：通过 `server/core/access-guard.ts` 强制路径校验，拒绝绝对路径和 `..` 遍历
- 消息总线层级约束：CEO ↔ Manager ↔ Worker，不允许越级，规则定义在 `shared/message-bus-rules.ts`
- `.env` 为唯一配置真源，前端配置面板只读，`GET /api/config/ai` 返回 `writable: false`
- 运行时数据（sessions/memory/reports/SOUL.md/HEARTBEAT.md）不进 Git，已在 `.gitignore` 中排除
- 工作流引擎通过 `WorkflowRuntime` 抽象接口与环境解耦，同一套逻辑可跑在服务端和浏览器
- LLM 调用失败时通过 `isTemporaryLLMError()` 检测临时性错误并重试，非临时错误记录 `WorkflowIssue`
- 评审评分 LLM 返回格式异常时使用默认评分（每项 3 分，总分 12），不中断工作流

## 环境变量分组

| 配置组 | 关键变量 | 说明 |
|--------|---------|------|
| 基础运行 | `PORT`、`NODE_ENV` | 默认 3001、development |
| 主 LLM | `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`LLM_WIRE_API` | 当前主模型 GLM-5-turbo |
| Fallback LLM | `FALLBACK_LLM_*` | 主模型不可用时的兜底 |
| 工作流上下文 | `WORKFLOW_CONTEXT_*` | 上下文压缩策略 |
| Mission Smoke | `MISSION_SMOKE_ENABLED` | 默认关闭，开启后暴露 smoke 路由 |
| Executor 回调 | `EXECUTOR_CALLBACK_SECRET`、`EXECUTOR_CALLBACK_MAX_SKEW_SECONDS` | HMAC 签名校验，留空跳过 |
| Lobster 执行器 | `LOBSTER_EXECUTOR_BASE_URL`、`LOBSTER_EXECUTOR_PORT` | 默认 localhost:3031 |
| 飞书 | `FEISHU_ENABLED`、`FEISHU_MODE`、`FEISHU_RELAY_SECRET` | 默认 mock 模式 |
| Vision LLM | `VISION_LLM_API_KEY`、`VISION_LLM_BASE_URL`、`VISION_LLM_MODEL`、`VISION_LLM_WIRE_API`、`VISION_LLM_MAX_TOKENS`、`VISION_LLM_DETAIL`、`VISION_LLM_TIMEOUT_MS` | 视觉分析专用模型，未配置时回退到 Fallback/主 LLM |

## 常用命令

```bash
npm run dev:frontend   # 只启动前端（纯体验，不需要 .env）
npm run dev:all        # 启动前端 + 服务端（完整模式）
npm run dev:server     # 只启动服务端
npm run dev:stop       # 停止本地开发进程
npm run build          # 构建生产版本
npm run build:pages    # 构建 GitHub Pages 静态产物
npm run check          # TypeScript 类型检查
```

## 当前主要缺口

1. **Docker 执行器真实容器生命周期** — `service
s/lobster-executor` 的 `runAcceptedJob()` 当前完全是 mock 实现（模拟步骤延迟 + 写 mock result.json），没有任何 Docker API 调用。需要接入 dockerode 或 child_process 实现真实容器创建/启动/超时/退出码判断/日志采集/工件目录挂载，以及执行器主动回调到 Cube 的 `/api/executor/events`（含 HMAC 签名）。
2. **`/api/planets` 路由未实现** — `shared/mission/api.ts` 中定义了 `listPlanets`、`getPlanet`、`getPlanetInterior` 等路由常量，但服务端 `server/routes/` 中没有对应的路由实现。前端 `/tasks` 页面的 planet 视图无法从 mission 原生数据源获取数据。
3. **Work Packages / Agent Crew 未完全迁移到 mission** — 这些区域仍挂在 workflow 补充层上，尚未完全切换到 mission 原生投影。当前属于"双轨并存、mission 主线优先"的阶段。
4. **纯前端模式风险项未处理** — 浏览器直连 LLM 的 API Key 安全提示、浏览器崩溃/刷新后长任务恢复、CORS 兜底代理这三项在代码中未见完整实现。

## 下一步开发建议

按路线 A（开源影响力）优先级排序，考虑依赖关系和并行度：

### 第一梯队（可立即并行启动）

1. **workflow-decoupling 盘点阶段** — 先摸清 tasks-store 对 workflow 的全部寄生依赖点，输出 inventory.md。这是后续所有 mission 原生化工作的前提。
2. **demo-data-engine** — 构建预录演示数据包，纯前端静态数据模块，无外部依赖。
3. **scene-mission-fusion** — 在 3D 场景中嵌入 Mission 状态（MissionIsland），纯前端工作。新代码从一开始就只读 mission 原生数据，不引入 workflow 依赖。

### 第二梯队（依赖第一梯队部分产出）

4. **workflow-decoupling 数据补齐 + mission-native-projection 后端** — 两个 spec 的 MissionRecord 丰富化是同一件事，合并推进。在 MissionOrchestrator 中补齐 organization、workPackages、messageLog、agentCrew 字段，实现 /api/planets 路由。
5. **demo-guided-experience** — 依赖 demo-data-engine 的 DEMO_BUNDLE。构建回放引擎 + Live Demo 入口 + 记忆/进化可视化。

### 第三梯队（依赖第二梯队完成）

6. **workflow-decoupling 前端切换 + 清除** — 数据补齐完成后，用 feature flag 切换 tasks-store 数据源，验证后删除 workflow 补充层代码。预计 tasks-store 从 2800+ 行降到 ~1800 行。
7. **mission-native-projection 前端迁移** — 切换 mission-client 到 /api/planets 端点，与 workflow-decoupling 的前端切换可合并。

### 独立线（与上述并行）

8. **sandbox-live-preview** — 协议层和工具函数可先做（不依赖真实 Docker），3D 集成等执行器就绪后接入。与 Docker 执行器真实实现绑定推进。
