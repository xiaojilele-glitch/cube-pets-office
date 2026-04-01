<!--
 * @Author: wangchunji
 * @Date: 2026-04-01 09:20:21
 * @Description: 
 * @LastEditTime: 2026-04-01 10:05:16
 * @LastEditors: wangchunji
-->
---
inclusion: auto
---

# Specs 执行顺序与依赖分析

## 总览

38 个 spec 中 8 个已完成（归档），30 个待开发。按依赖关系、是否可独立执行、是否需要服务器环境分为四个层级。核心策略：契约先行，再并行实现。

## 已完成归档模块

- [x] `workflow-engine` — 十阶段工作流引擎
- [x] `dynamic-organization` — 动态组织生成
- [x] `memory-system` — 三级记忆系统
- [x] `evolution-heartbeat` — 自进化与心跳
- [x] `mission-runtime` — Mission 任务域（核心部分）
- [x] `feishu-bridge` — 飞书集成
- [x] `browser-runtime` — 纯前端运行时
- [x] `frontend-3d` — 3D 场景与前端

## 阶段 0：契约先行（并行前必须完成，2-3 小时）

在任何并行实现开始前，需要一个中心 Agent 完成以下契约冻结：

- [x] 0.1 `demo-data-engine` 数据包 schema 冻结 → `shared/demo/contracts.ts`
  - DemoDataBundle 类型定义（工作流快照、组织快照、阶段事件时间线、评审评分、进化补丁）
  - demo-guided-experience 消费此 schema，必须先对齐
- [x] 0.2 事件总线格式统一 → `shared/telemetry/contracts.ts`
  - telemetry-dashboard、cost-observability、state-persistence-recovery 三个模块都读写系统状态
  - 约定事件名前缀、payload 结构、IndexedDB store key 命名规范
- [x] 0.3 Memory 读写接口分层 → `shared/memory/contracts.ts`
  - knowledge-graph 和 vector-db-rag-pipeline 都依赖 memory-system
  - 约定 Memory 的读接口（查询）和写接口（持久化）的分层边界，避免两个 Agent 各自 fork 一套访问逻辑
- [x] 0.4 workflow-decoupling 目标数据结构冻结 → `shared/mission/enrichment.ts`
  - 解耦后 MissionRecord 需要携带哪些丰富化字段（organization、workPackages、agentCrew、messageLog）
  - mission-native-projection 的 /api/planets 路由设计依赖此结构
- [x] 0.5 跨框架导出格式契约 → `shared/export/contracts.ts`
  - cross-framework-export 输出的 CrewAI/LangGraph/AutoGen 格式 schema 定义
  - 纯数据转换，但格式需要提前冻结

## 第一层：无依赖，可独立并行，纯前端可执行

### 并行组 A：Frontend Mode 极致化（核心优先）
- [ ] `demo-data-engine` — 预录演示数据引擎（小）⚠️ 阶段 0.1 schema 必须先完成
- [ ] `demo-guided-experience` — 演示回放引擎 + 引导 UI（小）⚠️ 消费 demo-data-engine 的 schema

### 并行组 B：3D 场景增强
- [ ] `scene-mission-fusion` — 将 Mission 状态融合进 3D 场景（中）
- [ ] `cross-framework-export` — 导出为 CrewAI/LangGraph/AutoGen 格式（中）⚠️ 阶段 0.5 格式契约先完成

### 并行组 C：可观测性（需先完成阶段 0.2 事件总线约定）
- [ ] `telemetry-dashboard` — 实时遥测仪表盘（中）
- [ ] `cost-observability` — 成本可观测性，Token 追踪 + 前端看板（中）
- [ ] `state-persistence-recovery` — 浏览器端长任务恢复（中）

### 独立可做
- [ ] `collaboration-replay` — Mission 执行过程录制与回放（中）
- [ ] `multi-modal-vision` — 图片理解能力，前端附件扩展（中）

## 第二层：需要服务端，不需要 Docker

### 并行组 D：技术债清理（应优先，⚠️ 阶段 0.4 必须先完成）
- [ ] `workflow-decoupling` — tasks-store 从双轨收口到 mission-first（中）
- [ ] `mission-native-projection` — /api/planets 路由实现 + 前端数据源切换（中）⚠️ 依赖 workflow-decoupling 的目标数据结构

### 并行组 E：Agent 能力增强
- [ ] `plugin-skill-system` — Skill 热插拔体系（中）
- [ ] `dynamic-role-system` — Agent 运行时角色切换（中）
- [ ] `human-in-the-loop` — 通用审批流 + 决策链（中）

### 并行组 F：记忆系统升级（⚠️ 阶段 0.3 必须先完成）
- [ ] `knowledge-graph` — 结构化知识图谱层（大）
- [ ] `vector-db-rag-pipeline` — 向量数据库 + RAG 管道（大）

### 独立可做
- [ ] `nl-command-center` — 自然语言指挥中心（大）
- [ ] `agent-autonomy-upgrade` — Agent 自评估 + 竞争执行（大）
- [ ] `agent-reputation` — Agent 信誉评分系统（中）
- [ ] `multi-modal-agent` — 语音 + Vision 统一编排（大）⚠️ 依赖第一层 multi-modal-vision
- [ ] `cost-governance-strategy` — 主动成本治理（中）⚠️ 依赖第一层 cost-observability

## 第三层：Docker 执行链路（严格串行，无法并行）

这条链是整个系统的咽喉。每一步都需要上一步的真实运行环境验证。Docker 网络配置、容器间通信、Volume 挂载权限等问题需要在真实环境反复调试，AI 写的 Docker 配置第一次跑通概率不高。

```
串行执行顺序（不可跳过）：
lobster-executor-real → secure-sandbox → sandbox-live-preview
                                      → agent-permission-model
```

- [ ] `lobster-executor-real` — Docker 真实容器生命周期（大）← 核心缺口，咽喉节点
- [ ] `secure-sandbox` — Docker 安全沙箱（中）← 严格依赖 lobster-executor-real
- [ ] `sandbox-live-preview` — 容器实时终端 + 截图预览（中）← 严格依赖 lobster-executor-real
- [ ] `agent-permission-model` — Agent 细粒度权限矩阵（中）← 严格依赖 secure-sandbox

### 第三层其他串行链路

```
agent-autonomy-upgrade → autonomous-swarm
human-in-the-loop → audit-chain → data-lineage-tracking
plugin-skill-system → a2a-protocol → agent-marketplace
```

- [ ] `autonomous-swarm` — 跨 Pod 自主协作（大）← 依赖 agent-autonomy-upgrade
- [ ] `audit-chain` — 不可篡改审计日志（中）← 依赖 human-in-the-loop
- [ ] `data-lineage-tracking` — 数据血缘追踪（中）← 依赖 audit-chain
- [ ] `a2a-protocol` — 跨框架 Agent 互操作协议（大）← 依赖 plugin-skill-system
- [ ] `agent-marketplace` — Guest Agent 机制（中）← 依赖 a2a-protocol

## 第四层：平台级能力（环境就绪后再做，不设时间承诺）

这些模块即使代码写完，没有真实的多节点环境验证也没有意义。等第三层 Docker 链路跑通、有真实部署环境后再推进。

- [ ] `production-deployment` — Docker Compose 生产部署（中）← 依赖 lobster-executor-real
- [ ] `multi-user-office` — 多人实时协作（大）
- [ ] `multi-tenant-architecture` — 多租户隔离（大）← 依赖 agent-permission-model + production-deployment
- [ ] `agent-marketplace-platform` — Agent 交易市场（大）← 依赖 agent-marketplace + agent-reputation
- [ ] `k8s-agent-operator` — K8s Agent Operator（大）← 依赖 production-deployment
- [ ] `edge-brain-deployment` — 边缘部署（大）← 依赖 production-deployment
- [ ] `multi-region-disaster-recovery` — 多区域灾备（大）← 依赖 production-deployment + k8s-agent-operator
- [ ] `vr-extension` — VR 沉浸式扩展（大）← 依赖 scene-mission-fusion

## 推荐执行时间线

### Day 1 上午：阶段 0 契约冻结（1 个中心 Agent，2-3 小时）
```
输出 5 份契约文档 → 所有并行 Agent 的"宪法"
```

### Day 1 下午：第一层 + 第二层前半段并行（15 个 Agent）
```
并行组 A: demo-data-engine + demo-guided-experience
并行组 B: scene-mission-fusion + cross-framework-export
并行组 C: telemetry-dashboard + cost-observability + state-persistence-recovery
并行组 D: workflow-decoupling + mission-native-projection
并行组 E: plugin-skill-system + dynamic-role-system + human-in-the-loop
独立: collaboration-replay + multi-modal-vision
```

### Day 2：第二层后半段 + 第三层 Docker 链路串行
```
并行组 F: knowledge-graph + vector-db-rag-pipeline
串行: lobster-executor-real → secure-sandbox → sandbox-live-preview
剩余 Agent: 集成测试 + 修接口不一致的缝隙
```

### Day 3+：按需推进
```
第三层剩余串行链路 + 第四层（等真实环境就绪）
```

## 关键路径

```
阶段 0 契约冻结
  │
  ├──→ demo-data-engine ──→ demo-guided-experience ──→ Frontend Mode 极致化
  │
  ├──→ workflow-decoupling ──→ mission-native-projection ──→ 技术债清零
  │
  └──→ lobster-executor-real ──→ secure-sandbox ──→ Docker 执行闭环
                                    │
                                    └──→ sandbox-live-preview
                                    └──→ agent-permission-model
```

## 风险提示

1. Docker 链路（第三层）是真正的瓶颈，dockerode 网络配置、容器间通信、Volume 挂载权限需要真实环境反复调试
2. 第四层平台级能力没有真实多节点环境验证无意义，不建议急着做
3. 并行组内如果跳过阶段 0 的契约冻结，会导致接口不一致需要返工
4. multi-modal-agent 和 cost-governance-strategy 虽然在第二层，但分别依赖第一层的 multi-modal-vision 和 cost-observability，不能真正并行
