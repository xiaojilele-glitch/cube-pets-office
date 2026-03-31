# 实施计划：Scene-Mission Fusion

## 概述

将 Mission 任务状态融合进 3D 办公场景。采用分层实现：先构建纯逻辑函数和数据 hook，再构建 React DOM 组件（Mini View / Detail Overlay），最后构建 3D 组件（MissionIsland）并集成到 Scene3D。所有代码为纯前端 TypeScript，使用现有 tasks-store 数据层。

## 任务

- [ ] 1. 实现核心纯逻辑函数
  - [ ] 1.1 在 `client/src/components/tasks/mission-island-helpers.ts` 中实现 `selectDisplayMission` 函数
    - 输入：MissionTaskSummary 数组
    - 按优先级选择：running > waiting > 最近创建（createdAt 降序）
    - 空列表返回 null
    - _需求: 4.2, 1.3_

  - [ ] 1.2 在同一文件中实现 `truncateTitle` 函数
    - 输入：字符串和最大长度（默认 40）
    - 超长时截断并添加 '…' 后缀
    - _需求: 2.2_

  - [ ] 1.3 在同一文件中实现 `extractActiveAgents` 函数
    - 输入：MissionTaskDetail 和最大数量（默认 3）
    - 过滤 working/thinking 状态的 Agent，返回 id + emoji
    - _需求: 2.3_

  - [ ] 1.4 在同一文件中实现 `getIslandScale` 函数
    - 输入：ViewportTier
    - 返回对应缩放值：desktop=1.0, tablet=0.85, mobile=0.7
    - _需求: 1.5_

  - [ ] 1.5 在同一文件中实现 `sliceRecentEvents` 函数
    - 输入：TaskTimelineEvent 数组
    - 返回按时间降序排列的最近 10 条事件
    - _需求: 3.3_

  - [ ]* 1.6 编写 `selectDisplayMission` 的属性测试
    - **Property 1: Mission 选择优先级**
    - 使用 fast-check 生成随机 MissionTaskSummary 数组
    - 验证 running > waiting > 最近创建的优先级规则
    - **验证: 需求 1.3, 4.2**

  - [ ]* 1.7 编写 `truncateTitle` 的属性测试
    - **Property 2: 标题截断保持前缀不变**
    - 使用 fast-check 生成随机 Unicode 字符串
    - 验证结果长度约束和前缀保持
    - **验证: 需求 2.2**

  - [ ]* 1.8 编写 `extractActiveAgents` 的属性测试
    - **Property 3: 活跃 Agent 提取上限与过滤**
    - 使用 fast-check 生成随机 Agent 列表
    - 验证数量上限和状态过滤
    - **验证: 需求 2.3**

  - [ ]* 1.9 编写 `sliceRecentEvents` 的属性测试
    - **Property 4: 时间线事件截断**
    - 使用 fast-check 生成随机事件列表
    - 验证数量上限和时间排序
    - **验证: 需求 3.3**

  - [ ]* 1.10 编写 `getIslandScale` 的属性测试
    - **Property 5: 视口缩放映射**
    - 使用 fast-check 生成随机视口宽度
    - 验证缩放值与档位的对应关系
    - **验证: 需求 1.5**

- [ ] 2. 检查点 - 确保所有纯逻辑测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [ ] 3. 实现 MissionMiniView React 组件
  - [ ] 3.1 创建 `client/src/components/tasks/MissionMiniView.tsx`
    - 接收 MissionTaskSummary | null、onExpand、onCreateMission props
    - 活跃态：显示截断标题、阶段标签、进度百分比、迷你进度条、最多 3 个 Agent emoji
    - 空闲态：显示"暂无活跃任务"和"创建任务"按钮
    - 最大宽度 200px，温暖色调（cream/wood/earth tones）
    - 使用 task-helpers.ts 中的现有辅助函数
    - _需求: 2.1, 2.2, 2.3, 2.5, 2.6, 5.3_

  - [ ]* 3.2 编写 MissionMiniView 单元测试
    - 测试空闲态渲染（mission === null 时显示空闲消息）
    - 测试活跃态渲染（标题、进度、Agent 头像存在性）
    - 测试 onExpand 和 onCreateMission 回调触发
    - _需求: 2.2, 2.5_

- [ ] 4. 实现 CompactPlanetInterior 组件
  - [ ] 4.1 创建 `client/src/components/tasks/CompactPlanetInterior.tsx`
    - 从 TaskPlanetInterior 提取环形可视化核心逻辑
    - 仅保留中心环形图（conic-gradient 环 + 中心进度 + 阶段标签）
    - 移除侧边栏详情面板和 Agent Crew 面板
    - 缩小尺寸适配 Overlay 容器（max-w-[240px]）
    - _需求: 3.2_

- [ ] 5. 实现 MissionDetailOverlay 组件
  - [ ] 5.1 创建 `client/src/components/tasks/MissionDetailOverlay.tsx`
    - 接收 MissionTaskDetail | null、onClose、onNavigateToDetail props
    - 包含 CompactPlanetInterior 环形可视化
    - 包含最近 10 条事件时间线（使用 sliceRecentEvents）
    - 包含 Agent 列表及状态（使用 task-helpers 中的 agentStatusLabel/agentStatusTone）
    - 包含"查看完整详情"和"关闭"按钮
    - 淡入 + 缩放进入动画（Tailwind animate-in）
    - _需求: 3.1, 3.2, 3.3, 3.4, 3.5, 5.3_

  - [ ]* 5.2 编写 MissionDetailOverlay 单元测试
    - 测试关闭按钮触发 onClose
    - 测试 Escape 键触发 onClose
    - 测试"查看完整详情"按钮触发 onNavigateToDetail
    - _需求: 3.5, 3.7_

- [ ] 6. 检查点 - 确保所有 React 组件测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [ ] 7. 实现 MissionIsland 3D 组件
  - [ ] 7.1 创建 `client/src/components/three/MissionIsland.tsx`
    - 实现 useMissionIslandData hook：从 useTasksStore 读取数据，调用 selectDisplayMission
    - 渲染基础 3D 几何体（CylinderGeometry 平台 + 发光环 RingGeometry）
    - 使用 useFrame 实现发光脉冲动画（Mission 运行时激活，空闲时暗淡）
    - 通过 Html 组件挂载 MissionMiniView（distanceFactor 与 PetWorkers 一致）
    - 通过 Html 组件挂载 MissionDetailOverlay（expanded 状态控制显隐）
    - 处理点击事件切换 expanded 状态
    - 处理 Escape 键和外部点击关闭 Detail Overlay
    - 使用 useViewportTier + getIslandScale 实现响应式缩放
    - 位置常量：ISLAND_POSITION = [4.5, 0, -3.5]
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.4, 3.1, 3.6, 3.7, 4.1, 4.2, 4.3, 5.1, 5.2, 5.4, 5.5_

- [ ] 8. 集成到 Scene3D
  - [ ] 8.1 修改 `client/src/components/Scene3D.tsx`
    - 在 `<PetWorkers />` 之后、`<ContactShadows />` 之前添加 `<MissionIsland />`
    - 确保 import 路径正确
    - _需求: 1.1_

- [ ] 9. 最终检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。
  - 运行 `npm run check` 确保 TypeScript 类型检查通过。

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP
- 每个任务引用具体需求以确保可追溯性
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
- 所有新文件放在 `client/src/components/three/` 和 `client/src/components/tasks/` 目录下
- 纯前端实现，不涉及后端变更
