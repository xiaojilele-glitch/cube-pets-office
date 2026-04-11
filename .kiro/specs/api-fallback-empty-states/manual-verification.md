# API Fallback Empty States - 手动验收清单

更新日期：2026-04-11

## 目标

验证以下两类体验在真实运行中可被用户理解，并且不会暴露技术细节：

- 演示 / 预览模式文案
- 后端不可达、HTML fallback、非 JSON 返回时的错误态与 retry 入口

## 准备

### 1. 前端预览模式

运行：

```powershell
npm run dev:frontend
```

预期：

- 页面可打开
- 默认处于前端预览 / 演示路径
- 不依赖后端也能看到说明性文案，而不是白屏或解析错误

### 2. 前后端联调模式

运行：

```powershell
npm run dev:all
```

如需制造“后端不可达”场景，可先启动页面后再执行：

```powershell
npm run dev:stop
```

或仅关闭后端进程，保留前端页面。

## 验收场景

### 场景 A：ChatPanel 在后端不可达时不暴露解析错误

步骤：

1. 打开聊天面板
2. 切换到需要走服务端 `/api/chat` 的模式
3. 在后端不可达时发送一条消息

预期：

- 回复区域显示“连接出现问题”或等价的人类可读文案
- 不出现 `Unexpected token '<'`、`JSON.parse`、`<!doctype html>` 等技术细节
- 文案提示检查配置或稍后重试

### 场景 B：WorkflowPanel 指令提交失败时保留输入并可重试

步骤：

1. 打开 WorkflowPanel
2. 输入 directive，可附带 1 个附件
3. 保持 Advanced 模式，但让后端不可达
4. 点击提交

预期：

- 面板顶部出现结构化错误提示条
- 若错误可恢复，出现 retry 按钮
- 输入框内容和附件列表仍然保留
- 不出现浏览器原始解析错误

### 场景 C：WorkflowPanel 的高频子视图可区分“演示 / 离线 / 错误”

覆盖视图：

- `Org`
- `Workflow`
- `Memory`
- `Reports`
- `History`

步骤：

1. 进入 Advanced 模式
2. 让后端返回不可用或 fallback 页面
3. 逐个切换以上 tab

预期：

- 每个视图在失败时显示统一风格的错误提示条
- 提示条包含“发生了什么”和“下一步建议”
- 对可恢复请求显示 retry
- 如果本地缓存存在，可优先展示缓存快照，不应只剩空白

### 场景 D：任务页错误态提供就地刷新

覆盖页面：

- `/tasks`
- `/tasks/:id`

步骤：

1. 进入任务页
2. 让任务相关接口不可达或返回 HTML fallback

预期：

- 页面显示错误提示，而不是原始异常文本
- 可直接点击刷新 / retry，不需要整页手动刷新浏览器
- 若任务数据为空，应保持空态解释，不是空白容器

### 场景 E：前端预览模式文案明确说明不是实时执行

步骤：

1. 仅运行 `npm run dev:frontend`
2. 打开 WorkflowPanel 与 ChatPanel

预期：

- WorkflowPanel 显示“浏览器预览 / 演示模式”的解释性文案
- ChatPanel 初始空态说明当前是预览层或本地页面模式
- 文案能区分“可浏览演示”与“真实后端执行”

### 场景 F：旧问题回归检查

重点检查以下页面和组件在失败时不再出现技术报错：

- ChatPanel
- WorkflowPanel
- TasksPage
- TaskDetailPage
- LineagePage
- AuditPanel
- PermissionPanel
- ReputationHistory
- TelemetryDashboard
- CostDashboard

预期：

- 不出现 `Unexpected token '<'`
- 不出现 `Failed to fetch` 直接裸露给最终用户
- 空态与错误态都有解释性文案

## 建议记录方式

建议对每个场景记录：

- 触发方式
- 实际文案截图
- 是否出现 retry
- 是否仍暴露技术细节
- 是否符合“demo / offline / error”区分

## 完成标准

当以下条件同时满足时，可认为本 spec 的手动验收通过：

- ChatPanel、WorkflowPanel、任务页都能稳定显示结构化错误文案
- 至少一条可恢复路径验证了 retry 可用
- 前端预览模式下能看到演示说明文案
- 全程未再出现 `Unexpected token '<'` 一类原始 parse 错误
