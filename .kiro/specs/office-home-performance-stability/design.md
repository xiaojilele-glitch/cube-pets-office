# 办公室首页性能稳定性优化设计

## 根因分析

### 1. 视口订阅过细

- 现有 `useViewportTier` 基于 `window.resize` 每像素更新。
- 大量只关心断点的组件也被迫跟随持续重渲染。
- 结果是拖动窗口时，React 树、Canvas 布局和 DOM 合成都同步抖动。

### 2. 初始化链路重复

- `Home` 与 `OfficeTaskCockpit` 同时参与任务初始化。
- `useWorkflowRuntimeBootstrap` 首屏又并行拉取多组 workflow 相关数据。
- 刷新页面时，网络、store 写入和 UI 计算堆叠在一起。

### 3. Scene3D 首屏成本过高

- 桌面场景同时启用较高 DPR、抗锯齿、2048 阴影和 `ContactShadows`。
- 多处 `useFrame` 动画与大量 `Html` 叠层常驻存在。
- 家具和宠物模型在模块层做全量预热，放大首刷压力。

### 4. 桌面页仍承担非关键工作

- 桌面路径会计算移动端公告板快照。
- 顶部栏和驾驶舱面板大量使用 `backdrop-blur` 与半透明渐变，拖拽窗口时浏览器合成成本明显。

## 方案设计

### 1. 首页初始化收口

- `Home` 成为桌面办公室首页唯一的任务初始化入口。
- `OfficeTaskCockpit` 移除挂载即 `ensureReady()` 的副作用。
- `useWorkflowRuntimeBootstrap` 保留现有数据来源，但将 `heartbeatReports` 延后到首屏稳定后再拉取。
- 移动端公告板快照仅在移动端路径下计算。

### 2. 视口与 resize 架构

- `useViewportTier` 改为 `matchMedia + useSyncExternalStore` 的单例订阅。
- `useViewportTier` 仅在断点跨越时刷新。
- 新增 `useViewportWidth`，只给确实依赖连续宽度的页面使用，并通过 `requestAnimationFrame` 节流。
- 新增 `useViewportResizeState`，只在拖拽开始和稳定结束时切换状态。

## 3. 场景性能档位

### balanced

- 桌面 DPR 下调至更保守范围。
- 主方向光阴影图由 2048 收紧至 1024。
- 保留主体灯光和场景可读性。

### resizing

- DPR 临时降至 `1`。
- 关闭 `ContactShadows`。
- 暂停装饰型粒子系统。
- 隐藏或压缩非关键 `Html` 叠层与装饰物。

## 4. 资源加载策略

- 移除家具和宠物模型的模块级全量预热。
- 首屏关键家具在 `Scene3D` 挂载后优先预热。
- 次级家具与宠物模型在空闲时补齐。
- `OfficeRoom` 中的品牌牌匾、流光展板、任务推车、植物和休闲区装饰作为次级装饰延后渲染。

## 5. Html 叠层裁剪规则

- Agent 主标签在以下条件下保留：
  - 当前选中
  - 当前 hover
  - Agent 非 idle
  - Agent 角色不是 worker
- 角色徽章、慢告警、低优先级信誉标签在降级模式中隐藏。
- 部门标识在降级模式中隐藏。
- 场景主焦点信息、等待决策气泡、沙盒监控面板保留。

## 6. 桌面壳层降级

- `Home` 顶部导航与工具按钮接入 `resize-active` 分支。
- `OfficeTaskCockpit` 的中心浮层与右侧面板接入低成本样式分支。
- 降级样式以实底、轻阴影替代 blur-heavy 玻璃态。

## 7. 风险与边界

- 本次不修改后端接口，也不改变 store 数据契约。
- 次级装饰延后出现是有意设计，不视为功能缺失。
- 移动端路径仅做“避免桌面多算”，不做整体性能重构。
