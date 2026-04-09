# 需求文档：工作流产物展示与下载

## 简介

Docker 执行器（Lobster Executor）执行任务后，产出的 artifacts（代码文件、执行日志、结果 JSON、MD 报告等）存储在服务端本地 `tmp/lobster-executor/jobs/` 目录中。执行器回调已通过 `artifacts` 字段将产物元信息（kind, name, path, description）写入 MissionRecord，但前端页面缺少对应的展示和下载入口。本功能为服务端提供 REST API 查询与下载能力，并在 WorkflowPanel 进度视图和 TaskDetailView 任务驾驶舱中增加 artifacts 展示区域，同时通过 Socket.IO 实现产物列表的实时推送更新。

## 术语表

- **Artifact_Service**：服务端负责查询和提供 artifact 文件下载的 REST API 模块
- **Artifact_Panel**：前端用于展示和下载 artifacts 的 UI 组件区域
- **WorkflowPanel**：前端工作流进度面板组件（`client/src/components/WorkflowPanel.tsx`）
- **TaskDetailView**：前端任务驾驶舱详情组件（`client/src/components/tasks/TaskDetailView.tsx`）
- **MissionRecord**：服务端 Mission 数据记录，包含 `artifacts: MissionArtifact[]` 字段
- **MissionArtifact**：产物元信息结构，包含 kind（file/report/url/log）、name、path、url、description
- **Executor_Callback**：Docker 执行器通过 HMAC 签名向 `/api/executor/events` 发送的回调事件
- **Socket_Broadcast**：服务端通过 Socket.IO 向前端推送的实时事件

## 需求

### 需求 1：Artifact 列表查询 API

**用户故事：** 作为前端开发者，我希望通过 REST API 查询指定 Mission 的 artifact 列表，以便在 UI 中展示产物信息。

#### 验收标准

1. WHEN 前端发送 GET 请求到 `/api/tasks/:missionId/artifacts`，THE Artifact_Service SHALL 返回该 Mission 的 MissionArtifact 数组，包含每个产物的 kind、name、path、description 字段
2. WHEN 请求的 missionId 不存在时，THE Artifact_Service SHALL 返回 HTTP 404 状态码和描述性错误信息
3. WHEN MissionRecord 中 artifacts 字段为空数组或未定义时，THE Artifact_Service SHALL 返回空数组 `[]` 和 HTTP 200 状态码
4. THE Artifact_Service SHALL 为每个 artifact 条目附加 `downloadUrl` 字段，值为 `/api/tasks/:missionId/artifacts/:artifactIndex/download`

### 需求 2：Artifact 文件下载 API

**用户故事：** 作为用户，我希望通过 REST API 下载执行器产出的具体文件，以便查看代码产物、日志和报告。

#### 验收标准

1. WHEN 前端发送 GET 请求到 `/api/tasks/:missionId/artifacts/:index/download`，THE Artifact_Service SHALL 从本地文件系统读取对应 artifact 的文件内容并以流式响应返回
2. THE Artifact_Service SHALL 根据文件扩展名设置正确的 Content-Type 响应头（如 `.json` 对应 `application/json`，`.md` 对应 `text/markdown`，`.log` 对应 `text/plain`）
3. THE Artifact_Service SHALL 设置 `Content-Disposition` 响应头为 `attachment; filename="<artifact.name>"`，使浏览器触发文件下载
4. IF artifact 的 path 字段为空或对应文件不存在，THEN THE Artifact_Service SHALL 返回 HTTP 404 状态码和描述性错误信息
5. THE Artifact_Service SHALL 对 artifact.path 进行路径安全校验，拒绝包含 `..` 的路径遍历攻击，返回 HTTP 403 状态码
6. IF artifact 的 kind 为 `url`，THEN THE Artifact_Service SHALL 返回 HTTP 302 重定向到该 URL

### 需求 3：WorkflowPanel 产物展示区域

**用户故事：** 作为用户，我希望在工作流进度面板中看到执行器产出的 artifacts 列表和下载按钮，以便快速获取执行结果。

#### 验收标准

1. WHEN 当前工作流关联的 Mission 存在 artifacts 时，THE Artifact_Panel SHALL 在 WorkflowPanel 的进度视图区域内渲染一个产物列表区块
2. THE Artifact_Panel SHALL 为每个 artifact 显示名称（name）、类型标签（kind）和描述（description）
3. THE Artifact_Panel SHALL 为 kind 为 `file`、`report`、`log` 的 artifact 提供下载按钮，点击后调用下载 API 触发浏览器下载
4. THE Artifact_Panel SHALL 为 kind 为 `url` 的 artifact 提供外部链接按钮，点击后在新标签页打开对应 URL
5. THE Artifact_Panel SHALL 使用项目全息 UI 风格（glass-panel 容器、GlowButton 下载按钮）渲染
6. WHEN artifacts 列表为空时，THE Artifact_Panel SHALL 不渲染产物区块

### 需求 4：TaskDetailView 产物展示

**用户故事：** 作为用户，我希望在任务驾驶舱的详情视图中查看 Docker 执行器产出的 artifacts，以便在任务维度审查执行产物。

#### 验收标准

1. WHEN 选中的 Mission 存在 executor artifacts 时，THE TaskDetailView SHALL 在现有 Artifacts 面板中展示来自执行器的产物条目
2. THE TaskDetailView SHALL 对 kind 为 `log` 的 artifact（如 executor.log）提供内联预览功能，点击后在弹窗中展示日志文本内容
3. THE TaskDetailView SHALL 对 kind 为 `report` 且格式为 JSON 的 artifact（如 result.json）提供内联预览功能，点击后在弹窗中展示格式化的 JSON 内容
4. THE TaskDetailView SHALL 为每个可下载的 artifact 提供下载按钮，调用 `/api/tasks/:missionId/artifacts/:index/download` 触发下载
5. WHEN artifact 下载正在进行时，THE TaskDetailView SHALL 将对应下载按钮显示为加载状态，防止重复点击

### 需求 5：工作流最终报告下载入口

**用户故事：** 作为用户，我希望在工作流完成后能下载最终报告（MD/JSON 格式），以便归档和分享执行结果。

#### 验收标准

1. WHEN 工作流关联的 Mission 状态为 `completed` 且 artifacts 中存在 kind 为 `report` 的条目时，THE Artifact_Panel SHALL 在产物列表顶部突出显示报告类产物，使用视觉区分样式
2. THE Artifact_Panel SHALL 为报告类 artifact 同时提供"预览"和"下载"两个操作按钮
3. WHEN 用户点击报告的"预览"按钮时，THE Artifact_Panel SHALL 获取报告内容并在模态弹窗中渲染（MD 格式渲染为富文本，JSON 格式渲染为格式化代码）

### 需求 6：Artifacts 实时推送更新

**用户故事：** 作为用户，我希望在执行器产出新 artifact 时前端自动更新列表，无需手动刷新页面。

#### 验收标准

1. WHEN 服务端通过 Executor_Callback 接收到包含新 artifacts 的事件时，THE Socket_Broadcast SHALL 在 `mission_event` 事件中包含更新后的 artifacts 数组
2. WHEN 前端收到包含 artifacts 变更的 `mission_event` 时，THE Artifact_Panel SHALL 在 500 毫秒内更新产物列表显示
3. WHEN 新 artifact 被添加到列表时，THE Artifact_Panel SHALL 对新增条目应用入场动画效果，使用户注意到新产物的出现
4. WHILE Mission 处于 `running` 状态时，THE Artifact_Panel SHALL 在产物列表区域显示一个脉冲指示器，表示可能有新产物产出

### 需求 7：Artifact 内容预览 API

**用户故事：** 作为前端开发者，我希望通过 API 获取 artifact 的文本内容用于内联预览，避免强制触发浏览器下载。

#### 验收标准

1. WHEN 前端发送 GET 请求到 `/api/tasks/:missionId/artifacts/:index/preview`，THE Artifact_Service SHALL 返回 artifact 文件的文本内容，Content-Type 设置为对应的文本 MIME 类型（不设置 Content-Disposition）
2. IF artifact 文件大小超过 1MB，THEN THE Artifact_Service SHALL 返回前 1MB 内容并在响应头中附加 `X-Truncated: true` 标记
3. IF artifact 为二进制文件（非文本类型），THEN THE Artifact_Service SHALL 返回 HTTP 415 状态码和描述性错误信息
4. THE Artifact_Service SHALL 对预览请求执行与下载请求相同的路径安全校验
