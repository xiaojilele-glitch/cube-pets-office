<p align="center">
  <img src="./banner.png" alt="Cube Pets Office banner" width="100%" />
</p>

<h1 align="center">Cube Pets Office</h1>

<p align="center">
  一个把“单条自然语言指令”编排成 18 个智能体协同工作的 3D 多智能体系统原型。
</p>

<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-活跃原型-0ea5e9" />
  <img alt="agents" src="https://img.shields.io/badge/agents-18-22c55e" />
  <img alt="workflow" src="https://img.shields.io/badge/workflow-10%20阶段-f97316" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-111827" />
</p>

## 项目概览

Cube Pets Office 最初是一个 3D 展示型页面，现在已经演进成一个可运行的多智能体编排系统：

- 前端用 3D 办公室场景展示 18 个智能体的实时状态
- 后端实现了 10 阶段 workflow 编排管道
- WebSocket 会实时推送 Agent 状态和消息流
- 支持记忆、评审、修订、验证和演化闭环
- 聊天面板和 workflow 共用同一套服务端 AI 配置
- AI 配置以 `.env` 为唯一真源

整个系统的主链路可以概括为：

> 用户输入一条指令 -> CEO 分解方向 -> 部门经理规划 -> Worker 执行 -> 评审 -> 审计 -> 修订 -> 验证 -> 汇总 -> 反馈 -> 演化

## 当前已实现

- 18 个智能体已经完成注册与加载
- 18 个智能体已经在 3D 场景中完成布局
- 工作流已经支持完整 10 阶段运行：
  `direction -> planning -> execution -> review -> meta_audit -> revision -> verify -> summary -> feedback -> evolution`
- 前端已经提供以下视图：
  - 指令视图
  - 组织视图
  - 进度视图
  - 评审视图
  - 记忆视图
  - 历史视图
- 已实现消息流粒子动画和阶段联动动画
- 已实现短期记忆注入
- 已实现历史工作流摘要检索
- 已实现基于 `soul_md` 的 persona 演化
- 已实现统一的服务端聊天入口 `/api/chat`
- 已实现基于 `.env` 的统一模型配置链路

## 当前仍未完成

这个仓库现在是“可运行原型”，不是“完整框架”。

- 严格的文件系统隔离还没有落地，当前更接近约定式隔离
- 中期记忆还不是向量检索，当前是摘要加关键词检索
- 长期记忆目前落在存储层的 `soul_md` 字段，不是文件版 `SOUL.md` 自动更新
- heartbeat / 定时自主搜索 / 自主报告机制尚未实现
- 历史文档里仍有一部分旧内容和待清理段落

## 技术栈

- 前端：React 19、Vite、TypeScript、Zustand
- 3D：Three.js、React Three Fiber、Drei
- 后端：Express、Socket.IO、TypeScript
- AI：OpenAI 兼容接口
- 存储：本地 JSON 数据库 + Agent runtime 工作空间文件

## 项目结构

```text
client/   前端应用、3D 场景、工作流面板、聊天面板
server/   API 路由、Workflow Engine、Agent Registry、Memory、Socket
shared/   共享类型与工具
data/     本地运行时状态和 Agent 工作空间产物
scripts/  本地开发辅助脚本
```

## 运行模式

当前仓库默认采用“纯前端模式优先，高级模式可选”的产品化入口：

- `纯前端模式`：默认启动路径，适合首次打开、分享演示、浏览 3D 场景、阅读论文和体验本地聊天；不要求服务端和 `.env`
- `高级模式`：保留现有服务端实现，启用 `/api`、Socket.IO、真实工作流、heartbeat 报告和服务端模型调用

现有服务端链路仍然保留，在确认纯前端链路稳定前不会删除。

## 快速开始

### 1. 安装依赖

```bash
corepack pnpm install
```

### 2. 默认先启动纯前端模式

```bash
corepack pnpm run dev:frontend
```

默认本地地址：

- 前端：`http://localhost:3000`

这一模式不要求 `.env`，适合先体验界面与组织结构。

### 3. 需要真实工作流时再切到高级模式

先复制 `.env.example` 为 `.env`，并填入你自己的模型服务配置。

一个最小示例：

```dotenv
PORT=3001
NODE_ENV=development

LLM_API_KEY=your_api_key_here
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-5.4
LLM_WIRE_API=responses
LLM_REASONING_EFFORT=high
LLM_TIMEOUT_MS=45000
```

然后启动完整链路：

```bash
corepack pnpm run dev:advanced
```

高级模式默认地址：

- 前端：`http://localhost:3000`
- 后端 API：`http://localhost:3001/api`

也可以分别启动：

```bash
corepack pnpm run dev:frontend
corepack pnpm run dev:server
```

### 4. 类型检查

```bash
corepack pnpm run check
```

## 运行时数据

项目运行后会在 `data/` 下生成本地 runtime 数据，包括：

- `data/database.json`
- `data/agents/*/sessions/`
- `data/agents/*/memory/`
- `data/agents/*/reports/`

这些文件属于本地运行状态，不属于源码本身，因此公开仓库默认会忽略它们。

## 主要 API

当前后端暴露的主要接口包括：

- `POST /api/workflows`：启动一条新的工作流
- `GET /api/workflows`：获取工作流列表
- `GET /api/workflows/:id`：获取某条工作流详情
- `GET /api/agents`：获取全部 Agent
- `GET /api/agents/:id/memory/recent`：获取最近记忆
- `GET /api/agents/:id/memory/search`：搜索历史摘要
- `GET /api/config/ai`：查看当前 AI 配置来源和运行参数
- `POST /api/chat`：统一的服务端聊天入口

## 开源说明

- License：MIT
- 当前公开的是项目的工作中版本
- 公开仓库不包含本地 memory / session / local config 快照
- 如果你 fork 本项目，建议自行配置并保管 `.env`

## 路线图

更细的阶段规划，以及“哪些能力已经完成、哪些仍未完成”的拆分说明，见 `ROADMAP.md`。
