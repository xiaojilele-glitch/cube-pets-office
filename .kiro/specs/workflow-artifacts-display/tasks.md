# 实施计划：工作流产物展示与下载

## 概述

基于现有 tasks 路由和 tasks-store 架构，增量实现三个服务端 REST API 端点（列表查询、文件下载、内容预览），扩展前端 WorkflowPanel 和 TaskDetailView 的产物展示区域，并利用现有 Socket.IO `mission.record.updated` 通道实现产物列表的实时推送。实现语言为 TypeScript，前端使用 React + Zustand + Framer Motion，后端使用 Express。

## 任务

- [x] 1. 服务端共享类型与工具函数
  - [x] 1.1 在 `shared/mission/contracts.ts` 中新增 `ArtifactListItem` 和 `ArtifactListResponse` 接口
    - `ArtifactListItem` 继承 `MissionArtifact`，增加 `index: number` 和 `downloadUrl: string` 字段
    - `ArtifactListResponse` 包含 `ok: true`、`missionId: string`、`artifacts: ArtifactListItem[]`
    - _需求: 1.1, 1.4_

  - [x] 1.2 在 `server/routes/` 下创建 `artifact-utils.ts` 工具模块
    - 实现 `EXTENSION_MIME_MAP` 常量（设计文档中的 MIME 映射表）
    - 实现 `TEXT_MIME_PREFIXES` 常量用于判断文本文件
    - 实现 `getMimeType(filename: string): string` 函数，根据扩展名返回 Content-Type
    - 实现 `isTextMime(mime: string): boolean` 函数，判断是否为文本类型
    - 实现 `validateArtifactPath(artifactPath: string): boolean` 函数，拒绝包含 `..` 的路径
    - 实现 `resolveArtifactAbsolutePath(missionId: string, jobId: string, relativePath: string): string` 函数
    - _需求: 2.2, 2.5, 7.3, 7.4_

  - [x] 1.3 为 artifact-utils 编写单元测试
    - 测试 `getMimeType` 对各扩展名的映射正确性
    - 测试 `validateArtifactPath` 拒绝 `..` 路径遍历
    - 测试 `resolveArtifactAbsolutePath` 路径拼接正确性
    - 测试 `isTextMime` 对文本/二进制类型的判断
    - _需求: 2.2, 2.5_

- [x] 2. 服务端 Artifact API 端点
  - [x] 2.1 在 `server/routes/tasks.ts` 的 `createTaskRouter` 中添加 `GET /:id/artifacts` 路由
    - 从 MissionRuntime 获取 MissionRecord
    - Mission 不存在返回 404
    - artifacts 为空或未定义返回空数组 `[]` + 200
    - 为每个 artifact 附加 `index` 和 `downloadUrl` 字段
    - _需求: 1.1, 1.2, 1.3, 1.4_

  - [x] 2.2 在 `server/routes/tasks.ts` 中添加 `GET /:id/artifacts/:index/download` 路由
    - 校验 index 为有效数组索引
    - 调用 `validateArtifactPath` 进行路径安全校验，失败返回 403
    - kind 为 `url` 时返回 302 重定向
    - kind 为 `file`/`report`/`log` 时使用 `fs.createReadStream` 流式返回文件
    - 设置 `Content-Type`（通过 `getMimeType`）和 `Content-Disposition: attachment`
    - 文件不存在返回 404
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 2.3 在 `server/routes/tasks.ts` 中添加 `GET /:id/artifacts/:index/preview` 路由
    - 复用路径安全校验逻辑
    - 调用 `isTextMime` 判断是否为文本文件，非文本返回 415
    - 文件 > 1MB 时截断返回前 1MB，响应头附加 `X-Truncated: true`
    - 返回文本内容，Content-Type 设为对应文本 MIME 类型，不设置 Content-Disposition
    - _需求: 7.1, 7.2, 7.3, 7.4_

  - [x] 2.4 为三个 Artifact API 端点编写集成测试
    - 测试列表查询正常返回、404、空数组场景
    - 测试下载路由的流式响应、302 重定向、403 路径校验、404 文件不存在
    - 测试预览路由的文本返回、截断标记、415 二进制拒绝
    - _需求: 1.1–1.4, 2.1–2.6, 7.1–7.4_

- [x] 3. 检查点 — 确保服务端 API 测试通过
  - 确保所有测试通过，如有疑问请询问用户。

- [x] 4. 前端 tasks-store 扩展
  - [x] 4.1 扩展 `client/src/lib/tasks-store.ts` 中的 `TaskArtifact` 接口和 `buildMissionArtifacts` 函数
    - `TaskArtifact` 新增 `downloadUrl?: string` 和 `previewUrl?: string` 字段
    - `buildMissionArtifacts` 为每个 artifact 生成 `downloadUrl` 和 `previewUrl`
    - 根据 kind 和 path/url 设置 `downloadKind`（`"server"` 或 `"external"`）和 `href`
    - _需求: 1.4, 3.3, 3.4, 4.4_

  - [x] 4.2 为 `buildMissionArtifacts` 扩展编写单元测试
    - 验证 downloadUrl/previewUrl 生成格式正确
    - 验证 kind 为 url 时 downloadKind 为 "external"，href 为 artifact.url
    - 验证 kind 为 file 时 downloadKind 为 "server"，href 为下载 API 路径
    - _需求: 1.4, 3.3, 3.4_

- [x] 5. ArtifactListBlock 可复用组件
  - [x] 5.1 创建 `client/src/components/tasks/ArtifactListBlock.tsx`
    - 接收 `ArtifactListBlockProps`（missionId, artifacts, missionStatus, variant）
    - 渲染产物列表：每项显示 name、kind 标签、description
    - kind 为 `file`/`report`/`log` 时渲染 GlowButton 下载按钮，点击触发 `window.open(downloadUrl)`
    - kind 为 `url` 时渲染外部链接按钮，`target="_blank"` 打开
    - kind 为 `report` 且 Mission 已完成时突出显示，提供"预览"+"下载"双按钮
    - artifacts 为空时不渲染（返回 null）
    - 使用 glass-panel 容器 + GlowButton 样式
    - Mission 处于 `running` 状态时显示脉冲指示器
    - 新增 artifact 使用 Framer Motion `AnimatePresence` + `motion.div` 入场动画
    - _需求: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.1, 5.2, 6.3, 6.4_

  - [x] 5.2 为 ArtifactListBlock 编写单元测试
    - 测试空 artifacts 不渲染
    - 测试各 kind 类型渲染对应按钮
    - 测试 report 类型在 completed 状态下突出显示
    - _需求: 3.1–3.6_

- [x] 6. ArtifactPreviewDialog 模态弹窗组件
  - [x] 6.1 创建 `client/src/components/tasks/ArtifactPreviewDialog.tsx`
    - 接收 `ArtifactPreviewDialogProps`（missionId, artifactIndex, artifactName, format, open, onOpenChange）
    - 打开时调用 `GET /api/tasks/:missionId/artifacts/:index/preview` 获取内容
    - 根据 format 渲染：MD → react-markdown 富文本，JSON → 格式化代码块，log/其他 → 等宽字体文本
    - 检测响应头 `X-Truncated: true` 时显示截断提示
    - 加载中显示 loading 状态，错误时显示错误提示
    - 使用项目现有 Dialog 组件（shadcn/ui）作为容器
    - _需求: 4.2, 4.3, 5.3, 7.1, 7.2_

  - [x] 6.2 为 ArtifactPreviewDialog 编写单元测试
    - 测试 open 状态下发起 fetch 请求
    - 测试截断提示显示逻辑
    - _需求: 5.3, 7.2_

- [x] 7. 检查点 — 确保前端组件测试通过
  - 确保所有测试通过，如有疑问请询问用户。

- [x] 8. WorkflowPanel 集成 ArtifactListBlock
  - [x] 8.1 在 `client/src/components/WorkflowPanel.tsx` 的 `ProgressView` 中集成 ArtifactListBlock
    - 从 tasks-store 获取当前 Mission 的 artifacts 数据
    - 在进度视图区域底部渲染 `ArtifactListBlock`，variant 为 `"compact"`
    - 传入 missionId、artifacts、missionStatus
    - artifacts 为空时不渲染该区块
    - _需求: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 9. TaskDetailView 集成 ArtifactListBlock 和 ArtifactPreviewDialog
  - [x] 9.1 在 `client/src/components/tasks/TaskDetailView.tsx` 中集成产物展示
    - 在现有 Artifacts 面板区域使用 `ArtifactListBlock`，variant 为 `"full"`
    - 为 kind 为 `log` 和 `report`（JSON 格式）的 artifact 添加预览按钮
    - 点击预览按钮打开 `ArtifactPreviewDialog`
    - 下载按钮点击时显示加载状态，防止重复点击
    - _需求: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 10. Socket.IO 实时推送集成
  - [x] 10.1 验证并确保 tasks-store 中 `mission.record.updated` 事件处理包含 artifacts 更新
    - 确认 `patchMissionRecordInStore` 函数在接收 Socket 事件时正确更新 artifacts 字段
    - 确认 `buildMissionArtifacts` 在 MissionRecord 更新后被重新调用
    - 如需修改，确保 artifacts 变化在 500ms 内反映到 UI
    - _需求: 6.1, 6.2_

- [ ] 11. 最终检查点 — 确保所有测试通过
  - 确保所有测试通过，如有疑问请询问用户。

## 备注

- 标记 `*` 的子任务为可选，可跳过以加速 MVP 交付
- 每个任务引用了具体的需求编号，确保可追溯性
- 检查点任务用于增量验证，确保每个阶段的正确性
- 服务端 API 挂载在现有 tasks 路由下，无需新建路由文件
- 前端组件复用项目全息 UI 风格（glass-panel + GlowButton + Framer Motion）
- 实时推送复用现有 `mission.record.updated` Socket 通道，无需新增事件类型
