<!--
 * @Author: wangchunji
 * @Date: 2026-04-01 09:20:21
 * @Description: 
 * @LastEditTime: 2026-04-10 01:09:31
 * @LastEditors: wangchunji
-->
---
inclusion: auto
---

# Specs 执行顺序与依赖分析

## 总览

截至 2026-04-10，`.kiro/specs` 共 57 个目录：37 个已完成、5 个部分完成、14 个未开始、1 个待补 `tasks.md`（`frontend-demo-mode`）。前三层主线与补充 spec `holographic-ui` 已基本落地，`workflow-artifacts-display` 已完成功能开发、待最终检查点，当前执行面主要收敛到任务控制台主线与工程验收，平台层能力（L31-L38）仍待环境就绪。

> **维护说明**：本文件保留原始执行顺序与依赖分析，供追溯和继续排期使用；若与旧段落的历史口径冲突，以本节快照为准。

## 已完成归档模块

- [x] P00 `workflow-engine` — 十阶段工作流引擎
- [x] P01 `dynamic-organization` — 动态组织生成
- [x] P02 `memory-system` — 三级记忆系统
- [x] P03 `evolution-heartbeat` — 自进化与心跳
- [x] P04 `mission-runtime` — Mission 任务域（核心部分）
- [x] P05 `feishu-bridge` — 飞书集成
- [x] P06 `browser-runtime` — 纯前端运行时
- [x] P07 `frontend-3d` — 3D 场景与前端

## 当前维护快照（2026-04-10）

- 已合并主线：阶段 0、第一层、第二层和第三层链路均已实现并合并。
- 已完成补充 spec：`ai-enabled-sandbox`、`executor-integration`、`holographic-ui`。
- `workflow-artifacts-display` 已完成功能开发：Artifact API、`tasks-store` 扩展、ArtifactListBlock / ArtifactPreviewDialog、WorkflowPanel / TaskDetailView 集成与 Socket 联动均已落地；当前仅剩 `tasks.md` 中最终检查点未勾选。
- 历史尾项：`mission-runtime`、`multi-modal-vision`、`nl-command-center`、`state-persistence-recovery` 仍有少量未勾选任务，属于补测或收尾项。
- 新增近端主线：`mission-cancel-control`、`mission-operator-actions`、`task-detail-operations-first`、`execution-language-refresh`、`mission-ui-polish`。
- 待启动：`i18n-cleanup`、上述 5 个任务控制台补完 spec、第四层 L31-L38，以及尚未补 `tasks.md` 的 `frontend-demo-mode`。
- 工程健康：`npm run check` 当前存在 30 个 TypeScript 错误，属于需要单独收敛的基线欠账。

## 阶段 0：契约先行（并行前必须完成）

- [x] C01 `demo-data-engine` 数据包 schema 冻结 → `shared/demo/contracts.ts`
- [x] C02 事件总线格式统一 → `shared/telemetry/contracts.ts`
- [x] C03 Memory 读写接口分层 → `shared/memory/contracts.ts`
- [x] C04 workflow-decoupling 目标数据结构冻结 → `shared/mission/enrichment.ts`
- [x] C05 跨框架导出格式契约 → `shared/export/contracts.ts`
- [x] C06 LLM 多提供商抽象层 → `shared/llm/contracts.ts`
- [x] C07 RAG Pipeline 步骤链 → `shared/rag/contracts.ts`
- [x] C08 Skill 注册制 → `shared/skill/contracts.ts`

## 第一层：无依赖，可独立并行，纯前端可执行

### 并行组 A：Frontend Mode 极致化（核心优先）
- [x] L01 `demo-data-engine` — 预录演示数据引擎 ✅ 已合并 (13 files, +1317)
- [x] L02 `demo-guided-experience` — 演示回放引擎 + 引导 UI ✅ 已合并 (11 files, +940)

### 并行组 B：3D 场景增强
- [x] L03 `scene-mission-fusion` — Mission 状态融合进 3D 场景 ✅ 已合并 (7 files, +627)
- [x] L04 `cross-framework-export` — 导出为 CrewAI/LangGraph/AutoGen 格式 ✅ 已合并 (18 files, +2866)

### 并行组 C：可观测性（需先完成 C02 事件总线约定）
- [x] L05 `telemetry-dashboard` — 实时遥测仪表盘 ✅ 已合并 (15 files, +1305)
- [x] L06 `cost-observability` — 成本可观测性，Token 追踪 + 前端看板 ✅ 已合并 (14 files, +3181)
- [x] L07 `state-persistence-recovery` — 浏览器端长任务恢复 ✅ 已合并 (30 files, +4639)

### 独立可做
- [x] L08 `collaboration-replay` — Mission 执行过程录制与回放 ✅ 已合并 (52 files, +8291)
- [x] L09 `multi-modal-vision` — 图片理解能力，前端附件扩展 ✅ 已合并 (19 files, +1478)

## 第二层：需要服务端，不需要 Docker

### 并行组 D：技术债清理（应优先，⚠️ C04 必须先完成）
- [x] L10 `workflow-decoupling` — tasks-store 从双轨收口到 mission-first ✅ 已合并 (17 files, +1027/-2166)
- [x] L11 `mission-native-projection` — /api/planets 路由实现 + 前端数据源切换 ✅ 已合并 (13 files, +2793)

### 并行组 E：Agent 能力增强
- [x] L12 `plugin-skill-system` — Skill 热插拔体系 ✅ 已合并 (16 files, +1273)
- [x] L13 `dynamic-role-system` — Agent 运行时角色切换 ✅ 已合并 (29 files, +4961)
- [x] L14 `human-in-the-loop` — 通用审批流 + 决策链 ✅ 已合并 (29 files, +2309)

### 并行组 F：记忆系统升级（⚠️ C03 + C07 必须先完成）
- [x] L15 `knowledge-graph` — 结构化知识图谱层 ✅ 已合并 (43 files, +13786)
- [x] L16 `vector-db-rag-pipeline` — 向量数据库 + RAG 管道 ✅ 已合并 (60 files, +8916)

### 独立可做
- [x] L17 `nl-command-center` — 自然语言指挥中心 ✅ 已合并 (65 files, +13234)
- [x] L18 `agent-autonomy-upgrade` — Agent 自评估 + 竞争执行 ✅ 已合并 (28 files, +4691)
- [x] L19 `agent-reputation` — Agent 信誉评分系统 ✅ 已合并 (28 files, +4360)
- [x] L20 `multi-modal-agent` — 语音 + Vision 统一编排 ✅ 已合并 (20 files, +2302)
- [x] L21 `cost-governance-strategy` — 主动成本治理 ✅ 已合并 (10 files, +1850)

## 第三层：Docker 执行链路（严格串行，无法并行）

```
串行执行顺序（不可跳过）：
L22 → L23 → L24
            → L25
L22 → L22.5（独立并行）
L22 → L24.5（独立并行，桥接 WorkflowEngine ↔ Docker）
```

- [x] L22 `lobster-executor-real` — Docker 真实容器生命周期（大）✅ 已完成 (15 test files, 61 tests, 12 PBT properties)
- [x] L22.5 `ai-enabled-sandbox` — Docker 容器 AI 能力注入（中）✅ 已合并 (20 files, +2261)
- [x] L23 `secure-sandbox` — Docker 安全沙箱（中）✅ 已合并 (24 files, +2283)
- [x] L24 `sandbox-live-preview` — 容器实时终端 + 截图预览（中）✅ 已合并 (25 files, +2177)
- [x] L24.5 `executor-integration` — WorkflowEngine ↔ Docker 执行管线桥接（中）✅ 已合并 (30 files, +5916)
- [x] L25 `agent-permission-model` — Agent 细粒度权限矩阵（中）✅ 已合并 (46 files, +9970)

### 第三层其他串行链路

```
L18 → L26
L14 → L27 → L28
L12 → L29 → L30
```

- [x] L26 `autonomous-swarm` — 跨 Pod 自主协作（大）✅ 已合并 (15 files, +3931)
- [x] L27 `audit-chain` — 不可篡改审计日志（中）✅ 已合并 (37 files, +9125)
- [x] L28 `data-lineage-tracking` — 数据血缘追踪（中）✅ 已合并 (42 files, +9684)
- [x] L29 `a2a-protocol` — 跨框架 Agent 互操作协议（大）✅ 已合并 (22 files, +3068)
- [x] L30 `agent-marketplace` — Guest Agent 机制（中）✅ 已合并 (18 files, +2363)

## L30 后新增主线：任务控制台补完（2026-04-09）

在 Docker 执行闭环与 Artifact 回传跑通后，近期优先级从“能执行”转向“可运营、可协作、可交付”。这条新增主线落在现有 `/tasks` 与任务详情页之上，不改变 L31-L38 的平台级依赖顺序，目标是把任务页从“结果观察面板”推进为“执行控制台”。

### 优先级与依赖

- [x] P0 `mission-cancel-control` — 任务取消端到端可用；补齐用户入口、服务端状态流转、执行器取消、Socket 回传与 UI 反馈闭环。
- [x] P0 `mission-operator-actions` — 统一操作动作栏，至少支持暂停 / 恢复 / 重试 / 标记阻塞 / 终止；依赖取消与终止语义先收口。
- [x] P1 `task-detail-operations-first` — 重排任务详情页第一屏，把主操作、当前负责人、blocker、下一步动作前置；依赖稳定的操作动作模型。
- [ ] P1 `execution-language-refresh` — 将“动态组队 / 方案叙事”收敛为“开发执行 / 协作交付 / 当前行动”，可与详情页重排并行推进。
- [ ] P2 `mission-ui-polish` — 打磨反馈时机、按钮层级、状态可见性、空态与错误态；依赖前述交互语义基本稳定后收尾。

### 交付顺序建议

1. 先打通取消与状态操作，保证任务生命周期可控。
2. 再重排详情页与核心文案，让用户第一屏就能判断“谁在负责、卡在哪里、下一步做什么”。
3. 最后统一 UI 反馈与状态表达，避免在交互语义未稳定前重复返工。

> 目标：把任务页从“执行结果展示”提升为“可操作的执行控制台”。

## 第四层：平台级能力（环境就绪后再做，不设时间承诺）

- [ ] L31 `production-deployment` — Docker Compose 生产部署（中）← 依赖 L22
- [ ] L32 `multi-user-office` — 多人实时协作（大）
- [ ] L33 `multi-tenant-architecture` — 多租户隔离（大）← 依赖 L25 + L31
- [ ] L34 `agent-marketplace-platform` — Agent 交易市场（大）← 依赖 L30 + L19
- [ ] L35 `k8s-agent-operator` — K8s Agent Operator（大）← 依赖 L31
- [ ] L36 `edge-brain-deployment` — 边缘部署（大）← 依赖 L31
- [ ] L37 `multi-region-disaster-recovery` — 多区域灾备（大）← 依赖 L31 + L35
- [ ] L38 `vr-extension` — VR 沉浸式扩展（大）← 依赖 L03

## Worktree 命名参考

```bash
# 阶段 0 不需要 worktree，在 main 上执行

# 第一层并行
git worktree add ../cpo-L01-demo-data feat/L01-demo-data-engine
git worktree add ../cpo-L02-demo-guide feat/L02-demo-guided-experience
git worktree add ../cpo-L03-scene-fusion feat/L03-scene-mission-fusion
git worktree add ../cpo-L04-export feat/L04-cross-framework-export
git worktree add ../cpo-L05-telemetry feat/L05-telemetry-dashboard
git worktree add ../cpo-L06-cost feat/L06-cost-observability
git worktree add ../cpo-L07-recovery feat/L07-state-persistence-recovery
git worktree add ../cpo-L08-replay feat/L08-collaboration-replay
git worktree add ../cpo-L09-vision feat/L09-multi-modal-vision

# 第二层并行
git worktree add ../cpo-L10-decoupling feat/L10-workflow-decoupling
git worktree add ../cpo-L11-planets feat/L11-mission-native-projection
git worktree add ../cpo-L12-skill feat/L12-plugin-skill-system
git worktree add ../cpo-L13-role feat/L13-dynamic-role-system
git worktree add ../cpo-L14-hitl feat/L14-human-in-the-loop
git worktree add ../cpo-L15-graph feat/L15-knowledge-graph
git worktree add ../cpo-L16-rag feat/L16-vector-db-rag-pipeline

# 第三层串行
git worktree add ../cpo-L22-executor feat/L22-lobster-executor-real
```

## 推荐执行时间线

### Day 1 上午：阶段 0 契约冻结（已完成 ✅）
```
C01-C08 全部完成，shared/ 下 8 个契约模块已冻结
```

### Day 1 下午：第一层 + 第二层前半段并行（15 个 Agent）
```
并行组 A: L01 + L02
并行组 B: L03 + L04
并行组 C: L05 + L06 + L07
并行组 D: L10 + L11
并行组 E: L12 + L13 + L14
独立: L08 + L09
```

### Day 2：第二层后半段 + 第三层 Docker 链路串行
```
并行组 F: L15 + L16
串行: L22 ✅ → L23 → L24
剩余 Agent: 集成测试 + 修接口不一致的缝隙
```

### Day 3+：按需推进（当前阶段）
```
第三层全部完成: L26 ✅ → L27 ✅ → L28 ✅
                L29 ✅ → L30 ✅
holographic-ui spec 已完成（tasks 1-8）
第四层 (L31-L38) 待环境就绪
```

### Day 4+：补完型 spec 与工程收口（当前实际）
```
workflow-artifacts-display 已完成功能开发：
  已完成 Artifact API / tasks-store 扩展 / ArtifactListBlock / ArtifactPreviewDialog
  已完成 WorkflowPanel / TaskDetailView 集成与 Socket 联动
  当前仅剩 tasks.md 中“最终检查点”未勾选，待补跑相关测试并完成验收

任务控制台补完主线待启动：
  P0: mission-cancel-control / mission-operator-actions
  P1: task-detail-operations-first / execution-language-refresh
  P2: mission-ui-polish

i18n-cleanup 未启动
frontend-demo-mode 待补 tasks.md
```

## 关键路径

```
C01-C08 契约冻结 (已完成)
  │
  ├──→ L01 ──→ L02 ──→ Frontend Mode 极致化 ✅
  │
  ├──→ L10 ──→ L11 ──→ 技术债清零 ✅
  │
  ├──→ L22 ✅ ──→ L23 ✅ ──→ Docker 执行闭环 ✅
  │             │
  │             ├──→ L24 ✅
  │             ├──→ L25 ✅
  │             ├──→ L22.5 ✅
  │             └──→ L24.5 ✅
  │
  ├──→ L18 ✅ ──→ L26 ✅ (autonomous-swarm)
  │
  ├──→ L14 ✅ ──→ L27 ✅ ──→ L28 ✅ (data-lineage-tracking)
  │
  └──→ L12 ✅ ──→ L29 ✅ ──→ L30 ✅ (agent-marketplace)
```

## 风险提示

1. Docker 链路（L22-L25）：L22 咽喉节点已完成，L23/L24/L25 已解锁，仍需真实环境调试
2. 第四层（L31-L38）没有真实多节点环境验证无意义，不建议急着做
3. 并行组内如果跳过阶段 0 的契约冻结，会导致接口不一致需要返工
4. L20 和 L21 虽然在第二层，但分别依赖第一层的 L09 和 L06，不能真正并行
5. 当前 TypeScript 基线未清零，新增 spec 若不控制编译回归，容易把补完型工作拖成全局修复
