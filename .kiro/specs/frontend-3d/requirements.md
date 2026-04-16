<!--
 * @Author: wangchunji
 * @Date: 2026-03-31 17:04:28
 * @Description:
 * @LastEditTime: 2026-03-31 17:09:55
 * @LastEditors: wangchunji
-->

# 3D 场景与前端 需求文档

## 概述

前端层负责将多智能体协作过程以 3D 办公场景、工作流面板、任务驾驶舱和配置面板可视化展示。包括 Three.js 3D 场景渲染、动态组织与场景联动、工作流进度面板、聊天面板、报告面板、i18n 中英文切换、移动端适配和 GitHub Pages 部署。

## 用户故事

### US-1: 3D 办公场景实时展示智能体状态

作为用户，我希望在首页看到一个 3D 办公室场景，每个智能体以宠物形象呈现，实时显示其工作状态（空闲/思考/执行/评审/完成）。

#### 验收标准

- AC-1.1: 3D 场景使用 Three.js + React Three Fiber + Drei 渲染
- AC-1.2: 场景包含四个部门区域（动态 Pod），区块标题由动态组织驱动
- AC-1.3: 宠物模型使用 Kenney Cube Pets GLB 资源
- AC-1.4: 智能体状态通过 Socket 事件或 BrowserEventEmitter 实时更新
- AC-1.5: 场景背景为清透天空底色 + 室内光感方案

### US-2: 工作流进度面板

作为用户，我希望在工作流执行时看到十阶段进度条、每个部门的任务状态和智能体活跃情况，这样我可以跟踪整个协作过程。

#### 验收标准

- AC-2.1: WorkflowPanel 组件展示十阶段进度条（已完成/进行中/待执行）
- AC-2.2: 每个部门展示经理和 Worker 的任务状态（执行中/已提交/已评审/修订中）
- AC-2.3: 默认总览只展示当前阶段、总体进度、活跃角色与阻塞状态
- AC-2.4: 角色与任务详情改为按需展开（三级信息密度）
- AC-2.5: 关键事件流默认展示最近 3 条，保留"查看全部"入口

### US-3: 指令输入与附件提交

作为用户，我希望在前端输入战略指令并可选附加文件，系统自动解析附件内容并与指令一起提交。

#### 验收标准

- AC-3.1: 指令面板支持文本输入 + 附件上传
- AC-3.2: 支持附件类型：txt/md/json/csv/pdf/docx/xlsx/xls/png/jpg/jpeg/webp/bmp/gif
- AC-3.3: 浏览器端解析附件内容（PDF 用 pdfjs-dist，Word 用 mammoth，Excel 用 xlsx，图片用 tesseract.js OCR）
- AC-3.4: OCR 使用独立 Web Worker，超时或失败时降级为 metadata_only
- AC-3.5: 界面显示附件预览摘要，工作流使用附件全文内容

### US-4: 任务驾驶舱 (/tasks)

作为用户，我希望在 /tasks 页面看到所有 Mission 的列表和详情，包括六阶段进度、执行器状态、日志和工件。

#### 验收标准

- AC-4.1: TasksPage 展示 Mission 列表（左侧）和详情（右侧）
- AC-4.2: TaskDetailView 提供 Overview / Execution / Artifacts 三个视图
- AC-4.3: TaskPlanetInterior 展示六阶段环形可视化
- AC-4.4: 支持创建 Mission（CreateMissionDialog）和提交决策
- AC-4.5: 桌面端单屏驾驶舱布局，页签内容内部滚动

### US-5: 中英文切换

作为用户，我希望界面默认中文，可以一键切换到英文，刷新后保持选择。

#### 验收标准

- AC-5.1: i18n 模块提供 useI18n() hook，返回当前 locale 和 copy 对象
- AC-5.2: 默认语言为中文（zh-CN）
- AC-5.3: 语言选择持久化到 Zustand store（localStorage）
- AC-5.4: 顶部工具栏、工作流面板、配置面板、聊天面板、报告面板全部接入文案字典

### US-6: 移动端适配

作为用户，我希望在手机上也能使用核心功能，不出现按钮不可点、面板超出屏幕的问题。

#### 验收标准

- AC-6.1: 三档响应式布局：≥1280px、768-1279px、<768px
- AC-6.2: 移动端导航折叠、面板收起、滚动容器适配
- AC-6.3: 3D 场景在移动端不溢出
- AC-6.4: 触屏交互细节（点击区域、滑动手势）

### US-7: GitHub Pages 静态部署

作为用户，我希望通过 GitHub Pages 直接访问 Live Demo，无需任何本地配置。

#### 验收标准

- AC-7.1: `npm run build:pages` 构建静态产物到 dist/public
- AC-7.2: Vite base 路径根据 GITHUB_PAGES 环境变量自动设置为仓库子路径
- AC-7.3: Pages 版本强制 Frontend Mode，不连接服务端
- AC-7.4: 右上角展示 GitHub 仓库入口（GitHubRepoBadge 组件）
- AC-7.5: `.github/workflows/deploy-pages.yml` 自动部署

### US-8: 配置面板

作为用户，我希望在配置面板中查看当前 AI 配置和运行模式，Advanced Mode 下显示服务端配置来源。

#### 验收标准

- AC-8.1: ConfigPanel 展示当前模型、Base URL、运行模式
- AC-8.2: Advanced Mode 下配置为只读，提示"修改 .env 后需重启服务"
- AC-8.3: Frontend Mode 下支持在浏览器端编辑 AI 配置（保存到 IndexedDB）
- AC-8.4: 支持 Frontend/Advanced 模式切换
