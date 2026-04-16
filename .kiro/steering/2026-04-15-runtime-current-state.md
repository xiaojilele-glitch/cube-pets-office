---
inclusion: manual
---

# 2026-04-15 当前运行时补充

这份文档用于补充 2026-04-15 之后的当前真实运行时状态，不替代旧的 README、ROADMAP 与 steering 历史文档。

## 核心结论

当前仓库必须按 3 类环境理解：

| 环境                       | 前端 | 服务端 | Executor | 实际行为                                   |
| -------------------------- | ---- | ------ | -------- | ------------------------------------------ |
| Local + Docker reachable   | 有   | 有     | `real`   | `DockerRunner` 真容器执行                  |
| Local + Docker unavailable | 有   | 有     | `native` | `NativeRunner` 宿主进程执行                |
| GitHub Pages               | 有   | 无     | 无       | Browser Runtime + IndexedDB + preview/demo |

## 关键边界

### 1. 本地无 Docker 不再直接启动失败

- `scripts/dev-all.mjs` 会先探测 Docker
- 如果显式指定 `LOBSTER_EXECUTION_MODE=mock` 或 `native`，会保留用户选择
- 如果默认请求 `real` 但 Docker 不可用，会回退到 `native`

### 2. Executor 当前是三模式

- `real`
  - `DockerRunner`
- `native`
  - `NativeRunner`
- `mock`
  - `MockRunner`

### 3. GitHub Pages 不属于 executor 模式

- GitHub Pages 没有本地服务端
- GitHub Pages 没有本地 executor
- GitHub Pages 不是 `native`
- Pages 下只应被描述为 Frontend Runtime / Browser Runtime

## 与当前代码对应的落点

- `scripts/dev-all.mjs`
  - 本地启动时的 Docker 探测与 `native` 回退
- `services/lobster-executor/src/index.ts`
  - `real` 请求在 Docker 不可用时切换为 `native`
- `services/lobster-executor/src/runner.ts`
  - `DockerRunner` / `NativeRunner` / `MockRunner` 分发
- `client/src/lib/deploy-target.ts`
  - GitHub Pages 下禁用 Advanced Runtime
- `client/src/lib/store.ts`
  - Pages / frontend-only 时强制 `frontend` runtime
- `client/src/lib/api-client.ts`
  - API 不可用时退化到 preview/demo 行为
- `client/src/runtime/browser-runtime.ts`
  - Browser Runtime 执行链路

## 当前产品表面

- `/`
  - 办公室主壳，承接 `OfficeTaskCockpit`、`Scene3D`、统一发起区与共享任务操作
- `/tasks`
  - 全屏任务工作台与深链详情页
- Executor
  - 与 Mission / Workflow 桥接，负责真实执行、日志、工件与事件回传

## 相关归档

- `.kiro/specs/sandbox-native-executor-compat/`
  - 归档了本地 `native` 兼容层、启动回退策略与 Pages 边界

## 配套图示

- `docs/architecture-runtime-2026-04-15.svg`
