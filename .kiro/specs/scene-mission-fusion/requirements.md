# 需求文档

## 简介

将 Mission 任务驾驶舱（TasksPage / TaskDetailPage）的核心状态信息融合进 3D 办公场景（Scene3D），让用户无需跳转页面即可在 3D 场景中实时查看 Mission 执行状态。采用 @react-three/drei 的 Html 组件将 React DOM 元素桥接到 3D 空间，复用现有 React 组件和 Zustand tasks-store 数据层，不引入任何后端变更。

## 术语表

- **Scene3D**：3D 办公场景主组件，基于 React Three Fiber 的 Canvas 渲染
- **Mission_Island**：在 3D 场景中新增的"任务中心"3D 对象组，作为 Mission 状态的视觉锚点
- **Mini_View**：通过 Html 组件嵌入 3D 空间的紧凑型 Mission 状态摘要面板
- **Detail_Overlay**：点击 Mission Island 后展开的详细 Mission 信息覆盖面板
- **Html_Component**：@react-three/drei 提供的组件，用于在 3D 场景中渲染 DOM 元素
- **tasks-store**：Zustand 状态管理库中的 Mission 数据存储（useTasksStore hook）
- **TaskPlanetInterior**：现有的六阶段环形可视化组件
- **PetWorkers**：3D 场景中的宠物工作者组件，已使用 Html 组件实现语音气泡
- **distanceFactor**：Html 组件的 3D 透视缩放参数
- **useViewportTier**：视口档位 hook，提供 isMobile / isTablet / isDesktop 响应式判断

## 需求

### 需求 1：Mission Island 3D 对象

**用户故事：** 作为用户，我希望在 3D 办公场景中看到一个专属的"任务中心"区域，直观地表示当前 Mission 的执行状态。

#### 验收标准

1. THE Scene3D SHALL 包含一个新的 3D 对象组（Mission_Island），放置在办公场景中可见但不遮挡主要内容的位置
2. THE Mission_Island SHALL 包含一个基础 3D 对象（使用现有家具模型或简单几何体平台）作为视觉锚点
3. WHILE 一个 Mission 正在运行中，THE Mission_Island SHALL 显示微妙的发光或脉冲动画；WHILE 无 Mission 运行，THE Mission_Island SHALL 保持静态暗淡状态
4. WHEN 用户点击 Mission_Island，THE Scene3D SHALL 触发 Detail_Overlay 的展开
5. THE Mission_Island SHALL 根据视口档位（桌面端 ≥1280、平板端 768-1279、移动端 <768）通过 useViewportTier hook 进行适当的缩放调整

### 需求 2：Mission Mini View（紧凑摘要）

**用户故事：** 作为用户，我希望在 3D 场景中直接看到当前 Mission 的紧凑实时摘要，无需跳转页面。

#### 验收标准

1. THE Mini_View SHALL 使用 @react-three/drei 的 Html_Component 渲染，定位在 Mission_Island 3D 对象上方
2. THE Mini_View SHALL 显示以下信息：当前 Mission 标题（截断至 40 字符）、当前阶段标签、进度百分比、以及一个迷你进度条
3. THE Mini_View SHALL 显示最多 3 个活跃 Agent 头像（使用 agent-config 中的 emoji 图标），表示当前正在工作的 Agent
4. THE Mini_View SHALL 在 mission_event Socket 事件到达时实时更新，从现有 tasks-store 读取数据
5. WHEN 没有活跃的 Mission 时，THE Mini_View SHALL 显示空闲状态，包含"暂无活跃任务"消息和"创建任务"快捷操作
6. THE Mini_View SHALL 保持紧凑的占用空间（最大宽度 200px），避免遮挡 3D 场景

### 需求 3：Mission Detail Overlay（详情覆盖面板）

**用户故事：** 作为用户，我希望点击 Mission Island 后能看到完整的 Mission 详情（星球内部视图、时间线、Agent 列表），无需离开 3D 场景。

#### 验收标准

1. WHEN 用户点击 Mission_Island 或 Mini_View，THE Scene3D SHALL 展开一个锚定在 Mission_Island 3D 空间位置的 Detail_Overlay 面板
2. THE Detail_Overlay SHALL 包含 TaskPlanetInterior 的紧凑版本（六阶段环形可视化），显示各阶段进度
3. THE Detail_Overlay SHALL 包含一个可滚动的最近 Mission 事件时间线（最近 10 条事件）
4. THE Detail_Overlay SHALL 包含参与 Agent 列表及其当前状态（idle / working / thinking / done / error）
5. THE Detail_Overlay SHALL 包含操作按钮："查看完整详情"（导航至 /tasks/:id）和"关闭"（收起回 Mini View）
6. WHILE Detail_Overlay 处于打开状态，THE Scene3D SHALL 对场景其余部分施加轻微的暗化或模糊效果以聚焦注意力
7. THE Detail_Overlay SHALL 支持通过点击外部区域或按 Escape 键关闭

### 需求 4：实时数据集成

**用户故事：** 作为开发者，我希望 Mission Island 使用现有数据基础设施，无需任何后端变更。

#### 验收标准

1. THE Mission_Island 组件 SHALL 仅从现有 tasks-store（useTasksStore hook）读取 Mission 数据
2. THE Mission_Island SHALL 自动选择最相关的 Mission 进行展示：第一优先级为运行中的 Mission，第二优先级为等待中的 Mission，第三优先级为最近创建的 Mission
3. WHEN 一个新 Mission 被创建（通过 CreateMissionDialog 或 /tasks?new=1 流程），THE Mission_Island SHALL 自动切换显示新 Mission
4. THE Mission_Island SHALL 对 Socket mission_event 更新实时响应，延迟与现有 TasksPage 一致
5. THE Mission_Island SHALL 不引入任何新的 API 调用或 Socket 通道，完全使用现有数据基础设施

### 需求 5：场景集成质量

**用户故事：** 作为用户，我希望 Mission Island 感觉像 3D 办公场景的自然组成部分，而非生硬拼接的 UI 元素。

#### 验收标准

1. THE Mission_Island 的 Html_Component SHALL 使用 distanceFactor 实现正确的 3D 透视缩放（与现有 PetWorkers 语音气泡保持一致）
2. THE Mission_Island SHALL 在出现和消失时具有平滑的进入/退出动画（淡入淡出 + 缩放）
3. THE Mission_Island 的视觉风格 SHALL 匹配现有的温暖办公室美学（奶油色/木色/大地色调，来自项目设计系统）
4. THE Mission_Island SHALL 不造成性能下降——在 Mission_Island 激活状态下，3D 场景在中端设备上保持 30+ FPS
5. THE Mission_Island SHALL 与现有 PetWorkers 消息流路径共存，不产生视觉冲突
