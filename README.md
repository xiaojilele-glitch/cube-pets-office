<p align="center">
  <img src="./banner.png" alt="Cube Pets Office banner" width="100%" />
</p>

<h1 align="center">Cube Pets Office</h1>

<p align="center">
  把一条自然语言指令编排成一套动态组织，在 3D 办公室里可视化展示 CEO / Manager / Worker 协作过程的多智能体原型。
</p>

<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-active%20prototype-0ea5e9" />
  <img alt="org" src="https://img.shields.io/badge/org-dynamic-f97316" />
  <img alt="ui" src="https://img.shields.io/badge/ui-zh%2Fen%20%2B%20mobile-22c55e" />
  <img alt="scene" src="https://img.shields.io/badge/scene-three.js%20office-8b5cf6" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-111827" />
</p>

<p align="center">
  <a href="https://opencroc.github.io/cube-pets-office/"><strong>Live Demo</strong></a>
  ·
  <a href="https://github.com/opencroc/cube-pets-office"><strong>GitHub</strong></a>
</p>

## 项目概览

Cube Pets Office 是一个把动态组织生成、工作流编排、3D 场景可视化和聊天交互放在同一界面的实验性产品原型。

现在这版主线已经从“固定 18 个 Agent 编制”升级成“按用户问题动态组队”：

- 用户输入问题后，系统会先分析任务，再动态生成组织结构
- 每个节点会附带职责、skills、MCP 和模型配置
- 前端会同步展示组织、阶段、消息流和 3D 场景中的角色分布
- 首页场景已弱化固定部门感，改成可重组的临时作战区 / Pod 语气
- 加载页已升级为像素风宠物头像 + 毛玻璃进度卡

## 当前能力

- 动态组织生成：不再写死固定 18 角色，按任务临时生成 CEO / manager / worker 结构
- Skills / MCP 装配：节点可随组织一起进入执行链路
- 双运行模式：支持浏览器前端预演模式和服务端高级执行模式
- GitHub Pages 演示：提供纯静态体验入口，右上角展示仓库链接
- 中英文切换：默认中文，支持持久化保存
- 移动端适配：首页、工具栏、工作流面板、配置与聊天都已适配手机布局
- Three.js 场景：动态组织与 3D 办公室联动，区域标签与家具已改造成临时 Pod 风格

## 运行模式

### 1. Frontend Mode

默认模式，适合本地体验和静态演示：

- 不依赖服务端即可进入界面
- 适合看 3D 场景、动态组织展示和界面交互
- GitHub Pages 也走这条纯前端预演链路

### 2. Advanced Mode

完整执行链路模式：

- 连接 `/api` 与 Socket.IO
- 由服务端生成组织、装配 skills / MCP，并推进真实 workflow
- 需要 `.env` 中的模型配置

## 技术栈

- 前端：React 19、Vite、TypeScript、Zustand
- 3D：Three.js、React Three Fiber、Drei
- 后端：Express、Socket.IO、TypeScript
- AI 接入：OpenAI 兼容接口
- 本地存储：JSON 数据文件

## 项目结构

```text
client/   前端应用、3D 场景、工作流面板、聊天面板
server/   API、Socket、Workflow Engine、Agent Registry、动态组织生成
shared/   共享类型与工具
data/     本地运行期数据和 Agent 产物
scripts/  启动、停止、构建辅助脚本
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动前端预演模式

```bash
npm run dev:frontend
```

默认地址：

- 前端：`http://localhost:3000`

### 3. 启动完整高级模式

先复制环境变量模板：

```bash
cp .env.example .env
```

然后在 `.env` 中填入模型配置，例如：

```dotenv
PORT=3001
NODE_ENV=development

LLM_API_KEY=your_api_key_here
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-5.4
LLM_WIRE_API=responses
LLM_REASONING_EFFORT=high
LLM_TIMEOUT_MS=45000
MAX_CONCURRENT=9999
```

启动完整链路：

```bash
npm run dev:all
```

默认地址：

- 前端：`http://localhost:3000`
- 后端 API：`http://localhost:3001/api`

也可以分开启动：

```bash
npm run dev:frontend
npm run dev:server
```

### 4. 停止本地联调进程

```bash
npm run dev:stop
```

### 5. 类型检查

```bash
npm run check
```

## GitHub Pages 部署

仓库内置了 GitHub Pages 专用构建和工作流：

- Pages 构建命令：`npm run build:pages`
- 工作流文件：`.github/workflows/deploy-pages.yml`
- 构建输出目录：`dist/public`

Pages 版本特性：

- 使用仓库子路径正确设置 `base`
- 强制停留在前端预演模式
- 不连接服务端，不执行真实高级 workflow
- 右上角展示 GitHub 仓库入口，方便访问和点 Star

## 主要脚本

- `npm run dev:frontend`：只启动前端预演
- `npm run dev:server`：只启动服务端
- `npm run dev:all`：同时启动前端与服务端
- `npm run dev:stop`：停止项目相关本地开发进程
- `npm run build`：构建正常生产版本和服务端产物
- `npm run build:pages`：构建 GitHub Pages 静态产物
- `npm run check`：TypeScript 类型检查

## 主要 API

- `POST /api/workflows`：启动新工作流
- `GET /api/workflows`：获取工作流列表
- `GET /api/workflows/:id`：获取工作流详情
- `GET /api/agents`：获取当前 Agent / 节点信息
- `GET /api/config/ai`：查看当前 AI 配置来源与运行参数
- `POST /api/chat`：统一的服务端聊天入口

## 当前边界

- GitHub Pages 版本仍是静态演示版，不提供真实服务端执行
- 一些历史文档仍保留旧的“固定 18 Agent / 论文展示”叙事，正在逐步清理
- 动态组织已经跑通，但更细的自主演化和长期记忆产品化仍有继续打磨空间

## Roadmap

更细的阶段规划与最新完成状态见 [ROADMAP.md](./ROADMAP.md)。

## License

MIT

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=opencroc/cube-pets-office&type=Date)](https://star-history.com/#opencroc/cube-pets-office&Date)
