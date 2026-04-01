<!--
 * @Author: wangchunji
 * @Date: 2026-04-01 09:20:21
 * @Description: 
 * @LastEditTime: 2026-04-01 16:02:57
 * @LastEditors: wangchunji
-->
---
inclusion: auto
---

# Specs 执行顺序与依赖分析

## 总览

38 个 spec 中 8 个已完成（归档），30 个待开发。按依赖关系、是否可独立执行、是否需要服务器环境分为四个层级。核心策略：契约先行，再并行实现。

## 已完成归档模块

- [x] P00 `workflow-engine` — 十阶段工作流引擎
- [x] P01 `dynamic-organization` — 动态组织生成
- [x] P02 `memory-system` — 三级记忆系统
- [x] P03 `evolution-heartbeat` — 自进化与心跳
- [x] P04 `mission-runtime` — Mission 任务域（核心部分）
- [x] P05 `feishu-bridge` — 飞书集成
- [x] P06 `browser-runtime` — 纯前端运行时
- [x] P07 `frontend-3d` — 3D 场景与前端

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
- [ ] L05 `telemetry-dashboard` — 实时遥测仪表盘（中）
- [ ] L06 `cost-observability` — 成本可观测性，Token 追踪 + 前端看板（中）
- [ ] L07 `state-persistence-recovery` — 浏览器端长任务恢复（中）

### 独立可做
- [ ] L08 `collaboration-replay` — Mission 执行过程录制与回放（中）
- [ ] L09 `multi-modal-vision` — 图片理解能力，前端附件扩展（中）

## 第二层：需要服务端，不需要 Docker

### 并行组 D：技术债清理（应优先，⚠️ C04 必须先完成）
- [ ] L10 `workflow-decoupling` — tasks-store 从双轨收口到 mission-first（中）
- [ ] L11 `mission-native-projection` — /api/planets 路由实现 + 前端数据源切换（中）⚠️ 依赖 L10 的目标数据结构

### 并行组 E：Agent 能力增强
- [ ] L12 `plugin-skill-system` — Skill 热插拔体系（中）⚠️ C08 Skill 注册制契约先完成
- [ ] L13 `dynamic-role-system` — Agent 运行时角色切换（中）
- [ ] L14 `human-in-the-loop` — 通用审批流 + 决策链（中）

### 并行组 F：记忆系统升级（⚠️ C03 + C07 必须先完成）
- [ ] L15 `knowledge-graph` — 结构化知识图谱层（大）
- [ ] L16 `vector-db-rag-pipeline` — 向量数据库 + RAG 管道（大）

### 独立可做
- [ ] L17 `nl-command-center` — 自然语言指挥中心（大）
- [ ] L18 `agent-autonomy-upgrade` — Agent 自评估 + 竞争执行（大）
- [ ] L19 `agent-reputation` — Agent 信誉评分系统（中）
- [ ] L20 `multi-modal-agent` — 语音 + Vision 统一编排（大）⚠️ 依赖 L09 multi-modal-vision
- [ ] L21 `cost-governance-strategy` — 主动成本治理（中）⚠️ 依赖 L06 cost-observability

## 第三层：Docker 执行链路（严格串行，无法并行）

```
串行执行顺序（不可跳过）：
L22 → L23 → L24
            → L25
```

- [ ] L22 `lobster-executor-real` — Docker 真实容器生命周期（大）← 核心缺口，咽喉节点
- [ ] L23 `secure-sandbox` — Docker 安全沙箱（中）← 严格依赖 L22
- [ ] L24 `sandbox-live-preview` — 容器实时终端 + 截图预览（中）← 严格依赖 L22
- [ ] L25 `agent-permission-model` — Agent 细粒度权限矩阵（中）← 严格依赖 L23

### 第三层其他串行链路

```
L18 → L26
L14 → L27 → L28
L12 → L29 → L30
```

- [ ] L26 `autonomous-swarm` — 跨 Pod 自主协作（大）← 依赖 L18 agent-autonomy-upgrade
- [ ] L27 `audit-chain` — 不可篡改审计日志（中）← 依赖 L14 human-in-the-loop
- [ ] L28 `data-lineage-tracking` — 数据血缘追踪（中）← 依赖 L27 audit-chain
- [ ] L29 `a2a-protocol` — 跨框架 Agent 互操作协议（大）← 依赖 L12 plugin-skill-system
- [ ] L30 `agent-marketplace` — Guest Agent 机制（中）← 依赖 L29 a2a-protocol

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
串行: L22 → L23 → L24
剩余 Agent: 集成测试 + 修接口不一致的缝隙
```

### Day 3+：按需推进
```
第三层剩余串行链路 (L26-L30) + 第四层 (L31-L38)
```

## 关键路径

```
C01-C08 契约冻结 (已完成)
  │
  ├──→ L01 ──→ L02 ──→ Frontend Mode 极致化
  │
  ├──→ L10 ──→ L11 ──→ 技术债清零
  │
  └──→ L22 ──→ L23 ──→ Docker 执行闭环
                 │
                 ├──→ L24
                 └──→ L25
```

## 风险提示

1. Docker 链路（L22-L25）是真正的瓶颈，需要真实环境反复调试
2. 第四层（L31-L38）没有真实多节点环境验证无意义，不建议急着做
3. 并行组内如果跳过阶段 0 的契约冻结，会导致接口不一致需要返工
4. L20 和 L21 虽然在第二层，但分别依赖第一层的 L09 和 L06，不能真正并行
