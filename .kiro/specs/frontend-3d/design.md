# 3D 场景与前端 设计文档

## 概述

前端层基于 React 19 + Vite + TypeScript 构建，3D 场景使用 Three.js (React Three Fiber + Drei)。状态管理使用 Zustand，实时通信使用 Socket.IO（Advanced Mode）或 BrowserEventEmitter（Frontend Mode）。

## 页面结构

```
App.tsx (wouter 路由)
├── / → Home.tsx
│     ├── Scene3D.tsx (3D 办公场景)
│     ├── Toolbar.tsx (顶部工具栏：配置/工作流/聊天/帮助)
│     ├── WorkflowPanel.tsx (工作流进度面板)
│     ├── ChatPanel.tsx (聊天面板)
│     ├── ConfigPanel.tsx (配置面板)
│     ├── GitHubRepoBadge.tsx (GitHub 入口)
│     └── LoadingScreen.tsx (像素风加载页)
├── /tasks → TasksPage.tsx
│     ├── 左侧：Mission 列表
│     └── 右侧：TaskDetailView.tsx
│           ├── Overview 视图
│           ├── Execution 视图
│           └── Artifacts 视图
├── /tasks/:taskId → TaskDetailPage.tsx
└── * → NotFound.tsx
```

## 状态管理

### Zustand Stores

| Store | 文件 | 职责 |
|-------|------|------|
| appStore | `lib/store.ts` | 全局状态：locale、运行模式、面板开关 |
| workflowStore | `lib/workflow-store.ts` | 工作流列表、当前工作流、Socket 监听 |
| tasksStore | `lib/tasks-store.ts` | Mission 列表、详情、Socket 监听 |

### tasks-store.ts 数据源策略

Mission-first + Workflow 补充层：
1. 主数据源：`GET /api/tasks` → MissionRecord
2. 补充层：workflow 投影（Work Packages / Agent Crew / Organization）
3. `buildMissionSummaryRecord()` / `buildMissionDetailRecord()` 将 Mission 数据规范化为前端视图模型
4. Socket `mission_event` 监听 → `patchMissionRecordInStore()` 局部更新

## 3D 场景架构

### Scene3D.tsx
```
Canvas (React Three Fiber)
├── 环境光 + 方向光
├── 地板平面
├── 四个部门区域 (动态 Pod)
│   ├── 区域标签 (部门名称)
│   ├── 家具组合 (临时 Pod 风格)
│   └── 宠物模型 (GLB)
│       ├── 状态动画映射
│       │   ├── idle → 待机动画
│       │   ├── thinking → 思考动画
│       │   ├── working → 快速打字动画
│       │   ├── reviewing → 评审动画
│       │   └── done → 完成动画
│       └── 头顶状态标签
├── CEO 区域 (顶部中央)
├── 墙面装饰 (简化后：壁灯 + 公告板)
└── OrbitControls (相机控制)
```

### 3D 资源
- 宠物模型：`client/public/kenney_cube-pets_1.0/Models/GLB format/`
- 家具模型：`client/public/kenney_furniture-kit/Models/GLTF format/`
- 资源 base path 根据 GitHub Pages 部署自动调整

## 工作流面板 (WorkflowPanel.tsx)

三级信息密度设计：
1. 总览层：当前阶段 + 总体进度 + 活跃角色数 + 阻塞状态
2. 部门层：部门摘要 + 角色一行卡片
3. 详情层：完整 deliverable、反馈、附件、消息流（按需展开）

关键事件流：默认最近 3 条，"查看全部"展开。

## 附件处理 (`lib/workflow-attachments.ts`)

```
用户选择文件
  → 类型检测
  → 浏览器端解析：
      txt/md/json/csv → FileReader.readAsText()
      pdf → pdfjs-dist
      docx → mammoth
      xlsx/xls → xlsx 库
      图片 → tesseract.js (独立 Worker, 超时降级)
  → 生成 { fullText, preview, metadata }
  → fullText 注入 workflow directiveContext
  → preview 在面板中展示
```

## i18n (`i18n/`)

- `messages.ts`：中英文文案字典（`zh-CN` / `en-US`）
- `index.ts`：`useI18n()` hook，从 Zustand 读取 locale，返回对应 copy
- 所有用户可见文案通过 `copy.xxx` 引用，不硬编码

## 响应式布局

| 断点 | 布局 |
|------|------|
| ≥1280px | 完整桌面布局，3D 场景 + 侧栏面板 |
| 768-1279px | 平板布局，面板可折叠 |
| <768px | 移动布局，导航折叠、面板抽屉化、3D 场景缩放 |

`hooks/useViewportTier.ts` 提供当前视口档位。
`hooks/useMobile.tsx` 提供移动端检测。

## GitHub Pages 部署

```
vite.config.ts:
  base: isGitHubPagesBuild ? `/${repositoryName}/` : "/"
  define: __GITHUB_PAGES__, __GITHUB_REPOSITORY__, __GITHUB_REPOSITORY_URL__

deploy-pages.yml:
  trigger: push to main
  steps: npm install → npm run build:pages → deploy to gh-pages
```

`deploy-target.ts` 在运行时检测：
- `__GITHUB_PAGES__` 为 true → 强制 Frontend Mode
- 3D 模型资源路径自动加上 base prefix
