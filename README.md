<p align="center">
  <img src="./banner.png" alt="Cube Pets Office banner" width="100%" />
</p>

<h1 align="center">Cube Pets Office</h1>

<p align="center">
  把一条自然语言指令编排成 18 个 Agent 协同工作的 3D 多智能体办公原型。
</p>

<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-active%20prototype-0ea5e9" />
  <img alt="agents" src="https://img.shields.io/badge/agents-18-22c55e" />
  <img alt="workflow" src="https://img.shields.io/badge/workflow-10%20stages-f97316" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-111827" />
</p>

<p align="center">
  <a href="https://opencroc.github.io/cube-pets-office/"><strong>Live Demo</strong></a>
  ·
  <a href="https://opencroc.github.io/cube-pets-office/">https://opencroc.github.io/cube-pets-office/</a>
</p>

## 项目概览

Cube Pets Office 是一个把 3D 场景展示、Agent 组织结构、工作流编排和聊天交互放在同一界面的实验性产品原型。

当前仓库已经包含：

- 18 个 Agent 的 3D 办公室场景
- 完整的 10 阶段 workflow 编排链路
- 工作流、组织、评审、记忆、历史等前端面板
- 基于 Express 和 Socket.IO 的服务端运行时
- 统一的服务端聊天入口 `/api/chat`
- 本地前端预览模式与完整服务端模式双入口
- 面向 GitHub Pages 的纯静态演示构建

工作流主链路如下：

> 用户指令 -> CEO 拆解方向 -> Manager 规划任务 -> Worker 执行 -> Review -> Meta Audit -> Revision -> Verify -> Summary -> Feedback -> Evolution

## 当前运行模式

仓库现在有 3 种清晰分离的运行方式：

### 1. Frontend Mode

默认入口，适合本地体验和演示：

- 不依赖服务端即可启动界面
- 可浏览 3D 场景、组织结构、论文内容和本地演示聊天
- 适合做 UI 验证、交互走查和纯前端分享

### 2. Advanced Mode

完整链路模式，保留现有服务端实现：

- 连接 `/api` 与 Socket.IO
- 执行真实工作流、报告、记忆和服务端模型调用
- 需要 `.env` 中的模型配置

### 3. GitHub Pages Static Demo

专门用于 GitHub Pages 的静态构建：

- 只影响 Pages 构建，不影响本地和服务端版本
- 强制停留在前端静态演示路径
- 不连接服务端，不触发真实多 Agent 工作流
- 仍可展示 3D 场景、界面流程、本地演示聊天和工作流结构

## 技术栈

- 前端：React 19、Vite、TypeScript、Zustand
- 3D：Three.js、React Three Fiber、Drei
- 后端：Express、Socket.IO、TypeScript
- AI 接入：OpenAI 兼容接口
- 本地存储：JSON 数据文件

## 项目结构

```text
client/   前端应用、3D 场景、工作流面板、聊天面板
server/   API、Socket、Workflow Engine、Agent Registry、Memory
shared/   共享类型与工具
data/     本地运行期数据和 Agent 产物
scripts/  启动、停止、构建辅助脚本
```

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动前端预览模式

```bash
pnpm run dev:frontend
```

默认地址：

- 前端：`http://localhost:3000`

这个模式不要求 `.env`，适合先看界面、场景和交互。

### 3. 启动完整服务端链路

先复制环境变量模板：

```bash
cp .env.example .env
```

然后在 `.env` 中填入模型配置。最小示例：

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

启动完整链路：

```bash
pnpm run dev:advanced
```

默认地址：

- 前端：`http://localhost:3000`
- 后端 API：`http://localhost:3001/api`

也可以分开启动：

```bash
pnpm run dev:frontend
pnpm run dev:server
```

### 4. 类型检查

```bash
pnpm run check
```

## GitHub Pages 部署

仓库已经内置 GitHub Pages 专用构建和工作流：

- Pages 构建命令：`npm run build:pages`
- 工作流文件：`.github/workflows/deploy-pages.yml`
- 构建输出目录：`dist/public`

Pages 构建会自动做这些事情：

- 为仓库子路径设置正确的 `base`
- 注入 `__GITHUB_PAGES__` 构建标记
- 禁用仅开发期使用的 Manus debug collector
- 隐藏或禁用需要服务端的高级模式入口

也就是说：

- GitHub Pages 只提供纯静态演示版
- 本地 `pnpm run dev:frontend` 和 `pnpm run dev:advanced` 的行为不变
- 普通 `pnpm run build` 的服务端产物不变

如果要启用 Pages 部署，请确保仓库的 GitHub Pages 来源使用 GitHub Actions，然后推送到 `main` 分支即可触发 `.github/workflows/deploy-pages.yml`。

## 本地运行数据

运行过程中会在 `data/` 下生成本地状态和产物，例如：

- `data/database.json`
- `data/agents/*/sessions/`
- `data/agents/*/memory/`
- `data/agents/*/reports/`

这些文件属于运行期数据，不属于源码本身。

## 主要脚本

- `pnpm run dev:frontend`：只启动前端预览
- `pnpm run dev:server`：只启动服务端
- `pnpm run dev:advanced`：同时启动前端与服务端
- `pnpm run build`：构建正常生产版本和服务端产物
- `npm run build:pages`：构建 GitHub Pages 静态产物
- `pnpm run check`：TypeScript 类型检查

## 主要 API

- `POST /api/workflows`：启动新工作流
- `GET /api/workflows`：获取工作流列表
- `GET /api/workflows/:id`：获取工作流详情
- `GET /api/agents`：获取全部 Agent
- `GET /api/agents/:id/memory/recent`：获取最近记忆
- `GET /api/agents/:id/memory/search`：搜索历史记忆
- `GET /api/config/ai`：查看当前 AI 配置来源与运行参数
- `POST /api/chat`：统一的服务端聊天入口

## 当前边界

当前仓库是“可运行原型”，不是最终产品形态。已知边界包括：

- 一些历史文档和实验性实现仍在整理
- 长期记忆与演化机制仍有继续产品化空间
- GitHub Pages 版本是静态演示版，不提供真实服务端执行

## Roadmap

更细的阶段规划与完成状态见 [ROADMAP.md](./ROADMAP.md)。

## License

MIT
