# Office Task Cockpit - 需求文档

## 概述

当前产品已经完成了一级导航收口、任务中台化、WorkflowPanel 拆解和办公室场景补位，但桌面端主路径仍然分散在 `办公室` 与 `/tasks` 两个高频界面之间。用户虽然能在办公室里感知态势，也能在任务页里推进任务，却仍然需要在“看现场”和“做控制”之间切换心智。

本 spec 的目标，是把办公室从“全局态势页”推进为“桌面端默认执行主壳”：在同一屏里同时承载任务队列、办公室场景、任务详情与 workflow 上下文，让用户像使用驾驶舱一样完成发起、观察、干预与追踪。

## 设计目标

1. 让办公室成为桌面端默认执行主壳，而不是仅承担态势浏览。
2. 让任务推进、Agent 上下文和场景感知在同一屏闭环完成。
3. 复用现有 `tasks-store`、`workflow-store`、`Scene3D` 与任务组件，避免再造第二套系统。
4. 保留 `/tasks` 深链与全屏工作台价值，同时保证移动端 v1 稳定不回退。

## 依赖关系

- 依赖已完成的 `navigation-convergence`，保证 `办公室 / 任务 / 更多` 的一级路径稳定。
- 依赖已完成的 `task-hub-convergence`，复用 `/tasks` 已收口的任务发起、队列和详情能力。
- 依赖已完成的 `workflow-panel-decomposition`，复用已拆散的 workflow 上下文能力，而不是回滚到旧面板。
- 依赖已完成的 `scene-agent-interaction`，复用办公室公告板、Agent 详情和场景联动基础。
- 依赖已完成的 `workspace-visual-unification`，确保办公室驾驶舱沿用统一工作台视觉语言。

## 非目标

- 本 spec 不统一后端任务创建协议，不扩展 mission create API 去承接附件与高级发起。
- 本 spec 不重做移动端办公室与任务页结构，移动端 v1 继续沿用当前路径。
- 本 spec 不删除 `/tasks`、`/tasks/:taskId` 或旧兼容入口，只调整桌面端默认主路径。

## 用户故事与验收标准

### 1. 办公室作为桌面执行主壳

#### 1.1 作为用户，我希望桌面端打开系统后直接进入可执行的办公室，而不是先看态势再跳去任务页

- AC 1.1.1: 桌面端 `/` SHALL 内嵌任务驾驶舱，而不是仅显示办公室摘要卡片与跳转入口
- AC 1.1.2: `Scene3D` SHALL 保持可见，并继续作为办公室中间主场景
- AC 1.1.3: `办公室` SHALL 保持默认首页定位，但桌面端默认心智 SHALL 从“看态势”升级为“运行时工作台”

### 2. 三栏驾驶舱布局

#### 2.1 作为用户，我希望在一屏内同时看到任务队列、办公室现场和当前任务详情，而不是在多个页面之间来回切换

- AC 2.1.1: 桌面端办公室 SHALL 采用三栏驾驶舱布局：左侧任务队列、中间办公室场景、右侧详情区
- AC 2.1.2: 左侧 SHALL 复用现有任务队列能力，中间 SHALL 保留办公室场景，右侧 SHALL 承载任务与上下文详情
- AC 2.1.3: 命令区 SHALL 作为统一发起与主操作区域存在于驾驶舱内，而不是再引入第二套一级命令中心

### 3. 统一发起入口与双通道发起

#### 3.1 作为用户，我希望在办公室里用同一个入口发起任务，无论是普通任务还是带附件的高级发起

- AC 3.1.1: 统一发起入口 SHALL 同时支持“普通任务创建”和“带附件高级发起”
- AC 3.1.2: 普通任务创建 SHALL 继续走现有 mission create / task hub command 链路
- AC 3.1.3: 高级发起 SHALL 继续走现有 workflow directive + attachment 链路，不扩展 mission create API

### 4. 右侧详情内嵌上下文 Tab

#### 4.1 作为用户，我希望右侧详情区默认先给我可操作的任务界面，同时又能继续查看团队流、Agent 和记忆上下文

- AC 4.1.1: 右侧详情区 SHALL 默认显示 `任务` tab，并以任务详情作为默认第一屏
- AC 4.1.2: 右侧详情区 SHALL 提供 `团队流`、`Agent`、`记忆报告`、`历史` 四个补充 tab
- AC 4.1.3: `团队流` tab SHALL 承接旧 workflow 的 stage / org / role summary / attachments / artifact summary，而不是恢复旧 WorkflowPanel 为一级主界面

### 5. 任务 / Agent / 场景联动

#### 5.1 作为用户，我希望选中任务、点击场景 Agent 和切换详情上下文时，系统仍然围绕同一份当前上下文联动，而不是出现第三套选中状态

- AC 5.1.1: `selectedTaskId` SHALL 继续由 `useTasksStore` 作为任务真相源
- AC 5.1.2: `selectedPet` SHALL 继续由 `useAppStore` 作为 Agent 真相源
- AC 5.1.3: 任务选中、场景高亮、Agent 查看与右侧 tab 切换 SHALL 围绕现有任务 / Agent 选中状态联动，不新增第二套全局业务选中模型

### 6. 兼容与设备边界

#### 6.1 作为产品与系统，我希望这次收口不破坏已有深链、兼容入口和移动端现状

- AC 6.1.1: `/tasks` 与 `/tasks/:taskId` SHALL 保留为全屏工作台与深链页
- AC 6.1.2: 旧 `WorkflowPanel` / 兼容入口 SHALL 继续存在于迁移路径中，但不再承担桌面端默认主路径
- AC 6.1.3: 移动端 v1 SHALL 保持当前办公室抽屉 + 任务页结构，不切换到新的桌面驾驶舱布局

## 约束与风险

- `Home.tsx`、`components/tasks/*`、`components/office/*` 是高频冲突区，实施时应优先单 owner 收口。
- 高级发起走 workflow 链路后，mission 可能稍后才建立，需要显式定义“等待落任务”的焦点回落状态。
- 若右侧 tab 边界不清晰，容易把旧 WorkflowPanel 再次变相拼回主界面，削弱驾驶舱的一屏主线。
