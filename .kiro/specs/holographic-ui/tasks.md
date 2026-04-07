<!--
 * @Author: wangchunji
 * @Date: 2026-04-07 13:36:20
 * @Description: 
 * @LastEditTime: 2026-04-07 17:25:37
 * @LastEditors: wangchunji
-->
# Holographic Command Deck UI 升级 任务清单

- [x] 1. 设计令牌与全局样式基础
  - [x] 1.1 在 `client/src/index.css` 中新增 CSS 变量（glass-bg、glow 色、状态色、字体变量）
  - [x] 1.2 新增 `.glass-panel`、`.glass-panel-strong`、`.glass-3d` 工具类
  - [x] 1.3 新增呼吸光晕 `@keyframes breathe-glow` 和波纹 `@keyframes ripple` 动画
  - [x] 1.4 在 `client/index.html` 中添加 Space Grotesk + JetBrains Mono 字体预连接
  - [x] 1.5 更新 `:root` 字体变量，标题用 `--font-display`，数据用 `--font-mono`
  - [x] 1.6 更新滚动条样式与毛玻璃风格统一

- [x] 2. HoloDock 胶囊悬浮导航栏
  - [x] 2.1 新建 `client/src/components/HoloDock.tsx`
  - [x] 2.2 实现胶囊形状布局（居中悬浮、rounded-full、glass-panel-strong）
  - [x] 2.3 实现鼠标悬停弹簧放大动效（framer-motion spring）
  - [x] 2.4 实现相邻图标鱼眼放大效果
  - [x] 2.5 实现活跃项发光指示点
  - [x] 2.6 实现语言切换按钮集成
  - [x] 2.7 移动端适配（小屏幕下图标缩小、间距收紧）

- [x] 3. HoloDrawer 侧边抽屉容器
  - [x] 3.1 新建 `client/src/components/HoloDrawer.tsx`
  - [x] 3.2 实现右侧滑入动画（framer-motion spring）
  - [x] 3.3 实现全高吸附布局（底部留出 Dock 高度）
  - [x] 3.4 实现毛玻璃背景 + 标题栏 + 关闭按钮
  - [x] 3.5 实现 ESC 键关闭和外部点击关闭

- [x] 4. GlowButton CTA 按钮
  - [x] 4.1 新建 `client/src/components/ui/GlowButton.tsx`
  - [x] 4.2 实现渐变背景（primary/danger/ghost 三种变体）
  - [x] 4.3 实现悬停发光外晕
  - [x] 4.4 实现点击波纹动画
  - [x] 4.5 实现禁用状态降级

- [x] 5. Home 页面布局重构
  - [x] 5.1 将 Toolbar 替换为 HoloDock
  - [x] 5.2 将 WorkflowPanel/ChatPanel/ConfigPanel 包裹在 HoloDrawer 中
  - [x] 5.3 调整 3D Canvas 为全屏，面板叠加在上方
  - [x] 5.4 Preview Bar 移至顶部，改为半透明小条
  - [x] 5.5 移动端布局适配

- [x] 6. 面板毛玻璃化
  - [x] 6.1 WorkflowPanel 所有卡片和区块改为 glass-panel
  - [x] 6.2 ChatPanel 改为 glass-panel
  - [x] 6.3 ConfigPanel 改为 glass-panel
  - [x] 6.4 LoadingScreen 改为 glass-panel
  - [x] 6.5 GitHubRepoBadge 改为 glass-panel
  - [x] 6.6 所有 "发布指令" 按钮替换为 GlowButton

- [x] 7. 3D 场景内 UI 融合
  - [x] 7.1 Agent 姓名牌背景改为 glass-3d
  - [x] 7.2 实现工作状态呼吸光晕动画（border-color 渐变循环）
  - [x] 7.3 状态文字颜色根据状态变化
  - [x] 7.4 空闲状态静态半透明白边

- [x] 8. 排版与字体应用
  - [x] 8.1 所有标题（h1-h4、面板标题）应用 font-display
  - [x] 8.2 所有数据数字（评分、进度、Token 数）应用 font-mono
  - [x] 8.3 正文保持 font-body
