# 设计说明

## 总体决策

- 不覆盖旧 `.kiro/specs/production-deployment/`
- 新建版本化总规，专门服务本轮全链路上线
- 发布门禁采用“命令矩阵 + 手测矩阵”双轨收口

## 四层收口模型

### 1. 基线层

- 统一根目录发布脚本
- 补齐跨平台生产启动入口
- 增加生产 smoke 脚本
- 显式声明 TypeScript 现代运行时基线

### 2. 前端层

- 首页、任务台、任务详情、回放、血缘页面在生产构建产物下可达
- 浏览器存储在 fake window / isolated test 环境下安全
- 前端测试改测公共行为，不依赖内部未导出实现
- 当前 UI 文案断言与实际渲染保持一致

### 3. 执行链路层

- `RuntimeMessageBus` 与真实实现收口到一致契约
- Executor callback 固定采用 `{ event }` canonical wire shape
- `cancel()` 对 queued / waiting 分支优先落本地状态，不阻塞在 callback retry
- 校验 artifacts、logs、screenshots 三条链

### 4. 系统服务层

- Feishu 仅验证现有 relay / card / route 流程
- Knowledge / RAG 仅验证已挂载路由与基础检索
- Replay / Lineage 验证采集、访问、导出
- Permission / Guest / A2A 验证基础路由和核心调用
- Telemetry / Voice / Vision / Export / Analytics / Config 验证 API 可达与基本响应

## 命令矩阵

发布门禁固定串联以下命令：

1. `npm run check`
2. `npm run build`
3. `npm run test:client`
4. `npm run test:server`
5. `npm run test:executor`
6. `npm run smoke:prod`

## 手测矩阵

手测按流程而不是按文件执行：

- 首页加载、Socket 建连、任务联动
- 任务创建、详情、操作按钮、Artifacts 预览/下载
- Executor dispatch、callback、log stream、screenshot stream
- Feishu 开启 / 关闭
- Command Center 提交、审批、调整
- Replay 查看
- Lineage 查询与导出
- Knowledge / RAG 检索
- Permission / Guest Agent / A2A 基础调用
- Telemetry / Voice / Vision / Export / Analytics / Config 健康检查

## 接口与类型收口

### `package.json`

- 新增 `test:client`
- 新增 `test:server`
- 新增 `test:executor`
- 新增 `smoke:prod`
- 新增 `test:release`

### `tsconfig.json`

- 显式设置现代 `target`
- 不依赖 `downlevelIteration`

### `shared/workflow-runtime.ts`

- `RuntimeMessageBus` 正式补齐 `sendA2A(...)`
- 浏览器运行时与服务端实现对齐

### 前端存储

- 读取 `window.localStorage` 前必须安全判空
- fake window / SSR / isolated test 场景不应抛异常

### 执行器链路

- 回调请求体统一为 `{ event }`
- `AI_WIRE_API` 视为正式注入项
- `cancel()` 不被 callback retry 拖慢返回

## 已知问题归档分类

- 实现问题
- 类型契约问题
- 测试陈旧问题
- 启动与脚本问题
