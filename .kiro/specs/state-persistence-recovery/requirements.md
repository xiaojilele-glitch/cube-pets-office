# 需求文档：状态持久化与恢复

## 简介

在现有服务端 Mission 快照 + IndexedDB 持久化基础上，完整实现浏览器崩溃、页面刷新、标签关闭后的长任务自动恢复，同时支持跨设备/跨浏览器会话导出与导入，让用户在纯前端模式下也能可靠运行长时间 Mission。

## 术语表

- **Snapshot（快照）**：某一时刻系统完整状态的序列化表示，包含 MissionRecord、Agent 记忆摘要、3D 布局状态、决策历史和附件索引
- **SnapshotStore**：IndexedDB 中专门存储快照的 object store
- **Recovery_Dialog（恢复对话框）**：检测到未完成快照时弹出的 UI 组件，提供 Resume 和 Discard 选项
- **Session_Bundle（会话包）**：导出时生成的 ZIP 文件，包含 snapshot.json 和关联附件
- **Checksum（校验和）**：用于验证快照数据完整性的哈希值
- **Snapshot_Version（快照版本号）**：标识快照数据结构版本的数字，用于兼容性检查
- **Browser_Runtime（浏览器运行时）**：`browser-runtime.ts` 中实现的纯前端工作流执行环境
- **Zustand_Store**：前端全局状态管理容器
- **MissionRecord**：Mission 任务的完整数据记录，定义在 `shared/mission/contracts.ts`

## 需求

### 需求 1：自动快照生成

**用户故事：** 作为用户，我希望系统在任务执行过程中自动保存状态快照，以便在意外中断后能够恢复。

#### 验收标准

1. WHILE 一个 Mission 处于 running 或 waiting 状态，THE SnapshotStore SHALL 每 30 秒自动生成一次完整快照
2. WHEN 一个 MissionStage 的状态发生变更，THE SnapshotStore SHALL 立即生成一次快照
3. THE Snapshot SHALL 包含以下数据：MissionRecord、Agent 记忆摘要、3D 场景布局状态、决策历史、附件索引
4. THE SnapshotStore SHALL 为每个快照生成 Checksum 和 Snapshot_Version
5. THE SnapshotStore SHALL 保留最近 5 个快照，自动清理更早的快照
6. THE SnapshotStore SHALL 在 IndexedDB 的独立 snapshot object store 中存储快照数据

### 需求 2：自动恢复检测与恢复

**用户故事：** 作为用户，我希望在浏览器崩溃、页面刷新或标签关闭后重新打开应用时，系统能自动检测并恢复之前的任务状态。

#### 验收标准

1. WHEN Browser_Runtime 启动时，THE Browser_Runtime SHALL 检查 SnapshotStore 中是否存在未完成的快照
2. WHEN 检测到未完成快照，THE Recovery_Dialog SHALL 显示快照的 Mission 标题、保存时间和进度信息
3. WHEN 用户点击 Resume 按钮，THE Browser_Runtime SHALL 从快照恢复 Zustand_Store、3D 场景布局和 Agent 状态
4. WHEN 用户点击 Discard 按钮，THE SnapshotStore SHALL 删除该快照并正常启动
5. IF 快照的 Checksum 校验失败，THEN THE Recovery_Dialog SHALL 提示快照已损坏并提供 Discard 选项
6. IF 快照的 Snapshot_Version 与当前版本不兼容，THEN THE Recovery_Dialog SHALL 提示版本不兼容并提供 Discard 选项

### 需求 3：会话导出

**用户故事：** 作为用户，我希望能一键导出当前会话的完整快照，以便在其他设备或浏览器上继续任务。

#### 验收标准

1. WHEN 用户点击 Export Session 按钮，THE Session_Export_Service SHALL 生成包含 snapshot.json 和附件的 Session_Bundle
2. THE Session_Bundle SHALL 使用 ZIP 格式打包
3. THE Session_Bundle SHALL 包含 Snapshot_Version 和 Checksum 用于导入时校验
4. WHEN Session_Bundle 生成完成，THE Session_Export_Service SHALL 触发浏览器文件下载

### 需求 4：会话导入

**用户故事：** 作为用户，我希望能导入之前导出的会话快照，以便在新设备或新浏览器上恢复任务。

#### 验收标准

1. WHEN 用户选择一个 Session_Bundle 文件进行导入，THE Session_Import_Service SHALL 解析 ZIP 文件并校验 Checksum
2. IF Session_Bundle 的 Checksum 校验失败，THEN THE Session_Import_Service SHALL 拒绝导入并显示错误信息
3. IF Session_Bundle 的 Snapshot_Version 与当前版本不兼容，THEN THE Session_Import_Service SHALL 拒绝导入并显示版本不兼容提示
4. WHEN Session_Bundle 校验通过，THE Session_Import_Service SHALL 将快照写入 SnapshotStore 并触发恢复流程
5. WHEN 通过 URL 参数 `?restore=<base64>` 访问应用，THE Session_Import_Service SHALL 解码参数并触发导入流程

### 需求 5：快照序列化与反序列化

**用户故事：** 作为开发者，我希望快照数据能可靠地序列化和反序列化，以确保数据完整性。

#### 验收标准

1. THE Snapshot_Serializer SHALL 将完整快照状态序列化为 JSON 格式
2. THE Snapshot_Serializer SHALL 将 JSON 格式的快照反序列化为完整快照状态对象
3. FOR ALL 有效的快照状态对象，序列化后再反序列化 SHALL 产生与原始对象等价的结果（往返一致性）

### 需求 6：服务端模式兼容

**用户故事：** 作为用户，我希望在服务端模式下系统优先使用服务端快照，同时保留本地快照作为备份。

#### 验收标准

1. WHILE 系统处于 Advanced 模式（服务端模式），THE Browser_Runtime SHALL 优先使用服务端快照进行恢复
2. WHEN 服务端快照不可用且本地快照存在，THE Browser_Runtime SHALL 回退到本地快照恢复
3. WHEN 系统从 Frontend 模式切换到 Advanced 模式，THE SnapshotStore SHALL 保留本地快照不做删除

### 需求 7：恢复 UI 体验

**用户故事：** 作为用户，我希望在恢复过程中看到清晰的进度提示，了解恢复状态。

#### 验收标准

1. WHEN 恢复流程开始，THE Recovery_Dialog SHALL 显示进度条和当前恢复阶段描述
2. WHILE 3D 场景正在恢复加载，THE Scene3D SHALL 显示"正在恢复上一次任务…"提示
3. WHEN 恢复完成，THE Recovery_Dialog SHALL 自动关闭并将用户导航到恢复的 Mission 详情页

### 需求 8：快照性能优化

**用户故事：** 作为用户，我希望快照生成不影响正常的任务执行和 3D 渲染性能。

#### 验收标准

1. THE SnapshotStore SHALL 使用 Web Worker 执行快照序列化和压缩操作
2. WHEN 快照生成过程中发生错误，THE SnapshotStore SHALL 记录错误日志并继续任务执行，不中断用户操作

### 需求 9：历史会话管理

**用户故事：** 作为用户，我希望能查看和管理本地保存的历史快照列表。

#### 验收标准

1. THE Tasks_Page SHALL 提供"历史会话"标签，列出所有可恢复的本地快照
2. WHEN 用户在历史会话列表中选择一个快照，THE Recovery_Dialog SHALL 显示该快照的详情并提供 Resume 和 Delete 选项
3. THE 历史会话列表 SHALL 显示每个快照的 Mission 标题、保存时间和进度百分比
