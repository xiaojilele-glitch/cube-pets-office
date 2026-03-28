<p align="center">
  <img src="./banner.png" alt="Cube Pets Office banner" width="100%" />
</p>

<h1 align="center">Cube Pets Office</h1>

<p align="center">
  把一条自然语言指令编排成动态组织，并进一步落地为 mission 任务、Docker 执行、Feishu 回传和 3D 任务宇宙可视化的多智能体控制台。
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

## 2026-03-28 更新

- 图片附件 OCR 已切换为独立浏览器 worker，初始化 warning 已做降噪处理
- OCR 增加超时与空文本降级，识别失败时会回退为 metadata only，不再阻塞附件上传
- 前端静态预览已补齐 favicon，减少本地开发与静态部署下的控制台噪音
- 工作流页已改成“总览优先、摘要次之、详情按需展开”的三级信息密度，默认只看当前阶段、总体进度、活跃角色和阻塞状态
- 角色执行视图已从明细堆叠改为按部门汇总的一行摘要，完整交付、反馈、附件和消息记录默认折叠
- 3D 办公室墙面继续做减法：移除了左墙背景板与多余背墙装饰，墙灯和公告板也同步简化，整体更清爽

## 2026-03-29 更新

- mission 主线已收口到 `main`：`shared/mission/**`、`shared/executor/**`、任务路由、Feishu bridge、lobster executor、brain dispatch 和 `/tasks` 页面已合并
- 前端任务页已正式挂到 `/tasks` 与 `/tasks/:taskId`，与现有 workflow 视图并存
- 服务端入口已接入 mission / executor / Feishu 集成路由，同时保留原有 workflow / chat / agent 主链
- `.env.example`、README 与 smoke 脚本已补齐，便于本地和服务器做闭环验证

## 当前能力

- 动态组织生成：不再写死固定 18 角色，按任务临时生成 CEO / manager / worker 结构
- Skills / MCP 装配：节点可随组织一起进入执行链路
- 双运行模式：支持浏览器前端预演模式和服务端高级执行模式
- Mission 控制平面：支持任务列表、任务详情、决策恢复、executor 回调和 Feishu relay / webhook 入口
- 附件输入工作流：支持“文字 + 附件”一起发布指令，附件会进入工作流输入上下文
- 附件全文导入：文本、PDF、Word、Excel、图片 OCR 解析后会以全文导入工作流，界面仅显示预览摘要
- GitHub Pages 演示：提供纯静态体验入口，右上角展示仓库链接
- 中英文切换：默认中文，支持持久化保存
- 移动端适配：首页、工具栏、工作流面板、配置与聊天都已适配手机布局
- 工作流进度摘要：默认聚焦总进度、活跃角色、关键事件与阻塞信息，详细任务和消息按需展开
- Three.js 场景：动态组织与 3D 办公室联动，区域标签与家具已改造成临时 Pod 风格
- 场景减法优化：墙面背景板、装饰挂件和公告板密度已收敛，减少视觉干扰

## 附件输入

- 支持同时输入战略指令文本和附件文件，而不是只能输入文字
- 当前支持的附件类型：`txt / md / json / csv / pdf / docx / xlsx / xls / png / jpg / jpeg / webp / bmp / gif`
- 浏览器端会先尝试解析附件内容，再把解析结果连同文件元数据一起送入 workflow
- 工作流使用的是附件全文内容，面板里的附件卡片只展示预览，不会把整份文件直接铺在 UI 上
- 若文件暂时无法解析，系统会保留文件名、类型、大小和失败说明，至少让组织知道有这个参考文件
- 图片 OCR 现在使用独立 worker、自动旋转、超时保护与降级回退，弱网或弱机器下也尽量避免卡住上传流程

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
- 补齐 favicon 等静态资源细节，减少浏览器默认 404 请求与无关控制台噪音

## 主要脚本

- `npm run dev:frontend`：只启动前端预演
- `npm run dev:server`：只启动服务端
- `npm run dev:all`：同时启动前端与服务端
- `npm run dev:stop`：停止项目相关本地开发进程
- `npm run build`：构建正常生产版本和服务端产物
- `npm run build:pages`：构建 GitHub Pages 静态产物
- `npm run check`：TypeScript 类型检查
- `node scripts/mission-integration-smoke.mjs`：启动 fake Feishu API + mission server + lobster executor，验证 relay ACK / progress / done / failed、executor 回调回放、`/api/tasks` 与 mission Socket 闭环
- `node scripts/mission-restart-smoke.mjs`：验证 mission 快照在服务重启后的失败恢复路径

## 主要 API

- `POST /api/workflows`：启动新工作流
- `GET /api/workflows`：获取工作流列表
- `GET /api/workflows/:id`：获取工作流详情
- `GET /api/agents`：获取当前 Agent / 节点信息
- `GET /api/config/ai`：查看当前 AI 配置来源与运行参数
- `POST /api/chat`：统一的服务端聊天入口
- `GET /api/tasks`：获取 mission / tasks 列表
- `GET /api/tasks/:id`：获取 mission 详情
- `POST /api/tasks/:id/decision`：提交 mission 决策
- `POST /api/feishu/relay`：接入 OpenClaw relay，请求复杂任务时先 ACK，再进入 staged progress
- `POST /api/feishu/relay/event`：手动推送 relay progress / waiting / done / failed / decision
- `POST /api/feishu/webhook`：接入飞书 webhook / 卡片回调
- `POST /api/executor/events`：接收 lobster executor 回调事件并写回 mission runtime

## Mission 集成

- 前端任务页已挂到 `/tasks` 和 `/tasks/:taskId`，高级模式下会与现有 workflow 视图并存。
- 服务端同时保留原有 workflow Socket 事件与新 `mission_event`，不会替换旧的 `agent_event`。
- executor 回调默认走 HMAC-SHA256：服务端校验 `x-cube-executor-timestamp` 与 `x-cube-executor-signature`，签名串格式为 `timestamp.rawBody`。
- smoke only 路由默认关闭；只有设置 `MISSION_SMOKE_ENABLED=true` 时，`/api/tasks/smoke/dispatch` 和 `/api/tasks/smoke/seed-running` 才会暴露。

### 关键环境变量

- mission / smoke：`MISSION_SMOKE_ENABLED`、`MISSION_SMOKE_SERVER_PORT`、`MISSION_SMOKE_EXECUTOR_PORT`、`MISSION_SMOKE_FEISHU_PORT`、`MISSION_RESTART_SMOKE_PORT`
- executor callback：`EXECUTOR_CALLBACK_SECRET`、`EXECUTOR_CALLBACK_MAX_SKEW_SECONDS`
- lobster executor：`LOBSTER_EXECUTOR_BASE_URL`、`LOBSTER_EXECUTOR_HOST`、`LOBSTER_EXECUTOR_PORT`、`LOBSTER_EXECUTOR_DATA_ROOT`、`LOBSTER_EXECUTOR_NAME`
- Feishu bridge：`FEISHU_ENABLED`、`FEISHU_MODE`、`FEISHU_BASE_TASK_URL`、`FEISHU_PROGRESS_THROTTLE_PERCENT`、`FEISHU_RELAY_SECRET`、`FEISHU_RELAY_MAX_SKEW_SECONDS`、`FEISHU_RELAY_NONCE_TTL_SECONDS`
- Feishu webhook / delivery：`FEISHU_WEBHOOK_VERIFICATION_TOKEN`、`FEISHU_WEBHOOK_ENCRYPT_KEY`、`FEISHU_WEBHOOK_MAX_SKEW_SECONDS`、`FEISHU_WEBHOOK_DEDUP_TTL_SECONDS`、`FEISHU_WEBHOOK_DEDUP_FILE`、`FEISHU_MESSAGE_FORMAT`、`FEISHU_FINAL_SUMMARY_MODE`、`FEISHU_DELIVERY_MAX_RETRIES`、`FEISHU_DELIVERY_RETRY_BASE_MS`、`FEISHU_DELIVERY_RETRY_MAX_MS`、`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_TENANT_ACCESS_TOKEN`、`FEISHU_API_BASE_URL`

### Smoke 验证

- 本地总集成 smoke：`node scripts/mission-integration-smoke.mjs`
- 服务器总集成 smoke：在目标机器上运行同一条命令；脚本会默认自行拉起 fake Feishu、Cube server 和 lobster executor
- 若目标机已经有 server / executor 进程，也可以配合 `MISSION_SMOKE_NO_SPAWN_SERVER=1`、`MISSION_SMOKE_NO_SPAWN_EXECUTOR=1` 复用现有进程，但现有服务需要已经按 smoke 所需环境变量完成配置
- 服务重启恢复 smoke：`node scripts/mission-restart-smoke.mjs`

## 当前边界

- GitHub Pages 版本仍是静态演示版，不提供真实服务端执行
- 一些历史文档仍保留旧的“固定 18 Agent / 论文展示”叙事，正在逐步清理
- 动态组织已经跑通，但更细的自主演化和长期记忆产品化仍有继续打磨空间
- 超大附件目前仍走浏览器端解析，虽然已经支持全文导入，但极大 PDF / OCR 图片在弱机器上仍可能更慢

## Roadmap

更细的阶段规划与最新完成状态见 [ROADMAP.md](./ROADMAP.md)。

## License

MIT

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=opencroc/cube-pets-office&type=Date)](https://star-history.com/#opencroc/cube-pets-office&Date)
