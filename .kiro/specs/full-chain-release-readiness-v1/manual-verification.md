# 手工验证清单

## 启动前置

- 已准备生产环境 `.env`
- Linux 通过 FRP 映射本地 `3000`
- 已完成 `npm run build`

## 1. 首页与实时链路

- 打开 `/`
- 确认页面可加载
- 确认 `/api/health` 返回正常
- 确认 Socket.IO 建连正常
- 确认首页任务联动未断

## 2. 任务链路

- 打开 `/tasks`
- 创建 Mission
- 进入 `/tasks/:taskId`
- 验证刷新、取消、暂停、恢复、决策按钮
- 验证 Artifacts 预览与下载

## 3. 执行器链路

- 验证 dispatch 能成功发起
- 验证 callback 能回写任务状态
- 验证日志流正常
- 验证截图流正常
- 验证 Sandbox 预览正常

## 4. 页面与系统服务

- `/command-center`
- `/replay/:missionId`
- `/lineage`
- Feishu 开启时回传与卡片动作
- Feishu 关闭时启动与路由不异常
- Knowledge / RAG 基础检索
- Permission / Guest Agent / A2A 基础调用
- Telemetry / Voice / Vision / Export / Analytics / Config 基础健康检查

## 5. 生产 smoke

- 在 Linux 生产模式下使用 `PORT=3000`
- 确认 `/api/health` 返回 `status: ok`
- 确认 `/`、`/tasks`、`/command-center`、`/lineage` 可访问

## 留痕要求

- 保留命令执行结果
- 记录失败链路与阻塞点
- 若有未过项，标明是“真实阻塞”还是“外部前置条件未满足”
