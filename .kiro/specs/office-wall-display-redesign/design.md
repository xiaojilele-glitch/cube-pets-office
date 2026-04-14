# 办公室墙面显示器改造 - 设计文档

## 概述

当前后墙实现已经把 sandbox 终端和浏览器预览嵌进了场景，但从观感上看，它仍然像“两张卡片塞进一块板子里”，而不是一台真正的办公室墙面监控设备。

这次改造的目标，是把后墙升级为一台统一的三分区壁挂显示器：

- 左侧：`Execution Feed`
- 中间：`Mission Control`
- 右侧：`Browser Live`

其中中间任务区是主叙事层，左右两侧分别提供执行证据和浏览器证据。

## 设计原则

1. 场景优先。它必须先像设备，再像 UI。
2. 任务优先。中间区域讲故事，左右区域做辅助。
3. 单一真相源。三个区域必须指向同一个 mission 焦点。
4. 复用优先。优先复用 `tasks-store`、`sandbox-store`、`TerminalPreview`、`ScreenshotPreview`。
5. 分阶段交付。允许先做壳体与布局，再补内容、交互和灯光细节。

## 当前基线

相关文件：

- `client/src/components/Scene3D.tsx`
- `client/src/components/three/SandboxMonitor.tsx`
- `client/src/components/sandbox/TerminalPreview.tsx`
- `client/src/components/sandbox/ScreenshotPreview.tsx`
- `client/src/components/tasks/TaskOperationsHero.tsx`
- `client/src/lib/tasks-store.ts`
- `client/src/lib/sandbox-store.ts`
- `client/src/components/three/OfficeRoom.tsx`

当前情况：

- `Scene3D` 通过 `SandboxMonitor` 挂载后墙内容。
- `SandboxMonitor` 目前是双槽位结构，左边终端、右边截图。
- 任务主信息没有成为墙面中心，而是分散在 cockpit 其他区域。
- `sandbox-store` 当前只有一个 `fullscreen` 布尔值，这对三分区监控设备来说过于粗糙。

## 目标构成

### 物理构成

后墙设备改成一个统一的壁挂显示器，固定在后墙中央。设备应包含：

- 深色金属或深灰外框
- 统一玻璃屏面
- 明确的壁挂厚度或安装支架感
- 弱状态灯
- 底部一根线缆或线缆轮廓
- 轻微的墙面阴影和冷色溢光

推荐三区宽度比例：

- 终端：`28%`
- 任务：`44%`
- 浏览器：`28%`

这样可以保证任务区始终是墙面的视觉中心。

### 信息构成

#### 左侧：Execution Feed

职责：

- 告诉用户执行有没有在跑
- 暴露错误信号
- 提供最近执行痕迹

内容：

- 区域标题
- live / idle / error 状态
- 最近日志
- 可选的 step 或运行时长

规则：

- 不追求完整历史终端
- 不保留强烈桌面窗口头栏感
- 错误日志必须明显可区分

#### 中间：Mission Control

职责：

- 在主镜头下广播当前任务状态

内容：

- 任务标题
- 最多两个状态标签
- 阶段或运行状态标签
- 主进度条
- 一条 blocker / warning
- 三到四个统计指标

规则：

- 文字大、稳、易读
- 不放密集操作按钮
- 不使用桌面窗口语义
- 不展示长段落描述

#### 右侧：Browser Live

职责：

- 展示与当前任务相关的最新浏览器画面

内容：

- 区域标题
- 最新截图
- 更新时间
- 当前步骤或上下文标签

规则：

- 没有截图时也保留外壳和空态
- 失败时尽量保留最后一张有效画面
- 支持点击进入聚焦

## 状态归属

### 任务焦点归属

墙面显示器不应该发明第二套任务选择逻辑，而是复用当前任务焦点：

- 主来源：`useTasksStore(state => state.selectedTaskId)`
- 回退来源：当前最相关的活跃任务
- 回退优先级：运行中任务 > 等待中任务 > 最近任务

### Sandbox 焦点归属

`sandbox-store` 当前持有：

- `activeMissionId`
- `logLines`
- `latestScreenshot`
- `previousScreenshot`
- `isStreaming`
- `fullscreen`

建议演进为：

- 保留 `activeMissionId`
- 将 `fullscreen` 升级或扩展为 `focusedPane: 'terminal' | 'task' | 'browser' | null`
- pane 点击时只聚焦对应区域，而不是整块墙屏统一全屏

## 组件架构

### 推荐方案：保留 `SandboxMonitor` 作为场景装配入口

这是风险最小的方案，因为后墙锚点和 `Scene3D` 关系已经存在。

`SandboxMonitor` 调整后的职责：

- 渲染新的墙面设备壳体
- 渲染三分区 pane 容器
- 同步墙面活跃任务和 `sandbox-store`
- 响应 pane 点击行为

### 推荐组件拆分

1. `client/src/components/three/SandboxMonitor.tsx`
   - 继续作为 `Scene3D` 内的墙面显示入口
   - 从双槽位升级为三分区墙面显示器
2. `client/src/components/three/MissionWallTaskPanel.tsx`
   - 新增
   - 用于渲染墙面专用的任务摘要 UI
3. `client/src/components/sandbox/TerminalPreview.tsx`
   - 增加 `wall` 变体或等价样式能力
   - 弱化桌面工具窗气质
4. `client/src/components/sandbox/ScreenshotPreview.tsx`
   - 增加 `wall` 变体或等价样式能力
   - 强化“实时浏览器画面”语义

## MissionWallTaskPanel 设计

这个组件不应该直接复刻 `TaskDetailView`，而应该从 `TaskOperationsHero` 中提取最适合远读的字段，形成一个“墙面广播版任务卡”。

推荐使用字段：

- `detail.title`
- `detail.status`
- `detail.operatorState`
- `detail.currentStageLabel`
- `detail.progress`
- `detail.lastSignal` 或 `detail.waitingFor`
- 精简后的指标，例如完成数、警告数、运行数、Agent 数

展示规则：

- 标题最多两行
- 告警最多一行
- 指标最多 4 个
- 不出现 operator 按钮区

## 3D 外壳设计

3D 外壳建议继续在 `SandboxMonitor` 内部实现，而不是额外新建一个漂浮层。

推荐变化：

- 用一整块大屏替代当前分裂板子
- 内部分隔线保持弱存在
- 增加底部线缆、支架感和边框厚度
- 周边墙面装饰保持克制，只做陪衬

显示器应继续放在当前后墙中心附近，这样现有镜头和房间构图不用大改。

## 交互模型

三个 pane 的交互建议映射到当前已有产品路径：

- 点击终端区：聚焦终端详情或日志放大视图
- 点击任务区：打开 `/tasks/:id` 或聚焦右侧任务详情
- 点击浏览器区：聚焦截图详情或浏览器预览

本 spec 不要求立刻确定所有最终文案，但要求从“一个通用 fullscreen”升级为“按区域各自聚焦”的模型。

## 分阶段交付

### Phase 1：墙面外壳与三区布局

- 重做后墙几何和三分区槽位
- 在 `SandboxMonitor` 中落三分区结构
- 内容先可用占位态

### Phase 2：中间任务主控区

- 新增 `MissionWallTaskPanel`
- 绑定当前任务数据
- 验证默认镜头下可读性

### Phase 3：左右两区样式收口

- 给 `TerminalPreview` 增加墙面变体
- 给 `ScreenshotPreview` 增加墙面变体
- 弱化“桌面工具窗口”气质

### Phase 4：聚焦交互

- 增加 pane 级聚焦状态
- 接通点击行为
- 保证任务焦点同步

### Phase 5：场景打磨

- 支架、阴影、冷暖溢光、线缆和墙面装饰细节补完
- 调整失败态、空态、完成态视觉

## 测试策略

### 组件与状态校验

- 活跃任务选择在三个区域保持一致
- `mission_log` 到达时终端区正常刷新
- `mission_screen` 到达时浏览器区正常刷新
- 无任务时墙面仍保持稳定结构
- 失败任务时告警和最后证据画面正确保留

### 桌面视觉回归

- 默认桌面镜头下能快速读到任务状态和进度
- 中间区域始终是主视觉
- 左右区域不塌陷、不漂移
- 整体读起来像挂在墙上的设备，而不是浮层

### 兼容性校验

- `/tasks` 和 `/tasks/:taskId` 保持原有深链和全屏工作台能力
- `ExecutorTerminalPanel` 行为不回归
- sandbox socket 数据流不回归
- `Scene3D` 桌面端构图保持稳定

## 风险

- 如果中间区域不够强，最终仍然会读成三张并排卡片。
- 如果外壳没有厚度、支架和阴影，仍然会像浮在墙上的 HUD。
- 如果不升级 pane 级焦点行为，后续交互会被当前 fullscreen 模型卡住。
- 如果中间任务区信息塞太多，即使布局正确，也会在默认镜头下不可读。
