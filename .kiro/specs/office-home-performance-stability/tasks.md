# 办公室首页性能稳定性优化任务拆解

## 任务

- [x] 1. 重构视口监听机制
  - [x] 1.1 用 `useSyncExternalStore` 重写 `useViewportTier`
  - [x] 1.2 新增 `useViewportWidth`
  - [x] 1.3 新增 `useViewportResizeState`

- [x] 2. 收口桌面办公室首页初始化职责
  - [x] 2.1 将任务初始化收口到 `Home`
  - [x] 2.2 移除 `OfficeTaskCockpit` 的重复初始化副作用
  - [x] 2.3 将 workflow 次要上下文改为延后加载

- [x] 3. 去掉桌面路径上的无关计算
  - [x] 3.1 移动端公告板快照仅在移动端计算
  - [x] 3.2 连续宽度消费者改用 `useViewportWidth`

- [x] 4. 实现 `Scene3D` 性能档位
  - [x] 4.1 新增 `balanced / resizing` 档位
  - [x] 4.2 下调桌面默认 DPR 与阴影尺寸
  - [x] 4.3 在 resizing 中关闭 `ContactShadows`
  - [x] 4.4 在 resizing 中暂停非关键粒子系统

- [x] 5. 优化资源加载与场景装饰
  - [x] 5.1 移除模块级全量 GLTF 预热
  - [x] 5.2 增加关键模型优先预热
  - [x] 5.3 将次级模型与装饰改为空闲补齐
  - [x] 5.4 将 `OfficeRoom` 次级装饰延后渲染

- [x] 6. 收缩常驻 Html 标签
  - [x] 6.1 降级模式中隐藏部门标识
  - [x] 6.2 Worker 常驻标签改为按需显示
  - [x] 6.3 角色/告警/信誉等次级标签在降级模式中隐藏

- [x] 7. 增加桌面壳层 resize 降级样式
  - [x] 7.1 顶部导航接入低成本样式分支
  - [x] 7.2 办公室驾驶舱接入低成本样式分支

- [ ] 8. 完成手测与回归验证
  - [ ] 8.1 Chrome Performance 录制硬刷新
  - [ ] 8.2 Chrome Performance 录制连续拖拽宽度
  - [ ] 8.3 回归任务/Agent/场景联动

## 备注

- 本轮优先解决刷新与 resize 卡顿，不做整套视觉重设计。
- 若后续仍有卡顿，可继续针对 `useFrame` 热点和 `Html` 数量做第二轮精简。
