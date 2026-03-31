---
inclusion: manual
---

# Spec 执行路线图与架构演化

## 当前状态总览

28 个 Spec，其中 8 个已完成，21 个待开发（含新增 agent-autonomy-upgrade）。

### 已完成（基座层）

| Spec | 提供的能力 |
|------|-----------|
| workflow-engine | 十阶段工作流管道 |
| dynamic-organization | LLM 驱动的动态组织生成 |
| memory-system | 三级记忆（短期/中期/长期） |
| evolution-heartbeat | 自进化引擎 + 心跳调度 |
| mission-runtime | Mission 状态机 + ExecutionPlan + 执行器契约 |
| feishu-bridge | 飞书消息中继 |
| browser-runtime | 纯前端运行时（IndexedDB + Web Worker） |
| frontend-3d | 3D 场景 + 工作流面板 + 任务驾驶舱 |

---

## 依赖关系图

```mermaid
flowchart TB
  subgraph Foundation["✅ 已完成基座（8 个 Spec）"]
    WE[workflow-engine]
    DO[dynamic-organization]
    MS[memory-system]
    EH[evolution-heartbeat]
    MR[mission-runtime]
    FB[feishu-bridge]
    BR[browser-runtime]
    F3[frontend-3d]
  end

  subgraph Phase1["阶段 1：体验闭环 + 架构清理"]
    DDE[demo-data-engine<br/>预录数据包]
    SMF[scene-mission-fusion<br/>3D Mission 融合]
    WD1[workflow-decoupling<br/>盘点阶段]
    HITL[human-in-the-loop<br/>人机协作升级]
  end

  subgraph Phase2["阶段 2：执行闭环 + 数据收口"]
    LER[lobster-executor-real<br/>Docker 真实执行]
    DGE[demo-guided-experience<br/>回放引擎 + Live Demo]
    WD2[workflow-decoupling 数据补齐<br/>+ mission-native-projection]
    CO[cost-observability<br/>Token / 费用监控]
  end

  subgraph Phase3["阶段 3：安全 + 可靠性"]
    SS[secure-sandbox<br/>执行器安全层]
    SPR[state-persistence-recovery<br/>跨重启恢复]
    WD3[workflow-decoupling<br/>前端切换 + 清除]
  end

  subgraph Phase4["阶段 4：能力扩展"]
    MMV[multi-modal-vision<br/>图片 / Vision LLM]
    MMA[multi-modal-agent<br/>Vision + TTS / STT]
    AM[agent-marketplace<br/>Guest Agent]
    SLP[sandbox-live-preview<br/>终端 + 截图预览]
  end

  subgraph Phase5["阶段 5：生态互联"]
    AS[autonomous-swarm<br/>跨 Pod 自主协作]
    A2A[a2a-protocol<br/>Agent 互操作协议]
    AAU[agent-autonomy-upgrade<br/>Agent 自治能力升级]
    CFE[cross-framework-export<br/>导出 CrewAI 等]
    TD[telemetry-dashboard<br/>实时监控面板]
  end

  subgraph Phase6["阶段 6：规模化"]
    MUO[multi-user-office<br/>多人协作办公室]
    PD[production-deployment<br/>生产级部署]
  end

  Foundation --> Phase1
  DDE --> DGE
  WD1 --> WD2
  WD2 --> WD3
  MR --> LER
  LER --> SS
  LER --> SLP
  CO --> TD
  MMV --> MMA
  AM --> A2A
  AS --> AAU
  A2A --> AAU
  DO --> AAU
  EH --> AS
  DO --> AM

  Phase1 --> Phase2
  Phase2 --> Phase3
  Phase3 --> Phase4
  Phase4 --> Phase5
  Phase5 --> Phase6
```

---

## 推荐执行顺序（6 个阶段）


### 阶段 1：体验闭环 + 架构清理（2-3 周）

目标：让用户 30 秒内看到完整流程，同时清理技术债。

| Spec | 类型 | 并行度 | 说明 |
|------|------|--------|------|
| demo-data-engine | 纯前端 | 可并行 | 预录数据包，无外部依赖 |
| scene-mission-fusion | 纯前端 | 可并行 | 3D 场景内嵌 Mission 状态 |
| workflow-decoupling (盘点) | 分析 | 可并行 | 摸清 workflow 寄生依赖点 |
| human-in-the-loop | 跨前后端 | 可并行 | 升级现有 decision 机制 |

产出：
- Live Demo 数据包就绪
- 3D 场景信息密度提升（不再需要跳转 /tasks）
- workflow 依赖清单完成
- 人机协作界面升级

### 阶段 2：执行闭环 + 数据收口（2-3 周）

目标：真实 Docker 执行 + Mission 原生数据源统一。

| Spec | 类型 | 依赖 | 说明 |
|------|------|------|------|
| lobster-executor-real | 后端 | mission-runtime | Docker 真实容器执行 |
| demo-guided-experience | 纯前端 | demo-data-engine | 回放引擎 + Live Demo 入口 |
| workflow-decoupling (数据补齐) + mission-native-projection (后端) | 跨前后端 | 盘点完成 | MissionRecord 丰富化 + /api/planets |
| cost-observability | 跨前后端 | 无 | Token/费用监控（LLM 调用层埋点） |

产出：
- 指令 → 真实 Docker 执行 → 产物回传 完整闭环
- Live Demo 可用
- Mission 数据通道补齐
- LLM 成本可见

### 阶段 3：安全 + 可靠性（1-2 周）

目标：生产级安全和可靠性保障。

| Spec | 类型 | 依赖 | 说明 |
|------|------|------|------|
| secure-sandbox | 后端 | lobster-executor-real | 执行器安全层（权限/资源/网络隔离） |
| state-persistence-recovery | 跨前后端 | 无 | 跨重启/崩溃自动恢复 |
| workflow-decoupling (前端切换+清除) | 纯前端 | 数据补齐完成 | tasks-store 瘦身 30%+ |

产出：
- 执行器安全可控
- 长任务零中断
- tasks-store 从 2800+ 行降到 ~1800 行

### 阶段 4：能力扩展（2-3 周）

目标：Agent 能力从"文本"扩展到"多模态 + 外部协作"。

| Spec | 类型 | 依赖 | 说明 |
|------|------|------|------|
| multi-modal-vision | 跨前后端 | 无 | 图片/截图 Vision LLM 分析 |
| multi-modal-agent | 跨前后端 | multi-modal-vision | Vision + TTS/STT，宠物"能看能说" |
| agent-marketplace | 跨前后端 | dynamic-organization | Guest Agent 临时加入办公室 |
| sandbox-live-preview | 跨前后端 | lobster-executor-real | 3D 场景内终端 + 截图预览 |

产出：
- Agent 能处理图片/语音
- 外部 Agent 可临时加入协作
- 执行过程实时可视

### 阶段 5：生态互联（2-3 周）

目标：从封闭系统走向开放生态。

| Spec | 类型 | 依赖 | 说明 |
|------|------|------|------|
| autonomous-swarm | 后端 | evolution-heartbeat | 跨 Pod 自主协作 |
| a2a-protocol | 跨前后端 | agent-marketplace | Agent 互操作标准协议 |
| agent-autonomy-upgrade | 跨前后端 | autonomous-swarm, a2a-protocol, dynamic-organization | Agent 自治能力升级（自评估/竞争执行/动态协作） |
| cross-framework-export | 跨前后端 | workflow-engine | 导出为 CrewAI/AutoGen/LangGraph |
| telemetry-dashboard | 跨前后端 | cost-observability | 3D 场景实时监控面板 |

产出：
- Pod 之间自主发起子任务
- 与 CrewAI/Claude 等外部 Agent 互操作
- Agent 自评估、竞争执行、动态协作网络
- 一键导出到其他框架
- 全局监控看板

### 阶段 6：规模化（2-3 周）

目标：从单用户演示走向多人生产环境。

| Spec | 类型 | 依赖 | 说明 |
|------|------|------|------|
| multi-user-office | 跨前后端 | 大部分基座 | 多人同时进入办公室 |
| production-deployment | DevOps | 大部分基座 | Docker Compose + Prometheus + 零停机 |

产出：
- 多人协作办公室
- 一键生产部署

---

## 架构演化路径

### 当前架构（Phase 0）

```mermaid
flowchart TB
  User([用户 / 浏览器])

  subgraph Client["前端层"]
    Scene3D["3D 办公场景<br/>PetWorkers"]
    WFPanel["工作流面板"]
    TasksPage["/tasks 任务驾驶舱<br/>（独立页面）"]
  end

  subgraph Brain["Cube Brain"]
    API["Express API"]
    Engine["工作流引擎<br/>十阶段管道"]
    Memory["三级记忆 + 自进化"]
    MockExec["Mock 执行器<br/>（模拟延迟 + 假数据）"]
  end

  subgraph Storage["持久化"]
    IDB["IndexedDB<br/>浏览器端"]
    JSON["database.json<br/>服务端"]
  end

  User --> Scene3D
  User --> TasksPage
  Scene3D -.->|Frontend Mode| IDB
  WFPanel -->|Advanced Mode| API
  API --> Engine --> Memory
  Engine --> MockExec
  Engine --> JSON
```

特征：演示原型，mock 执行，双轨数据源（workflow + mission），单用户。

### 阶段 1-2 后架构

```mermaid
flowchart TB
  User([用户 / 浏览器])

  subgraph Client["前端层"]
    Scene3D["3D 办公场景<br/>PetWorkers + MissionIsland"]
    LiveDemo["Live Demo 回放引擎<br/>30 秒完整演示"]
    HITLUI["人机协作面板<br/>暂停 / 决策 / 审批"]
    CostPanel["成本看板<br/>Token / 费用"]
  end

  subgraph Brain["Cube Brain"]
    API["Express API"]
    Engine["工作流引擎"]
    Memory["三级记忆 + 自进化"]
    MissionNative["Mission 原生数据源<br/>（单源，无 workflow 投影）"]
    HumanLoop["人机协作引擎<br/>多步决策链"]
  end

  subgraph Executor["执行层"]
    Docker["真实 Docker 执行器<br/>dockerode"]
    HMAC["HMAC 签名回调<br/>日志 / 工件"]
  end

  User --> Scene3D
  User --> HITLUI
  Scene3D -.->|Frontend Mode| LiveDemo
  Scene3D -->|Advanced Mode| API
  API --> Engine --> Memory
  Engine --> MissionNative
  Engine --> HumanLoop
  Engine -->|ExecutionPlan| Docker
  Docker -->|回调| HMAC --> MissionNative
  MissionNative -->|Socket mission_event| Scene3D
  CostPanel --> API
```

特征：真实执行闭环，单源数据，人机协作，30 秒 Demo，成本可见。

### 阶段 3-4 后架构

```mermaid
flowchart TB
  User([用户 / 浏览器])

  subgraph Client["前端层"]
    Scene3D["3D 办公场景<br/>MissionIsland + SandboxMonitor"]
    Vision["多模态输入<br/>图片 / 语音 / 视频"]
    GuestUI["Guest Agent 渲染<br/>临时 Pod + 入退场动画"]
    Terminal["终端实时预览<br/>xterm.js"]
    Screenshot["截图实时预览"]
  end

  subgraph Brain["Cube Brain"]
    API["Express API"]
    Engine["工作流引擎"]
    Memory["三级记忆 + 自进化"]
    MissionNative["Mission 原生数据源"]
    GuestReg["Guest Agent 注册表<br/>临时注册 / 注销"]
    CostEngine["成本监控引擎<br/>预算限制 + 自动降级"]
    VisionLLM["Vision LLM Provider"]
  end

  subgraph Executor["安全执行层"]
    Sandbox["安全沙箱 Docker 执行器<br/>权限 / 资源 / 网络隔离"]
    LogStream["日志流 + 截图流"]
    Recovery["状态恢复引擎<br/>跨重启零中断"]
  end

  subgraph External["外部 Agent"]
    ExtLLM["第三方 LLM<br/>Claude / GPT / GLM"]
  end

  User --> Scene3D
  User --> Vision
  Vision --> VisionLLM
  Scene3D --> API
  API --> Engine --> Memory
  Engine --> MissionNative
  Engine --> GuestReg
  GuestReg -->|独立 LLM| ExtLLM
  GuestReg -->|Socket guest_join| GuestUI
  Engine -->|ExecutionPlan| Sandbox
  Sandbox --> LogStream
  LogStream -->|mission_log| Terminal
  LogStream -->|mission_screen| Screenshot
  Sandbox --> Recovery
  CostEngine --> API
```

特征：安全执行，多模态，外部 Agent 加入，成本可控，状态可恢复。

### 阶段 5-6 后架构（目标态）

```mermaid
flowchart TB
  Users([多用户])

  subgraph Client["前端层"]
    Room["WebSocket Room<br/>多人 3D 协作办公室"]
    Scene3D["3D 场景<br/>MissionIsland + SandboxMonitor<br/>+ TelemetryOverlay + SwarmViz"]
    MultiModal["多模态 I/O<br/>Vision + TTS / STT"]
    Export["一键导出<br/>CrewAI / AutoGen / LangGraph"]
  end

  subgraph Brain["Cube Brain"]
    API["Express API + Room Manager"]
    Engine["工作流引擎"]
    Memory["三级记忆 + 自进化"]
    MissionNative["Mission 原生数据源"]
    Swarm["Swarm 编排器<br/>跨 Pod 自主协作"]
    A2A["A2A 协议网关<br/>Agent 互操作"]
    GuestReg["Guest Agent 注册表"]
    CostEngine["成本监控 + 遥测"]
    HumanLoop["人机协作<br/>多步审批流"]
    Recovery["状态恢复引擎"]
  end

  subgraph Executor["安全执行集群"]
    Sandbox["安全沙箱 Docker 执行器"]
    LogStream["日志 / 截图实时流"]
    Artifacts["工件管理 + 日志聚合"]
  end

  subgraph External["外部生态"]
    ExtAgents["CrewAI / Claude / AutoGen<br/>外部 Agent"]
    ExtLLM["多 LLM Provider"]
    Prometheus["Prometheus 监控"]
  end

  subgraph Deploy["生产部署"]
    Compose["Docker Compose"]
    ZeroDown["零停机更新"]
  end

  Users --> Room --> Scene3D
  Scene3D --> API
  API --> Engine --> Memory
  Engine --> MissionNative
  Engine --> Swarm
  Swarm --> A2A
  A2A <-->|标准协议| ExtAgents
  Engine --> GuestReg -->|独立 LLM| ExtLLM
  Engine --> HumanLoop
  Engine -->|ExecutionPlan| Sandbox
  Sandbox --> LogStream --> Scene3D
  Sandbox --> Artifacts
  CostEngine --> Prometheus
  CostEngine --> Scene3D
  MultiModal --> API
  Export --> Engine
  Recovery --> MissionNative
  Compose --> Brain
  Compose --> Executor
```

特征：多人协作，自主 Agent 社会，跨框架互操作，生产级部署，全局可观测。

---

## 关键协调点

| 协调点 | 涉及 Spec | 说明 |
|--------|-----------|------|
| MissionRecord 丰富化 | workflow-decoupling + mission-native-projection | 同一件事，只做一次 |
| 执行器安全 | lobster-executor-real → secure-sandbox | 先有真实执行器，再加安全层 |
| 多模态 | multi-modal-vision → multi-modal-agent | vision 是 agent 多模态的前置 |
| 外部 Agent | agent-marketplace → a2a-protocol | 先有 Guest Agent，再有标准协议 |
| 监控 | cost-observability → telemetry-dashboard | 先有成本埋点，再有全局面板 |
| 3D 场景扩展 | scene-mission-fusion → sandbox-live-preview | 共享 Html 桥接模式 |
| 数据源 | workflow-decoupling → 所有前端 spec | 解耦完成后前端代码更干净 |
| Agent 自治能力 | autonomous-swarm + a2a-protocol + dynamic-organization → agent-autonomy-upgrade | 自治能力升级依赖 Swarm 编排、A2A 协议和动态组织生成 |

## 风险提示

- lobster-executor-real 是最大的单点风险：sandbox-live-preview、secure-sandbox、production-deployment 都依赖它
- workflow-decoupling 的盘点阶段必须在任何前端 spec 之前完成，否则新代码可能引入新的 workflow 依赖
- multi-user-office 是复杂度最高的 spec，建议放到最后，等其他能力稳定后再做
