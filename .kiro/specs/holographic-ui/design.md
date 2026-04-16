# Holographic Command Deck UI 升级 设计文档

## 概述

将现有扁平白板 UI 升级为全息操控舱风格。核心设计语言：毛玻璃拟态 (Glassmorphism) + 有机科幻 + 物理动效。

## 设计令牌 (Design Tokens)

### 颜色系统

```css
:root {
  /* 毛玻璃背景 */
  --glass-bg: rgba(255, 255, 255, 0.12);
  --glass-bg-hover: rgba(255, 255, 255, 0.18);
  --glass-bg-active: rgba(255, 255, 255, 0.24);
  --glass-border: rgba(255, 255, 255, 0.15);
  --glass-border-hover: rgba(255, 255, 255, 0.25);

  /* 发光色 */
  --glow-cyan: rgba(6, 182, 212, 0.5);
  --glow-blue: rgba(59, 130, 246, 0.5);
  --glow-amber: rgba(245, 158, 11, 0.4);
  --glow-purple: rgba(168, 85, 247, 0.4);

  /* 状态色 */
  --status-working: #06b6d4; /* cyan-500 */
  --status-thinking: #f59e0b; /* amber-500 */
  --status-reviewing: #a855f7; /* purple-500 */
  --status-idle: rgba(255, 255, 255, 0.6);
  --status-done: #22c55e; /* green-500 */
  --status-error: #ef4444; /* red-500 */

  /* 字体 */
  --font-display: "Space Grotesk", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "Fira Code", monospace;
  --font-body: "DM Sans", system-ui, sans-serif;
}
```

### 毛玻璃工具类

```css
/* 基础毛玻璃面板 */
.glass-panel {
  background: var(--glass-bg);
  backdrop-filter: blur(24px) saturate(1.2);
  -webkit-backdrop-filter: blur(24px) saturate(1.2);
  border: 1px solid var(--glass-border);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

/* 强调毛玻璃（Dock、CTA） */
.glass-panel-strong {
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(40px) saturate(1.4);
  border: 1px solid rgba(255, 255, 255, 0.25);
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
}

/* 3D 场景内毛玻璃 */
.glass-3d {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
```

## 布局架构

```
┌─────────────────────────────────────────────────────────┐
│ Preview Bar (顶部，半透明小条，仅 Pages 模式显示)         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│                                                         │
│              3D Canvas (全屏)                            │
│              Agent 姓名牌 = glass-3d                     │
│              状态气泡 = glass-3d + 呼吸光晕               │
│                                                         │
│                                         ┌──────────────┐│
│                                         │ 侧边抽屉面板  ││
│                                         │ glass-panel   ││
│                                         │ 宽度 ≤420px   ││
│                                         │ 全高吸附      ││
│                                         │ 底部留出 Dock ││
│                                         └──────────────┘│
│                                                         │
│         ┌─────────────────────────┐                     │
│         │   胶囊 Dock (居中悬浮)   │                     │
│         │   glass-panel-strong    │                     │
│         │   rounded-full          │                     │
│         └─────────────────────────┘                     │
└─────────────────────────────────────────────────────────┘
```

## 组件改造清单

### 1. HoloDock（替代 Toolbar）

```
位置: client/src/components/HoloDock.tsx
替代: client/src/components/Toolbar.tsx

结构:
┌──────────────────────────────────────────┐
│  🏠  📋  💬  ⚙️  🔬  📊  ❓  🌐        │
│  ·                                  ·    │
└──────────────────────────────────────────┘
     ↑ 活跃指示点        ↑ 语言切换

交互:
- 鼠标悬停: 图标 scale 1.0 → 1.3 (spring)
- 相邻图标: scale 1.0 → 1.1 (鱼眼效果)
- 点击: 打开对应侧边抽屉
- 活跃项: 底部发光点 (cyan)
```

### 2. HoloDrawer（侧边抽屉容器）

```
位置: client/src/components/HoloDrawer.tsx
用途: 包裹 WorkflowPanel / ChatPanel / ConfigPanel 等

Props:
- open: boolean
- onClose: () => void
- title: string
- width?: number (默认 400)

动画:
- 打开: translateX(100%) → translateX(0), spring 物理曲线
- 关闭: translateX(0) → translateX(100%) + opacity 1 → 0
- 背景遮罩: 无（3D 场景保持可见）
```

### 3. GlowButton（CTA 按钮）

```
位置: client/src/components/ui/GlowButton.tsx

样式:
- 背景: bg-gradient-to-r from-cyan-500 to-blue-600
- 悬停: shadow-[0_0_20px_rgba(6,182,212,0.5)]
- 点击: ripple 波纹动画
- 禁用: 降低饱和度, 无发光

变体:
- primary: cyan → blue 渐变
- danger: red → orange 渐变
- ghost: 透明背景, 白色边框
```

### 4. Agent 姓名牌改造

```
文件: client/src/components/three/ 中的 Agent 标签组件

改前: bg-white text-black rounded shadow
改后: glass-3d rounded-lg

状态动效:
- working: border 呼吸光晕 (cyan, 2s 循环)
- thinking: border 呼吸光晕 (amber, 1.5s 循环)
- reviewing: border 呼吸光晕 (purple, 2s 循环)
- idle: border-white/10 静态
- done: border-green-500/30 静态
```

### 5. Preview Bar 改造

```
改前: 底部黄色实底警告条
改后: 顶部半透明小条

样式:
- bg-amber-500/15 backdrop-blur-sm
- text-amber-200/80 text-xs
- 高度 28px, 不影响主布局
- 点击可关闭 (localStorage 记忆)
```

## 字体加载策略

```html
<!-- index.html <head> 中添加 -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
  rel="stylesheet"
/>
```

## 动效规范

| 动效            | 时长   | 曲线                                | 库             |
| --------------- | ------ | ----------------------------------- | -------------- |
| Dock 图标放大   | 200ms  | spring(stiffness: 400, damping: 17) | framer-motion  |
| 抽屉滑入        | 300ms  | spring(stiffness: 300, damping: 25) | framer-motion  |
| 抽屉滑出        | 200ms  | ease-out                            | framer-motion  |
| 卡片 hover 上浮 | 200ms  | ease-out                            | CSS transition |
| CTA 发光        | 200ms  | ease-in-out                         | CSS transition |
| 呼吸光晕        | 2000ms | ease-in-out infinite                | CSS @keyframes |
| 波纹扩散        | 600ms  | ease-out                            | CSS @keyframes |
| 数字滚动        | 300ms  | spring                              | framer-motion  |

## 受影响文件清单

| 文件                                           | 改动类型              | 说明                                        |
| ---------------------------------------------- | --------------------- | ------------------------------------------- |
| `client/src/index.css`                         | 修改                  | 新增 glass 工具类、字体变量、动画 keyframes |
| `client/index.html`                            | 修改                  | 添加 Google Fonts 预连接                    |
| `client/src/components/Toolbar.tsx`            | 重写 → `HoloDock.tsx` | 胶囊 Dock                                   |
| `client/src/components/WorkflowPanel.tsx`      | 修改                  | 毛玻璃材质 + 抽屉化                         |
| `client/src/components/ChatPanel.tsx`          | 修改                  | 毛玻璃材质 + 抽屉化                         |
| `client/src/components/ConfigPanel.tsx`        | 修改                  | 毛玻璃材质 + 抽屉化                         |
| `client/src/components/LoadingScreen.tsx`      | 修改                  | 毛玻璃材质                                  |
| `client/src/components/GitHubRepoBadge.tsx`    | 修改                  | 毛玻璃材质                                  |
| `client/src/pages/Home.tsx`                    | 修改                  | 布局重构（Dock + 抽屉）                     |
| `client/src/components/three/`                 | 修改                  | Agent 姓名牌毛玻璃化                        |
| 新增 `client/src/components/HoloDock.tsx`      | 新增                  | 胶囊 Dock 组件                              |
| 新增 `client/src/components/HoloDrawer.tsx`    | 新增                  | 侧边抽屉容器                                |
| 新增 `client/src/components/ui/GlowButton.tsx` | 新增                  | 发光 CTA 按钮                               |
