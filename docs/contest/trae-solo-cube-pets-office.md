# 🐾 Cube Pets Office｜Trae Solo 网页版傻瓜式部署&体验指南（参赛版）

项目开源：<https://github.com/opencroc/cube-pets-office>  
在线演示（GitHub Pages）：<https://opencroc.github.io/cube-pets-office/>

这份文档面向三类读者：小白体验、开发者部署、评委快速验收。你只需要跟着“最短路径”做完，就能在 Trae Solo 网页版里跑起 **3D 办公室 + Multi-Agent 工作流 + 执行器**。

---

## 你能体验到什么

- **3D 办公室可视化**：智能体在场景中“分工协作”，任务流转可视化展示。
- **多智能体工作流**：从目标理解 → 计划拆解 → 并行执行 → 评分审计 → 复盘自进化。
- **真实执行闭环（重要）**：Trae Solo 沙盒环境无法安装 Docker，但本项目可以在检测不到 Docker 时走 **native 执行**（不依赖 docker.sock），仍能产生日志与产物文件。

> 说明：要让智能体真正生成内容、真实执行，需要配置模型 API Key（下文有傻瓜式填写方式）。不建议把 Key 写进仓库并提交。

---

## 路线 A：30 秒“点开就玩”（适合评委/围观）

1. 打开在线演示：<https://opencroc.github.io/cube-pets-office/>
2. 直接浏览 3D 场景与内置演示数据。
3. 如果页面提示需要 Key：跳转到“路线 B”，在 Trae Solo 里用你自己的 Key 跑完整模式。

这条路线用于快速感知玩法与 UI；真正“让智能体干活/跑执行器”建议走路线 B。

---

## 路线 B：Trae Solo 网页版完整部署（推荐）

### 0）准备：你需要的东西

- 一个可用的 **LLM API Key**（OpenAI / 兼容 OpenAI 的第三方 / 其他 provider 都可以）
- 对应的 **Base URL**（如果你用第三方/代理）

### 1）把项目放进 Trae Solo 网页版

在 Trae Solo 网页版中新建项目 / 打开仓库：

- 选择“从 Git 仓库导入”
- 填入仓库地址：`https://github.com/opencroc/cube-pets-office`
- 等待拉取完成

### 2）配置 .env（只改 3 行即可跑通）

在项目根目录复制 `.env.example` → `.env`（Trae 网页版一般支持文件复制/新建；不行就新建一个 `.env` 并把下面 3 行贴进去）。

最小可用配置：

```bash
LLM_API_KEY=你的_key
LLM_BASE_URL=https://api.openai.com/v1
EXECUTOR_CALLBACK_SECRET=随便填一个长一点的随机字符串
```

可选配置（你想指定模型时再填）：

```bash
LLM_MODEL=gpt-5.4
```

安全提示：

- 不要把 `.env` 提交到 GitHub
- 不要在公开文档里贴 Key

### 3）安装依赖

在 Trae Solo 的终端里执行：

```bash
npm install
```

### 4）一键启动（all 模式：前端+后端+执行器）

```bash
npm run dev:all
```

启动成功后你会看到类似日志：

- Server：`Server running on http://localhost:3001/`
- Client：`Local: http://localhost:3000/`
- Executor：`listening on http://0.0.0.0:3031`

### 5）打开页面

在 Trae Solo 的预览里打开：

- UI：`http://localhost:3000/`

如果你看到类似提示：

> Preview mode / This page is not live and cannot be shared directly

这是 Trae 的“预览模式横幅”，表示链接不是公网可分享地址，不影响使用。

---

## 一键自检（确认 3 个服务都正常）

在终端依次访问：

```bash
curl -sS http://localhost:3001/api/health
curl -sS http://localhost:3031/health
```

期望结果：

- `3001` 返回 `status: ok`
- `3031` 返回 `ok: true`，并且如果沙盒无 Docker，通常会看到 `dockerLifecycle: false`（表示走 native fallback）

---

## 如何“让它真干活”（最短体验）

在 UI 里输入一个业务问题，比如：

> “制定本季度用户增长策略”

你将看到：

- 3D 场景里任务开始流转
- 任务被拆解并分配给不同角色
- 执行日志与产物在任务面板可查看（截图/日志/报告等，取决于任务类型）

---

## 关于 Trae Solo 无 Docker：为什么还能“真实执行”

核心事实：

- Trae Solo 网页版沙盒通常 **没有 Docker daemon**，也无法安装 docker.sock
- 传统“容器执行”不可用

本项目的应对策略：

- 仍以 `LOBSTER_EXECUTION_MODE=real` 跑完整链路
- 执行器在启动时探测 Docker，不可用时自动切换为 **native 本机执行**（spawn 子进程在沙盒里直接跑），并通过回调把事件/日志/产物送回 server

你可以在执行器健康检查里看到它的“实际能力”：

- `http://localhost:3031/health` → `features.dockerLifecycle`

---

## 常见问题（傻瓜排障）

### 1）访问不了 http://localhost:3000/

按顺序检查：

1. 先确认你执行过：`npm run dev:all`
2. 看终端日志里是否出现 `VITE ... ready` 和 `Server running on http://localhost:3001/`
3. 再跑自检命令：

```bash
curl -sS http://localhost:3001/api/health
```

如果 3001 也不通，说明 server 没起来，回到 `npm run dev:all` 的日志找错误（最常见是依赖没装完）。

### 2）提示需要 Key / 任务无法产出内容

检查 `.env`：

- `LLM_API_KEY` 是否已填写
- `LLM_BASE_URL` 是否正确（如果你用第三方/代理）

改完 `.env` 后通常需要重启：

```bash
npm run dev:stop
npm run dev:all
```

### 3）执行器提示 Docker 不可用

这在 Trae Solo 沙盒里是正常现象。只要：

- executor 能启动
- `3031/health` 正常

就会自动走 native fallback，不影响继续体验。

---

## 评委快速验收清单（2 分钟）

1. 打开：`http://localhost:3000/`
2. 输入一句任务（如“制定本季度用户增长策略”）
3. 看到 3D 场景开始工作流转
4. 终端确认：
   - `http://localhost:3001/api/health` 返回 ok
   - `http://localhost:3031/health` 返回 ok
5. 在任务详情中能看到执行过程的日志/产物（至少能看到任务状态推进）

