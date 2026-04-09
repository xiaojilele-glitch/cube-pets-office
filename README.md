<p align="center">
  <img src="./banner.png" alt="Cube Pets Office banner" width="100%" />
</p>

<h1 align="center">🐾 Cube Pets Office</h1>

<p align="center">
  <strong>在 3D 办公室里观察 AI 智能体协作——无需任何配置</strong><br/>
  Watch AI agents collaborate in a 3D office — no setup required.
</p>

<p align="center">
  <a href="https://opencroc.github.io/cube-pets-office/"><strong>👉 在线体验 Live Demo</strong></a>
</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-111827" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-180K%20lines-3178c6" />
  <img alt="specs" src="https://img.shields.io/badge/specs-57%20tracked-0ea5e9" />
  <img alt="status" src="https://img.shields.io/badge/status-37%20done%20%C2%B7%205%20partial-22c55e" />
  <img alt="scene" src="https://img.shields.io/badge/3D-Three.js-8b5cf6" />
  <img alt="agents" src="https://img.shields.io/badge/agents-动态组织-f97316" />
  <img alt="i18n" src="https://img.shields.io/badge/i18n-中文%20%2F%20English-22c55e" />
</p>

---

## ⚡ 项目概述

Cube Pets Office 是一个**从 0 实现的开源多智能体可视化平台**。输入一条自然语言指令，系统自动组建 AI 团队——CEO 拆解方向、经理分配任务、Worker 并行执行、互相评审打分、审计修订、最终汇总进化。整个过程在 3D 办公场景中实时呈现。

它不只是生成文档。系统会把任务规划成结构化的执行计划，下发到 Docker 容器中真实运行，页面上展示的是执行状态、运行日志、工件链接和最终结果——而不是一份 Markdown 报告。

**不需要 API Key** 就能体验可视化和交互流程。接入 LLM + 执行器后可以跑完整的真实任务闭环。

当前近端重点，也是在把 `/tasks` 从“观察执行”继续打磨成“执行控制台”：补齐取消、状态切换、blocker、负责人和下一步动作等协作信息。

相比同类多智能体框架，我们拥有 🚀 **八大核心优势**：

> 🏢 **动态组织生成**：不是固定角色，而是根据任务内容动态生成 CEO / 经理 / Worker 团队结构。编程任务和营销策略会得到完全不同的组织配置。

> 🧬 **自进化智能体**：每轮工作流结束后，智能体分析自己的弱项维度，自动修补人设定义。三级记忆（短期 / 中期 / 长期）让智能体越用越聪明。

> 🎯 **20 分评审制**：每份交付物按准确性、完整性、可操作性、格式四个维度打分，低于 16 分自动退回修订。独立审计员进行元审计，确保质量与合规。

> 🐳 **真实执行闭环**：不止于 AI 规划——结构化执行计划下发到 Docker 容器真实运行，页面实时展示容器状态、日志和产物。

> 🔀 **双运行时架构**：同一套工作流引擎可以跑在浏览器里（IndexedDB + Web Worker）或服务端（Express + JSON），不绑定任何一端。

> 💰 **全链路成本治理**：从被动监控到主动治理——多级预算、四级告警、灰度模型降级、并发限流、任务暂停审批、成本预测与优化建议，形成完整闭环。

> 🔗 **跨框架互操作**：通过 A2A 协议与 CrewAI / LangGraph / AutoGen 等外部框架的 Agent 直接通信，Guest Agent 机制让外部智能体以沙箱模式临时加入团队。

> 🛡️ **不可篡改审计 + 数据血缘**：哈希链式审计日志确保操作不可篡改，数据血缘追踪让每一份数据的来源和流转路径清晰可查。

---

## 🪄 一次完整的执行流程

告别传统的数据看板，在 Cube Pets Office，一切由一个简单的问题开始：

```
你输入: "制定本季度用户增长策略"
```

| 步骤 | 阶段 | 主要操作 | 参与组件 |
|:----:|------|---------|---------|
| 1 | 🏢 动态组建 | 根据任务内容生成 CEO、经理、Worker 团队结构 | 动态组织生成器 + LLM |
| 2 | 📋 CEO 拆解 | CEO 将指令分解为各部门方向 | 工作流引擎 + LLM |
| 3 | 🎯 经理规划 | 每位经理为下属 Worker 分配具体任务 | 工作流引擎 + LLM |
| 4 | ⚡ Worker 执行 | Worker 并行产出交付物 | 工作流引擎 + LLM |
| 5 | 📝 经理评审 | 经理按 4 维度打分（满分 20），低于 16 分退回 | 评审系统 |
| 6 | 🔍 元审计 | 独立审计员检查质量与合规性 | 审计引擎 |
| 7 | 🔄 修订 | 被退回的 Worker 根据反馈修改 | 工作流引擎 + LLM |
| 8 | ✅ 验证 | 经理逐条确认反馈是否被回应 | 评审系统 |
| 9 | 📊 汇总 | 部门报告汇总为 CEO 级综合报告 | 工作流引擎 |
| 10 | 🧬 进化 | 智能体从评分中学习，自动更新自身人设 | 自进化引擎 |

> 3D 办公室实时显示每个智能体的状态——思考中 💭、执行中 ⚡、评审中 📝、空闲 😴

---

## 🚀 快速开始

### 方式一：纯体验（不需要 API Key）

打开 [在线演示](https://opencroc.github.io/cube-pets-office/)，或者本地运行：

```bash
npm install
npm run dev:frontend
```

完整的 3D 场景、动态组织可视化、工作流面板和交互界面——全部在浏览器里运行。

### 方式二：接入 LLM（完整开发模式）

```bash
cp .env.example .env
# 编辑 .env，至少填入 LLM_API_KEY
npm run dev:all
```

最小 `.env` 配置：

```dotenv
LLM_API_KEY=你的密钥
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-5.4
LLM_WIRE_API=responses
```

`npm run dev:all` 会同时启动前端、服务端和 Lobster 执行器。若机器上没有 Docker，把 `LOBSTER_EXECUTION_MODE=mock` 写入 `.env` 即可继续体验完整链路。

### 方式三：单独控制执行器（调试 / 真实 Docker）

```bash
# 终端 1：启动服务端
npm run dev:server

# 终端 2：启动前端
npm run dev:frontend

# 终端 3：单独启动执行器（mock 模式，无需 Docker）
LOBSTER_EXECUTION_MODE=mock npx tsx services/lobster-executor/src/index.ts

# 或真实 Docker 模式（需要 Docker 运行中）
LOBSTER_EXECUTION_MODE=real npx tsx services/lobster-executor/src/index.ts
```

PowerShell 下可先执行 `$env:LOBSTER_EXECUTION_MODE='mock'` 或 `$env:LOBSTER_EXECUTION_MODE='real'` 再启动命令。

系统会把 AI 生成的执行计划下发到 Lobster 执行器，页面上实时展示容器状态、日志和产物。支持 mock 模式（开发调试）和 real 模式（真实 Docker 容器执行）。

---

## 🏗️ 系统架构

下图按 2026-04-10 的项目快照更新：主干仍是前端 / Cube Brain / Intelligence / Trust / Execution / Interop 六层，但前端侧已经明确纳入任务控制台、产物预览下载与执行器回传闭环。

<p align="center">
  <img src="./docs/architecture.svg" alt="Cube Pets Office Architecture" width="100%" />
</p>

---

## 📂 项目代码结构

```
cube-pets-office/
├── client/                          # 🖥️ 前端应用
│   └── src/
│       ├── components/              # Scene3D、tasks、nl-command、lineage、replay 等 UI
│       ├── lib/                     # Zustand stores、API clients、工具函数
│       ├── pages/                   # 页面级入口
│       ├── runtime/                 # 浏览器运行时
│       ├── workers/                 # snapshot-worker 等 Web Worker
│       └── i18n/                    # 中英文本地化资源
├── server/                          # 🧠 服务端
│   ├── core/                        # workflow-engine、dynamic-organization、A2A、swarm、治理逻辑
│   ├── tasks/                       # Mission runtime / store / decision
│   ├── routes/                      # REST API 路由
│   ├── audit/ replay/ lineage/      # 审计、回放、数据血缘
│   ├── knowledge/ rag/ permission/  # 知识、检索、权限
│   └── tests/                       # Vitest + fast-check
├── shared/                          # 📦 前后端共享契约
│   ├── mission/ executor/ nl-command/
│   ├── knowledge/ lineage/ replay/
│   ├── audit/ permission/ rag/ skill/
│   └── telemetry/ llm/ demo/ export/
├── services/lobster-executor/       # 🐳 执行器
│   ├── src/index.ts                 # 执行器入口
│   ├── src/app.ts                   # HTTP API + /health
│   ├── src/docker-runner.ts         # 真实 Docker 容器生命周期
│   ├── src/mock-runner.ts           # Mock 模式（无 Docker 依赖）
│   └── src/security-*.ts            # 沙箱、安全审计、凭证注入
├── .kiro/                           # 需求与 steering
│   ├── specs/                       # requirements / design / tasks
│   └── steering/                    # 当前项目总览与执行口径
├── data/                            # 本地 JSON、回放、测试数据
├── scripts/                         # dev-all、smoke、worktree 工具
└── docs/                            # 📖 文档与规范
```

---

## ✅ 功能模块完成状态

### 🔧 核心引擎

| 功能 | 状态 | 说明 |
|------|:----:|------|
| 3D 办公室 + 智能体实时状态 | ✅ | Three.js 场景，实时显示思考/执行/评审/空闲 |
| 动态组织生成 | ✅ | 根据任务内容 LLM 生成 CEO/经理/Worker 结构 |
| 十阶段工作流管道 | ✅ | 组建→拆解→规划→执行→评审→审计→修订→验证→汇总→进化 |
| 20 分制评审 + 元审计 | ✅ | 四维度打分，独立审计员质量检查 |
| 三级记忆系统 | ✅ | 短期（会话）/ 中期（向量检索）/ 长期（SOUL.md 人设） |
| 自进化 + 心跳 | ✅ | 评分分析→人设修补→能力注册，自主搜索趋势报告 |
| Mission 任务状态机 | ✅ | receive→understand→plan→provision→execute→finalize |
| 双运行时 | ✅ | 浏览器 IndexedDB + 服务端 Express，同一套引擎 |

### 🤖 智能体能力

| 功能 | 状态 | 说明 |
|------|:----:|------|
| Skill 热插拔体系 | ✅ | 运行时注册/卸载技能，不重启服务 |
| 动态角色切换 | ✅ | Agent 运行时切换角色，适应任务变化 |
| 自评估 + 竞争执行 | ✅ | Agent 自我评估能力，竞争择优执行 |
| 信誉评分系统 | ✅ | 基于历史表现的信誉积累与衰减 |
| 多模态编排 | ✅ | 语音 + Vision 统一编排 |
| 人工审批流 | ✅ | 通用审批 + 决策链，支持暂停等待人工确认 |

### 🧠 知识与检索

| 功能 | 状态 | 说明 |
|------|:----:|------|
| 向量数据库 + RAG 管道 | ✅ | 7 步 Pipeline：加载→分块→嵌入→索引→检索→重排→生成 |
| 结构化知识图谱 | ✅ | 实体/关系/推理，支持可视化探索 |
| 附件输入 | ✅ | PDF、Word、Excel、图片 OCR |

### 📊 可观测性与治理

| 功能 | 状态 | 说明 |
|------|:----:|------|
| 实时遥测仪表盘 | ✅ | 事件总线 + Recharts 可视化 |
| 成本可观测性 | ✅ | Token 追踪、模型定价、Agent 成本分布 |
| 主动成本治理 | ✅ | 多级预算 / 四级告警 / 灰度降级 / 审计链 |
| 长任务恢复 | ✅ | 浏览器端 IndexedDB 持久化，断点续跑 |
| 执行回放 | ✅ | Mission 执行过程录制与时间线回放 |

### 🔗 交互与集成

| 功能 | 状态 | 说明 |
|------|:----:|------|
| 自然语言指挥中心 | ✅ | 自然语言→结构化命令，智能路由 |
| 3D 场景 Mission 融合 | ✅ | Mission 状态实时映射到 3D 智能体动画 |
| 跨框架导出 | ✅ | 一键导出为 CrewAI / LangGraph / AutoGen 格式 |
| 演示引擎 + 引导体验 | ✅ | 预录数据包 + 步骤引导，零配置体验 |
| 飞书集成 | ✅ | ACK / Progress / 决策回传 |
| 中英文 / 移动端 | ✅ | i18n 双语切换，响应式布局 |

### 🐳 执行器与安全

| 功能 | 状态 | 说明 |
|------|:----:|------|
| Docker 真实容器生命周期 | ✅ | dockerode 容器创建/启动/日志流/超时/清理，HMAC 签名回调 |
| AI 容器能力注入 | ✅ | API Key 安全注入、凭证脱敏、AI 任务预设模板 |
| 安全沙箱 | ✅ | seccomp/AppArmor 安全策略、能力裁剪、安全审计日志 |
| 容器实时终端 + 截图预览 | ✅ | WebSocket 终端流、容器截图、3D 场景沙箱监控 |
| Agent 权限矩阵 | ✅ | 细粒度工具/资源/网络权限控制，RBAC 矩阵 |

### 🌐 协作与互操作

| 功能 | 状态 | 说明 |
|------|:----:|------|
| 跨 Pod 自主协作 | ✅ | 多节点 Agent 集群发现、任务委派、共识协议 |
| A2A 互操作协议 | ✅ | 跨框架 Agent 通信标准，CrewAI/LangGraph/AutoGen 适配器 |
| Guest Agent 市场 | ✅ | 外部 Agent 沙箱接入、TTL 生命周期、邀请解析 |
| 不可篡改审计链 | ✅ | 哈希链式审计日志、异常检测、合规映射 |
| 数据血缘追踪 | ✅ | DAG 可视化、变更检测、审计集成、多格式导出 |

### 🎨 UI 与体验

| 功能 | 状态 | 说明 |
|------|:----:|------|
| 全息操控舱 UI | ✅ | 毛玻璃拟态 + 有机科幻风格，胶囊 Dock、侧边抽屉、发光 CTA |
| 3D Agent 状态融合 | ✅ | 呼吸光晕动画、状态驱动文字颜色、glass-3d 姓名牌 |
| 科技感排版 | ✅ | Space Grotesk 标题 + JetBrains Mono 数据字体 |

### 🧩 近期补完

| 功能 | 状态 | 说明 |
|------|:----:|------|
| 工作流产物展示与下载 | 🧪 | 功能开发已完成，当前仅剩最终检查点验收 |
| 任务取消端到端 | 📋 | P0，补齐取消入口、执行器中断、状态落库与 UI 回显 |
| 任务状态操作栏 | 📋 | P0，补齐暂停 / 恢复 / 重试 / 标记阻塞 / 终止 |
| 任务详情首屏重排 | 📋 | P1，把主操作、当前负责人、blocker、下一步动作放到第一屏 |
| 执行协作文案收敛 | 📋 | P1，从“动态组队 / 方案叙事”收口为“开发执行 / 交付协作” |
| 任务控制台 UI 打磨 | 📋 | P2，优化反馈时机、按钮层级、状态可见性、空态和错误态 |
| i18n cleanup | 📋 | 文案统一、国际化收口 |

### 🚧 规划中（平台层）

| 功能 | 状态 | 说明 |
|------|:----:|------|
| Docker Compose 生产部署 | 📋 | 一键部署完整系统 |
| 多人实时协作 | 📋 | 多用户同时操作同一 Office |
| 多租户隔离 | 📋 | 租户级数据和资源隔离 |
| Agent 交易市场平台 | 📋 | 信誉驱动的 Agent 交易与发现 |
| K8s Agent Operator | 📋 | Kubernetes 原生 Agent 编排 |
| 边缘部署 | 📋 | 边缘节点 Agent 运行时 |
| VR 沉浸式扩展 | 📋 | VR 头显中的 3D 办公室 |

---

## 📈 项目规模

| 维度 | 数据 |
|------|------|
| TypeScript 源码 | **850+ 文件 / ~180,000 行** |
| `.kiro/specs` | **57 个目录：37 已完成 / 5 部分完成 / 14 未开始 / 1 待补 `tasks.md`** |
| 共享契约 | **14 个 `shared/**/contracts.ts` 模块** |
| 测试覆盖 | **300+ 测试文件（Vitest + fast-check）** |
| 当前活跃增量 | 任务控制台补完主线（5 个新 spec） + `workflow-artifacts-display` 最终验收 |
| Commits | 280+ |

---

## 🛠️ 技术栈

| 层 | 技术 |
|----|------|
| 3D 场景 | Three.js、React Three Fiber、Drei |
| 前端 | React 19、Vite、TypeScript、Zustand、Recharts、shadcn/ui |
| 后端 | Express、Socket.IO、TypeScript |
| AI 接入 | OpenAI 兼容接口（任意提供商） |
| 知识检索 | 向量数据库、RAG Pipeline、知识图谱 |
| 测试 | Vitest、fast-check（属性测试） |
| 存储 | 浏览器: IndexedDB / 服务端: 本地 JSON |
| 部署 | GitHub Pages（前端）/ Docker（执行器） |

---

## 🎯 适合谁？

| 角色 | 用途 |
|------|------|
| 🔬 AI 研究者 | 探索多智能体协调模式、层级委派和评审机制 |
| 🎓 学生 | 学习智能体架构、任务分解、评估与进化 |
| 👨‍💻 开发者 | 作为构建自己 agent 系统的可视化参考 |
| ✍️ 技术博主 | 找一个有视觉冲击力的 demo 来写文章 |
| 🧐 好奇的人 | 看看让 AI 智能体经营一间办公室会发生什么 |

---

## 📦 常用命令

```bash
npm run dev:frontend   # 只启动前端（纯体验）
npm run dev:server     # 只启动服务端
npm run dev:all        # 启动前端 + 服务端 + 执行器
npm run dev:stop       # 停止本地开发进程
npx tsx services/lobster-executor/src/index.ts  # 单独启动执行器
npm run build          # 构建前端 + 服务端
npm run build:pages    # 构建 GitHub Pages 静态产物
npm run preview        # 预览前端构建产物
npm run check          # TypeScript 类型检查
```

---

## 🤝 参与贡献

欢迎 PR。提交前建议运行 `npm run check`。如果当前分支存在进行中的类型基线问题，请至少保证不新增错误，并在提交说明里写清楚差异。推荐从这两个文件开始了解核心逻辑：

- 工作流引擎：`server/core/workflow-engine.ts`
- 浏览器运行时：`client/src/runtime/browser-runtime.ts`

---

## 📖 文档

- [.kiro/steering/](./.kiro/steering/) — 当前项目总览、执行口径与实现指南
- [.kiro/specs/](./.kiro/specs/) — 每个 spec 的 requirements / design / tasks
- [ROADMAP.md](./ROADMAP.md) — 开发阶段与完成状态
- [CHANGELOG.md](./CHANGELOG.md) — 近期变更记录
- [docs/](./docs/) — 契约规范与架构说明

---

## 📄 License

MIT

---

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=opencroc/cube-pets-office&type=Date)](https://star-history.com/#opencroc/cube-pets-office&Date)
