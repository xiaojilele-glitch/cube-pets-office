<!--
 * @Author: wangchunji
 * @Date: 2026-03-31 14:56:15
 * @Description: 
 * @LastEditTime: 2026-04-09 12:10:00
 * @LastEditors: wangchunji
-->
---
inclusion: auto
---

# Cube Pets Office 项目总览

## 项目定位

多智能体可视化平台。用户输入自然语言指令，系统动态组建 AI 团队，通过十阶段管道协作执行，3D 办公场景实时展示过程。支持纯浏览器预演和服务端完整执行两种模式。Docker 容器真实执行、跨框架 Agent 互操作、不可篡改审计链、数据血缘追踪均已实现。

## 技术栈

- 前端：React 19 + Vite + TypeScript + Zustand + Three.js (R3F) + Framer Motion
- 后端：Express + Socket.IO + TypeScript
- AI：OpenAI 兼容接口（任意提供商）
- 存储：浏览器 IndexedDB / 服务端本地 JSON
- 执行：Docker (dockerode) + seccomp/AppArmor 安全沙箱
- 测试：Vitest + fast-check (PBT)
- UI 风格：Holographic Command Deck（毛玻璃拟态 + 有机科幻）

## 项目规模

- 850+ 文件 / ~180,000 行 TypeScript
- `.kiro/specs` 当前共 52 个 spec 目录：38 个已完成、4 个部分完成、9 个未开始、1 个待补 `tasks.md`（`frontend-demo-mode`）
- 当前活跃增量 spec：`workflow-artifacts-display`（工作流产物展示与下载）
- 12 个 shared/ 契约模块，主线能力已覆盖前端、服务端、执行器、审计与互操作层
- 大量单元测试与属性测试已覆盖 Mission、执行器、RAG、审计、NL Command 等核心域

> 说明：本页以仓库当前 `tasks.md` 勾选状态和工作区代码为准；旧的阶段性计划文档保留用于历史追溯。

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         入口层                                   │
│  用户浏览器 · 飞书 Relay                                         │
├─────────────────────────────────────────────────────────────────┤
│              前端层 — Holographic Command Deck UI                 │
│  3D 场景 · HoloDock · NL 指挥中心 · 成本治理面板                  │
│  回放时间线 · 血缘 DAG · 审计面板 · 遥测仪表盘                    │
│  浏览器运行时 (IndexedDB + Web Worker)                           │
│  i18n (中/英) · 移动端适配 · glass-panel + spring 动效            │
├─────────────────────────────────────────────────────────────────┤
│                    Cube Brain (服务端)                            │
│  动态组织生成 · 十阶段工作流引擎 · Mission Runtime                │
│  Skill 热插拔 · 动态角色切换 · 成本治理 · 20 分评审               │
│  Guest Agent 生命周期 · RBAC 权限矩阵                            │
├─────────────────────────────────────────────────────────────────┤
│                    智能层                                        │
│  三级记忆 · 知识图谱 · 向量 DB + RAG 管道                        │
│  自进化引擎 · 信誉评分 · 自评估 + 竞争执行                       │
│  LLM 多提供商抽象                                                │
├─────────────────────────────────────────────────────────────────┤
│                 信任与合规层                                      │
│  哈希链式审计日志 · 数据血缘 DAG · 异常检测 · 合规映射            │
├─────────────────────────────────────────────────────────────────┤
│                    执行层                                        │
│  Lobster Executor (Docker 真实容器)                               │
│  HMAC 签名回调 · 安全沙箱 · 实时终端 + 截图 · AI 凭证注入        │
├─────────────────────────────────────────────────────────────────┤
│                   互操作层                                       │
│  A2A 协议 (CrewAI/LangGraph/AutoGen 适配器)                      │
│  跨 Pod 自主协作 (Swarm) · Guest Agent 市场                      │
├─────────────────────────────────────────────────────────────────┤
│                   持久化层                                       │
│  database.json · Mission 快照 · Agent 工作空间                    │
│  IndexedDB (浏览器端) · 审计日志 · 血缘图存储                     │
└─────────────────────────────────────────────────────────────────┘
```

## 模块完成状态

### ✅ 已落地主线能力（能力视角）

| 模块 | 说明 |
|------|------|
| 十阶段工作流引擎 | 组建→拆解→规划→执行→评审→审计→修订→验证→汇总→进化 |
| 动态组织生成 | LLM 驱动 CEO/经理/Worker 结构生成 |
| 三级记忆系统 | 短期(会话) / 中期(向量检索) / 长期(SOUL.md) |
| 自进化 + 心跳 | 弱维度分析→人设修补→能力注册 |
| Mission Runtime | 六阶段状态机 + 编排器 |
| 飞书集成 | ACK/进度/决策回传 |
| 纯前端运行时 | IndexedDB + Web Worker，同一套引擎 |
| 3D 场景 | Three.js R3F，Agent 状态实时映射 |
| 预录演示数据引擎 | 预录数据包 + 序列化/反序列化 |
| 演示引导体验 | 回放引擎 + 步骤引导 UI |
| 3D Mission 融合 | Mission 状态映射到 3D 场景动画 |
| 跨框架导出 | CrewAI / LangGraph / AutoGen 一键导出 |
| 实时遥测仪表盘 | 事件总线 + Recharts 可视化 |
| 成本可观测性 | Token 追踪 + 模型定价 + Agent 成本分布 |
| 长任务恢复 | IndexedDB 持久化，断点续跑 |
| 执行回放 | Mission 执行过程录制与时间线回放 |
| 多模态视觉 | 图片理解 + 前端附件扩展 |
| Workflow 解耦 | tasks-store mission-native 单源架构 |
| Mission 原生投影 | /api/planets 路由 + 前端数据源切换 |
| Skill 热插拔 | 运行时注册/卸载技能 |
| 动态角色切换 | Agent 运行时角色适应 |
| 人工审批流 | 通用审批 + 决策链 |
| 知识图谱 | 实体/关系/推理 + 可视化 |
| 向量 DB + RAG | 7 步 Pipeline |
| 自然语言指挥中心 | NL→结构化命令，智能路由 |
| 自评估 + 竞争执行 | Agent 自我评估，竞争择优 |
| 信誉评分 | 历史表现积累与衰减 |
| 多模态编排 | 语音 + Vision 统一编排 |
| 主动成本治理 | 多级预算/四级告警/灰度降级 |
| Docker 真实容器 | dockerode 生命周期 + HMAC 回调 |
| AI 容器注入 | API Key 安全注入 + 凭证脱敏 |
| 安全沙箱 | seccomp/AppArmor + 能力裁剪 |
| 实时终端 + 截图 | WebSocket 终端流 + 容器截图 |
| 执行器集成 | WorkflowEngine ↔ Docker 桥接 |
| Agent 权限矩阵 | RBAC 细粒度权限控制 |
| 跨 Pod 自主协作 | Swarm 发现/委派/共识 |
| 不可篡改审计链 | 哈希链式日志 + 异常检测 |
| 数据血缘追踪 | DAG 采集/查询/导出 + 审计集成 |
| A2A 互操作协议 | 跨框架 Agent 通信 + 适配器 |
| Guest Agent 市场 | 外部 Agent 沙箱接入 + TTL |
| 全息 UI 升级 | 毛玻璃拟态 + HoloDock + GlowButton + 呼吸光晕 |

### 📍 当前进度快照（Spec 视角，2026-04-09）

| 状态 | 数量 | 说明 |
|------|------|------|
| 已完成 | 38 | 主线 L01-L30 与补充 spec `holographic-ui` 等已合并 |
| 部分完成 | 4 | `mission-runtime`、`state-persistence-recovery`、`nl-command-center`、`workflow-artifacts-display` |
| 未开始 | 9 | 以第四层 L31-L38 为主，另含 `i18n-cleanup` |
| 待补任务清单 | 1 | `frontend-demo-mode` 目录已存在，但尚未形成 `tasks.md` |

- `workflow-artifacts-display` 是当前活跃项：服务端 Artifact API、`tasks-store` 扩展和基础产物列表组件已落地，预览弹窗、页面集成和测试仍待补齐。
- `mission-runtime` 与 `nl-command-center` 的剩余勾选项主要是历史尾项或补测任务，不代表主线能力缺失。
- `state-persistence-recovery` 的未完成项主要集中在标记 `*` 的可选属性测试。

### 📋 待启动 / 待环境就绪

| 模块 | 依赖 / 备注 |
|------|------|
| i18n-cleanup | 前端文案 / 国际化收口，独立排期 |
| frontend-demo-mode | 需先补 `tasks.md`，再确认依赖与范围 |
| L31 Docker Compose 生产部署 | L22 |
| L32 多人实时协作 | 无 |
| L33 多租户隔离 | L25 + L31 |
| L34 Agent 交易市场平台 | L30 + L19 |
| L35 K8s Agent Operator | L31 |
| L36 边缘部署 | L31 |
| L37 多区域灾备 | L31 + L35 |
| L38 VR 沉浸式扩展 | L03 |

## 工程健康快照

- 当前工作区存在一组围绕 `workflow-artifacts-display` 的暂存改动。
- `npm run check` 当前仍有 30 个 TypeScript 错误，主要分布在 lineage 可视化、NL Command、workflow-engine 桥接与 `server/index.ts` 等历史模块。
- 后续增量工作建议以“不扩大现有 TypeScript 基线错误数”为最低要求，并单独安排一轮编译清债。

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
          → ExecutorClient.dispatchPlan() → POST /api/executor/jobs (Docker 执行器)
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

### 审计与血缘链路
```
每个工作流动作：
  AuditCollector.capture() → AuditChain.append() (哈希链式日志)
  → AnomalyDetector.analyze() → 异常告警
  → Socket audit_event → 前端审计面板实时展示

数据变更：
  LineageCollector.track() → LineageStore.addNode/addEdge() (DAG 图)
  → ChangeDetectionService.diff() → 变更记录
  → LineageAuditService → 审计链集成
  → Socket lineage_event → 前端血缘 DAG 可视化
```

### 跨框架互操作链路
```
外部 Agent 接入：
  POST /api/agents/guest → GuestInvitationParser.parse() → GuestLifecycle.spawn()
  → 沙箱运行时 (TTL 限制) → 参与工作流执行 → GuestLifecycle.teardown()

A2A 协议通信：
  A2AServer.handleTask() → 路由到内部 Agent
  A2AClient.delegateTask() → 发送到外部框架 (CrewAI/LangGraph/AutoGen)
  → 适配器转换协议格式 → 结果回传到工作流引擎

Swarm 协作：
  SwarmOrchestrator.discover() → Pod 发现
  → SwarmOrchestrator.delegate() → 跨 Pod 任务委派
  → 共识协议 → 结果聚合
```

## 项目目录结构

```
cube-pets-office/
├── client/                          # 🖥️ 前端应用
│   ├── src/
│   │   ├── components/
│   │   │   ├── Scene3D.tsx          # Three.js 3D 办公室场景
│   │   │   ├── HoloDock.tsx         # 全息胶囊 Dock 导航栏
│   │   │   ├── HoloDrawer.tsx       # 全息侧边抽屉容器
│   │   │   ├── WorkflowPanel.tsx    # 工作流进度面板
│   │   │   ├── ChatPanel.tsx        # 聊天面板
│   │   │   ├── ConfigPanel.tsx      # 配置面板
│   │   │   ├── CostDashboard.tsx    # 成本可观测看板
│   │   │   ├── TelemetryDashboard.tsx # 实时遥测仪表盘
│   │   │   ├── AuditPanel.tsx       # 审计日志面板
│   │   │   ├── AuditTimeline.tsx    # 审计时间线
│   │   │   ├── AuditChainVerifier.tsx # 审计链完整性验证
│   │   │   ├── AnomalyAlertPanel.tsx # 异常检测告警
│   │   │   ├── LoadingScreen.tsx    # 全息加载页
│   │   │   ├── ExportDialog.tsx     # 跨框架导出对话框
│   │   │   ├── three/               # Three.js 子组件
│   │   │   │   ├── PetWorkers.tsx   # Agent 宠物 + glass-3d 姓名牌
│   │   │   │   ├── MissionIsland.tsx # Mission 状态岛
│   │   │   │   ├── SandboxMonitor.tsx # 沙箱监控
│   │   │   │   ├── CrossPodParticles.tsx # Swarm 跨 Pod 粒子
│   │   │   │   └── CrossFrameworkParticles.tsx # A2A 跨框架粒子
│   │   │   ├── lineage/             # 数据血缘可视化
│   │   │   │   ├── LineageDAGView.tsx
│   │   │   │   ├── LineageHeatmap.tsx
│   │   │   │   └── LineageTimeline.tsx
│   │   │   ├── knowledge/           # 知识图谱可视化
│   │   │   ├── rag/                 # RAG 管道界面
│   │   │   ├── replay/              # 执行回放组件
│   │   │   ├── reputation/          # 信誉评分展示
│   │   │   ├── nl-command/          # 自然语言指挥中心
│   │   │   ├── permissions/         # 权限管理界面
│   │   │   ├── sandbox/             # 沙箱终端预览
│   │   │   ├── tasks/               # 任务驾驶舱
│   │   │   ├── demo/                # 演示引导组件
│   │   │   └── ui/                  # shadcn/ui + GlowButton
│   │   ├── lib/                     # Zustand stores + 工具
│   │   │   ├── store.ts             # 全局 store
│   │   │   ├── workflow-store.ts    # 工作流 store
│   │   │   ├── tasks-store.ts       # Mission store (mission-native)
│   │   │   ├── audit-store.ts       # 审计 store
│   │   │   ├── lineage-store.ts     # 血缘 store
│   │   │   ├── swarm-store.ts       # Swarm store
│   │   │   ├── a2a-store.ts         # A2A store
│   │   │   ├── browser-llm.ts       # 浏览器端 LLM 直连
│   │   │   └── browser-runtime-storage.ts # IndexedDB 持久化
│   │   ├── pages/
│   │   │   ├── Home.tsx             # 首页 (3D + HoloDock + HoloDrawer)
│   │   │   ├── tasks/               # 任务驾驶舱页面
│   │   │   └── lineage/             # 血缘追踪页面
│   │   ├── runtime/
│   │   │   └── browser-runtime.ts   # 浏览器端 WorkflowRuntime
│   │   ├── hooks/                   # React Hooks
│   │   ├── i18n/                    # 中英文国际化
│   │   └── contexts/                # React Context
│   └── public/                      # 静态资源 + 3D 模型
│
├── server/                          # 🧠 服务端
│   ├── core/
│   │   ├── workflow-engine.ts       # 十阶段工作流引擎
│   │   ├── dynamic-organization.ts  # 动态组织生成器
│   │   ├── mission-orchestrator.ts  # Mission 编排器
│   │   ├── swarm-orchestrator.ts    # 跨 Pod 自主协作
│   │   ├── a2a-server.ts           # A2A 协议服务端
│   │   ├── a2a-client.ts           # A2A 协议客户端
│   │   ├── a2a-adapters/           # CrewAI/LangGraph/AutoGen 适配器
│   │   ├── guest-agent.ts          # Guest Agent 管理
│   │   ├── guest-lifecycle.ts      # Guest Agent 沙箱运行时
│   │   ├── agent.ts                # Agent 基类
│   │   ├── registry.ts             # 智能体注册表
│   │   ├── message-bus.ts          # 层级消息总线
│   │   ├── evolution.ts            # 自进化引擎
│   │   ├── heartbeat.ts            # 心跳调度器
│   │   ├── skills/                 # Skill 热插拔
│   │   ├── roles/                  # 动态角色系统
│   │   ├── reputation/             # 信誉评分
│   │   ├── autonomy/               # 自评估 + 竞争执行
│   │   ├── governance/             # 成本治理子系统
│   │   ├── knowledge-graph/        # 知识图谱引擎
│   │   ├── rag/                    # RAG Pipeline
│   │   └── memory/                 # 三级记忆系统
│   ├── audit/                       # 🛡️ 审计子系统
│   │   ├── audit-chain.ts          # 哈希链式审计日志
│   │   ├── audit-collector.ts      # 事件采集器
│   │   ├── anomaly-detector.ts     # 异常检测
│   │   ├── audit-verifier.ts       # 链完整性验证
│   │   ├── audit-query.ts          # 审计查询
│   │   ├── audit-export.ts         # 审计导出
│   │   ├── compliance-mapper.ts    # 合规映射
│   │   └── timestamp-provider.ts   # 时间戳服务
│   ├── lineage/                     # 📊 数据血缘
│   │   ├── lineage-collector.ts    # 数据流采集
│   │   ├── lineage-store.ts        # 图存储
│   │   ├── lineage-query.ts        # 血缘查询
│   │   ├── lineage-export.ts       # DOT/JSON/CSV 导出
│   │   ├── lineage-audit.ts        # 审计集成
│   │   └── change-detection.ts     # 变更检测
│   ├── routes/                      # REST API 路由
│   │   ├── audit.ts                # /api/audit/*
│   │   ├── lineage.ts              # /api/lineage/*
│   │   ├── a2a.ts                  # /api/a2a/*
│   │   ├── guest-agents.ts         # /api/agents/guest/*
│   │   └── ...                     # workflows/tasks/chat/config 等
│   ├── feishu/                      # 飞书集成
│   ├── tasks/                       # Mission 状态机
│   └── tests/                       # 测试套件 (Vitest + fast-check)
│
├── shared/                          # 📦 前后端共享契约
│   ├── audit/contracts.ts           # 审计契约
│   ├── lineage/contracts.ts         # 血缘契约
│   ├── a2a-protocol.ts             # A2A 协议契约
│   ├── swarm.ts                    # Swarm 契约
│   ├── guest-agent-utils.ts        # Guest Agent 工具
│   ├── mission/contracts.ts         # Mission 契约
│   ├── llm/contracts.ts            # LLM 多提供商抽象
│   ├── rag/contracts.ts            # RAG Pipeline 契约
│   ├── skill/contracts.ts          # Skill 注册契约
│   ├── export/contracts.ts         # 跨框架导出契约
│   ├── cost.ts                     # 成本类型 + 定价表
│   └── cost-governance.ts          # 成本治理类型
│
├── services/
│   └── lobster-executor/            # 🐳 Docker 参考执行器
│       ├── src/
│       │   ├── docker-runner.ts     # 真实 Docker 容器生命周期
│       │   ├── mock-runner.ts       # Mock 模式
│       │   ├── security-policy.ts   # 安全沙箱策略
│       │   └── credential-*.ts      # AI 凭证注入/脱敏
│       └── ai-bridge/               # 容器内 AI 通信桥接
│
├── data/                            # 运行时数据（gitignored）
├── scripts/                         # 开发脚本
├── docs/                            # 文档 + 架构图
└── .kiro/                           # Kiro 规范
    ├── steering/                    # 引导文件
    │   ├── project-overview.md      # 本文件
    │   └── execution-plan.md        # 执行计划与依赖分析
    └── specs/                       # 50 个模块 Spec 归档
```

## REST API 总览

### 工作流
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/workflows | 启动新工作流 |
| GET | /api/workflows | 工作流列表 |
| GET | /api/workflows/:id | 工作流详情 |
| GET | /api/workflows/:id/report | 下载工作流报告 |

### Mission
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/tasks | 创建 Mission |
| GET | /api/tasks | Mission 列表 |
| GET | /api/tasks/:id | Mission 详情 |
| GET | /api/tasks/:id/events | Mission 事件流 |
| POST | /api/tasks/:id/decision | 提交决策（幂等） |
| POST | /api/executor/events | 执行器回调（HMAC 签名） |
| GET | /api/planets | Planet 列表（Mission 原生投影） |
| GET | /api/planets/:id | Planet 详情 |

### 审计与血缘
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/audit/entries | 审计日志查询 |
| GET | /api/audit/verify | 审计链完整性验证 |
| GET | /api/audit/anomalies | 异常检测结果 |
| POST | /api/audit/export | 审计日志导出 |
| GET | /api/lineage/nodes | 血缘节点查询 |
| GET | /api/lineage/graph | 血缘 DAG 图查询 |
| GET | /api/lineage/impact/:id | 影响分析 |
| POST | /api/lineage/export | 血缘导出 (DOT/JSON/CSV) |

### 互操作
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/a2a/tasks | A2A 任务接收 |
| GET | /api/a2a/agents | A2A Agent 发现 |
| POST | /api/agents/guest | 创建 Guest Agent |
| GET | /api/agents/guest | Guest Agent 列表 |
| DELETE | /api/agents/guest/:id | 移除 Guest Agent |

### 智能体与知识
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/agents | 智能体列表 |
| GET | /api/config/ai | AI 配置（只读） |
| POST | /api/chat | 服务端聊天代理 |
| GET | /api/reports/* | 报告查询 |
| GET | /api/rag/* | RAG 管道查询 |
| GET | /api/knowledge/* | 知识图谱查询 |
| GET | /api/telemetry/* | 遥测数据查询 |
| GET | /api/cost/* | 成本数据查询 |
| GET | /api/reputation/* | 信誉评分查询 |

### 飞书
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/feishu/relay | OpenClaw Relay 入口 |
| POST | /api/feishu/webhook | 飞书 Webhook 回调 |

## 开发规范

- TypeScript 严格模式，`npm run check` 必须通过
- 智能体工作空间隔离：`server/core/access-guard.ts` 强制路径校验，拒绝 `..` 遍历
- 消息总线层级约束：CEO ↔ Manager ↔ Worker 不允许越级，规则在 `shared/message-bus-rules.ts`
- `.env` 为唯一配置真源，前端配置面板只读
- 运行时数据（sessions/memory/reports/SOUL.md）不进 Git
- 工作流引擎通过 `WorkflowRuntime` 抽象接口与环境解耦
- LLM 调用失败时通过 `isTemporaryLLMError()` 检测并重试
- 评审评分 LLM 返回异常时使用默认评分（每项 3 分，总分 12）
- 审计日志不可删除，只能追加，哈希链保证完整性
- Guest Agent 必须在沙箱中运行，TTL 到期自动清理
- UI 组件使用 glass-panel / glass-panel-strong / glass-3d 工具类
- 标题字体 Space Grotesk (--font-display)，数据字体 JetBrains Mono (--font-mono)

## 环境变量分组

| 配置组 | 关键变量 | 说明 |
|--------|---------|------|
| 基础运行 | `PORT`、`NODE_ENV` | 默认 3001、development |
| 主 LLM | `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` | 任意 OpenAI 兼容提供商 |
| Fallback LLM | `FALLBACK_LLM_*` | 主模型不可用时的兜底 |
| Vision LLM | `VISION_LLM_*` | 视觉分析专用模型 |
| Voice | `TTS_*`、`STT_*` | 语音服务，未配置回退 Web Speech API |
| Executor | `LOBSTER_EXECUTOR_BASE_URL`、`EXECUTOR_CALLBACK_SECRET` | Docker 执行器 |
| 飞书 | `FEISHU_ENABLED`、`FEISHU_MODE`、`FEISHU_RELAY_SECRET` | 默认 mock |

## 常用命令

```bash
npm run dev:frontend   # 只启动前端（纯体验，不需要 .env）
npm run dev:all        # 启动前端 + 服务端（完整模式）
npm run dev:stop       # 停止本地开发进程
npm run build:pages    # 构建 GitHub Pages 静态产物
npm run check          # TypeScript 类型检查
```
