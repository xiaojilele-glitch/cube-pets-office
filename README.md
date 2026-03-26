# Cube Pets Office

一个把“单条自然语言指令”编排成多智能体协作流程的 3D 可视化项目。

项目目前已经从最初的展示型页面，演进成一个可运行的多智能体编排系统：
- 前端用 3D 办公室场景展示 18 个智能体的实时状态
- 后端支持 10 阶段 workflow、WebSocket 事件推送、Agent 记忆与评审闭环
- AI 配置统一以 `.env` 为唯一真源，聊天面板和 workflow 使用同一套服务端配置

## 当前状态

当前仓库已经实现的核心能力：
- 18 个智能体注册、分部门组织，并在 3D 场景中完整布局
- 10 阶段工作流：`direction -> planning -> execution -> review -> meta_audit -> revision -> verify -> summary -> feedback -> evolution`
- 实时消息流粒子动画、Agent 状态动画、Workflow 面板
- Agent 短期记忆注入、历史摘要检索、`soul_md` 自动演化
- 聊天面板与 workflow 统一走服务端 API
- `.env` 统一驱动模型、Base URL、API Key、推理参数

当前还没有完成，README 这里也明确保留：
- 严格的文件系统隔离还未落地，当前更接近“约定式隔离”
- 中期记忆不是向量检索，当前是摘要 + 关键词检索
- `SOUL.md` 的长期记忆演化目前落在数据库 `soul_md` 字段，不是文件版自动更新
- heartbeat / 自主搜索 / 定时报告机制尚未实现

## 技术栈

- Frontend: React 19, Vite, TypeScript, Zustand, Three.js, React Three Fiber, Drei
- Backend: Express, Socket.IO, TypeScript
- AI: OpenAI-compatible API, `.env` driven config
- Storage: local JSON database + agent workspace files

## 主要界面

- `3D Scene`: 18 个智能体、部门分区、消息流动线、状态气泡
- `Workflow Panel`: 指令、组织、进度、评审、记忆、历史多视图
- `Chat Panel`: 选中任意 Agent 后，以当前角色身份对话

## 后端能力

- `POST /api/workflows`: 启动一条新的多智能体工作流
- `GET /api/workflows`: 查看历史工作流
- `GET /api/workflows/:id`: 查看某条工作流的任务与消息
- `GET /api/agents`: 查看全部 Agent
- `GET /api/agents/:id/memory/recent`: 查看最近记忆
- `GET /api/agents/:id/memory/search`: 搜索历史摘要
- `GET /api/config/ai`: 查看当前 AI 配置来源与运行参数
- `POST /api/chat`: 统一的服务端聊天代理接口

## 本地启动

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

基于 `.env.example` 创建本地 `.env`，填入你自己的模型服务配置：

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

前端开发服务器默认跑在 `3000`，并通过 Vite 代理把 `/api` 和 `/socket.io` 转发到 `3001`。

### 3. 同时启动前后端

```bash
npm run dev:all
```

默认访问：
- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:3001/api`

也可以分别启动：

```bash
npm run dev
npm run dev:server
```

### 4. 类型检查

```bash
npm run check
```

## 生产构建

```bash
npm run build
```

构建后服务端入口位于 `dist/index.js`，静态资源位于 `dist/public/`。

## 项目结构

```text
client/   React 前端、3D 场景、聊天面板、工作流面板
server/   Express API、Workflow Engine、Agent Registry、Memory、Socket
shared/   共享类型与工具
data/     本地数据库与 Agent runtime 工作空间（运行时产物）
scripts/  开发辅助脚本
```

## 运行时数据说明

仓库运行后会在 `data/` 下生成本地状态：
- `data/database.json`
- `data/agents/*/sessions/`
- `data/agents/*/memory/`
- `data/agents/*/reports/`

这些文件属于本地 runtime 数据，不属于源码的一部分。仓库已按公开仓库的方式忽略这些产物。

## 开源说明

- License: MIT
- 欢迎基于这个仓库继续扩展更严格的多智能体隔离、向量记忆、heartbeat、自进化闭环等能力

## Roadmap

更细的阶段规划和“当前代码已完成 / 未完成”的拆分，见 `ROADMAP.md`。
