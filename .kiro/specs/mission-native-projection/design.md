# 设计文档: Mission 原生投影

## 概述

本设计将任务驾驶舱的数据架构从双源（MissionRecord + WorkflowRecord）迁移为 Mission 原生单源。核心变更包括：

1. 丰富 MissionRecord 数据模型，嵌入 organization、workPackages、messageLog
2. 实现 /api/planets 路由，提供 Mission 原生的星球概览和内部数据
3. 迁移 mission-client.ts，添加 planets API 调用函数
4. 重构 tasks-store.ts，从 planets API 获取数据，移除 workflow 投影依赖

迁移采用增量策略：先添加新能力，再逐步替换旧路径，过渡期保留 fallback。

## 架构

### 当前架构（迁移前）

```mermaid
graph TD
    UI[UI Components] --> TS[tasks-store.ts]
    TS --> MC[mission-client.ts]
    TS --> WS[workflow-store.ts]
    MC --> API_T[/api/tasks]
    WS --> API_W[/api/workflows]
    API_T --> MS[MissionStore]
    API_W --> DB[(Workflow DB)]
    TS -->|合成| Summary[MissionTaskSummary]
    TS -->|合成| Detail[MissionTaskDetail]
```

### 目标架构（迁移后）

```mermaid
graph TD
    UI[UI Components] --> TS[tasks-store.ts]
    TS --> MC[mission-client.ts]
    MC --> API_P[/api/planets]
    MC --> API_T[/api/tasks]
    API_P --> MS[MissionStore]
    API_T --> MS
    TS -->|直接映射| Summary[MissionTaskSummary]
    TS -->|直接映射| Detail[MissionTaskDetail]
```

### 数据流变更

迁移前：`UI → tasks-store → (mission-client + workflow-store) → (MissionStore + WorkflowDB) → 合成 Summary/Detail`

迁移后：`UI → tasks-store → mission-client → /api/planets → MissionStore → 直接映射 Summary/Detail`

## 组件与接口

### 1. MissionRecord 扩展字段（shared/mission/contracts.ts）

在 MissionRecord 接口中添加三个可选字段：

```typescript
// 新增到 MissionRecord 接口
interface MissionRecord {
  // ... 现有字段 ...
  organization?: MissionOrganizationSnapshot;
  workPackages?: MissionWorkPackage[];
  messageLog?: MissionMessageLogEntry[];
}

interface MissionOrganizationSnapshot {
  departments: Array<{
    key: string;
    label: string;
    managerName?: string;
  }>;
  agentCount: number;
}

interface MissionWorkPackage {
  id: string;
  title: string;
  assignee?: string;
  stageKey: string;
  status: "pending" | "running" | "passed" | "failed" | "verified";
  score?: number;
  deliverable?: string;
  feedback?: string;
}

interface MissionMessageLogEntry {
  sender: string;
  content: string;
  time: number;
  stageKey?: string;
}
```

### 2. /api/planets 路由（server/routes/planets.ts）

新建路由文件，实现三个端点：

```typescript
// GET /api/planets
function listPlanets(runtime: MissionRuntime): Handler {
  // 从 runtime.listTasks() 获取 MissionRecord[]
  // 转换为 MissionPlanetOverviewItem[]
  // 返回 ListMissionPlanetsResponse
}

// GET /api/planets/:id
function getPlanet(runtime: MissionRuntime): Handler {
  // 从 runtime.getTask(id) 获取 MissionRecord
  // 转换为 MissionPlanetOverviewItem
  // 返回 GetMissionPlanetResponse
}

// GET /api/planets/:id/interior
function getPlanetInterior(runtime: MissionRuntime): Handler {
  // 从 runtime.getTask(id) 获取 MissionRecord
  // 构建 MissionPlanetInteriorData:
  //   - stages: 从 mission.stages 计算 arc 几何值
  //   - agents: 从 mission.organization + workPackages 推断
  //   - events: 从 runtime.listTaskEvents(id) 获取
  //   - summary, waitingFor: 直接从 mission 取
  // 返回 GetMissionPlanetInteriorResponse
}
```

#### MissionRecord → MissionPlanetOverviewItem 转换逻辑

```typescript
function missionToPlanetOverview(
  mission: MissionRecord
): MissionPlanetOverviewItem {
  const stageCount = mission.stages.length;
  const completedStages = mission.stages.filter(
    s => s.status === "done"
  ).length;
  return {
    id: mission.id,
    title: mission.title,
    sourceText: mission.sourceText,
    summary: mission.summary,
    kind: mission.kind,
    status: mission.status,
    progress: mission.progress,
    complexity: stageCount, // 阶段数作为复杂度指标
    radius: 30 + stageCount * 5, // 基础半径 + 阶段数缩放
    position: { x: 0, y: 0 }, // 由前端布局引擎计算
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
    completedAt: mission.completedAt,
    currentStageKey: mission.currentStageKey,
    currentStageLabel: mission.stages.find(
      s => s.key === mission.currentStageKey
    )?.label,
    waitingFor: mission.waitingFor,
    taskUrl: `/tasks/${mission.id}`,
    tags: mission.organization?.departments.map(d => d.label) ?? [],
  };
}
```

#### 环形可视化几何计算

```typescript
function buildPlanetInteriorStages(
  stages: MissionStage[]
): MissionPlanetInteriorStage[] {
  const count = stages.length;
  if (count === 0) return [];
  const arcSize = 360 / count;
  return stages.map((stage, index) => {
    const arcStart = index * arcSize;
    const arcEnd = arcStart + arcSize;
    return {
      key: stage.key,
      label: stage.label,
      status: stage.status,
      progress:
        stage.status === "done" ? 100 : stage.status === "running" ? 50 : 0,
      detail: stage.detail,
      startedAt: stage.startedAt,
      completedAt: stage.completedAt,
      arcStart,
      arcEnd,
      midAngle: (arcStart + arcEnd) / 2,
    };
  });
}
```

#### Agent 推断逻辑

```typescript
function buildPlanetInteriorAgents(
  mission: MissionRecord,
  interiorStages: MissionPlanetInteriorStage[]
): MissionPlanetInteriorAgent[] {
  const agents: MissionPlanetInteriorAgent[] = [];

  // 从 workPackages 推断 agent
  if (mission.workPackages) {
    const assignees = new Map<string, MissionWorkPackage[]>();
    for (const wp of mission.workPackages) {
      if (!wp.assignee) continue;
      const list = assignees.get(wp.assignee) ?? [];
      list.push(wp);
      assignees.set(wp.assignee, list);
    }
    for (const [name, packages] of assignees) {
      const activePackage =
        packages.find(p => p.status === "running") ?? packages[0];
      const stage = interiorStages.find(s => s.key === activePackage.stageKey);
      agents.push({
        id: name,
        name,
        role: "worker",
        sprite: "cube-worker",
        status: inferAgentStatus(activePackage.status),
        stageKey: activePackage.stageKey,
        stageLabel: stage?.label ?? activePackage.stageKey,
        progress: activePackage.score,
        currentAction: activePackage.deliverable,
        angle: 0, // 后续由 withAgentAngles 计算
      });
    }
  }

  // 始终添加 mission-core agent
  agents.push({
    id: "mission-core",
    name: "Mission Core",
    role: "orchestrator",
    sprite: "cube-brain",
    status: inferCoreAgentStatus(mission.status),
    stageKey: mission.currentStageKey ?? "receive",
    stageLabel:
      interiorStages.find(s => s.key === mission.currentStageKey)?.label ??
      "Receive",
    angle: 0,
  });

  return withAgentAngles(agents, interiorStages);
}
```

### 3. mission-client.ts 扩展

```typescript
// 新增函数
export async function listPlanets(limit = 200): Promise<ListMissionPlanetsResponse> { ... }
export async function getPlanet(id: string): Promise<GetMissionPlanetResponse> { ... }
export async function getPlanetInterior(id: string): Promise<GetMissionPlanetInteriorResponse> { ... }
```

### 4. tasks-store.ts 迁移策略

#### 阶段一：添加 Planet API 支持

- 新增 `hydratePlanetTaskData()` 函数，使用 `listPlanets()` 获取数据
- 新增 `buildPlanetSummaryRecord()` 函数，从 MissionPlanetOverviewItem 映射到 MissionTaskSummary
- 新增 `buildPlanetDetailRecord()` 函数，从 MissionPlanetInteriorData 映射到 MissionTaskDetail

#### 阶段二：切换默认数据源

- `hydrateTaskData()` 优先调用 `hydratePlanetTaskData()`
- 失败时 fallback 到 `hydrateMissionTaskData()`

#### 阶段三：清理（后续迭代）

- 移除 workflow-store 依赖
- 移除 `syntheticWorkflowFromMission()`、`loadMissionSupplementMap()` 等函数
- 移除 WorkflowRecord 相关类型

### 5. MissionOrchestrator 丰富化钩子

在 `applyExecutorEvent()` 中，当检测到阶段完成事件时，将 workflow 数据嵌入 MissionRecord：

```typescript
// 在 MissionOrchestrator.applyExecutorEvent() 中
if (event.status === "stage_completed" || event.status === "completed") {
  // 从 executor 事件中提取 organization、workPackages、messageLog
  // 更新 MissionRecord 的对应字段
  record = replaceMission(record, {
    organization: extractOrganization(event),
    workPackages: extractWorkPackages(event),
    messageLog: extractMessageLog(event),
  });
}
```

## 数据模型

### MissionRecord 扩展

| 字段         | 类型                         | 说明                           |
| ------------ | ---------------------------- | ------------------------------ |
| organization | MissionOrganizationSnapshot? | 组织快照：部门列表、agent 数量 |
| workPackages | MissionWorkPackage[] ?       | 工作包：任务分配、交付物、评分 |
| messageLog   | MissionMessageLogEntry[]?    | 消息日志：最近的消息摘要       |

### MissionPlanetOverviewItem 映射

| Planet 字段       | 来源                                       |
| ----------------- | ------------------------------------------ |
| id                | mission.id                                 |
| title             | mission.title                              |
| status            | mission.status                             |
| progress          | mission.progress                           |
| complexity        | mission.stages.length                      |
| radius            | 30 + stages.length \* 5                    |
| position          | { x: 0, y: 0 }（前端计算）                 |
| currentStageKey   | mission.currentStageKey                    |
| currentStageLabel | stages.find(currentStageKey).label         |
| waitingFor        | mission.waitingFor                         |
| tags              | organization.departments.map(d => d.label) |

### MissionTaskSummary 映射（从 Planet API）

| Summary 字段       | 来源                                            |
| ------------------ | ----------------------------------------------- |
| departmentLabels   | planet.tags                                     |
| taskCount          | mission.workPackages.length                     |
| completedTaskCount | workPackages.filter(passed/verified).length     |
| messageCount       | mission.messageLog.length                       |
| activeAgentCount   | interior.agents.filter(working/thinking).length |

## 正确性属性

_正确性属性是在系统所有有效执行中都应成立的特征或行为——本质上是关于系统应该做什么的形式化陈述。属性是人类可读规范与机器可验证正确性保证之间的桥梁。_

### Property 1: Mission 原生摘要完整性

_For any_ MissionRecord with populated stages, events, and optional organization/workPackages/messageLog fields, the summary builder SHALL produce a valid MissionTaskSummary where all fields are non-undefined, departmentLabels derives from organization.departments, taskCount derives from workPackages.length, completedTaskCount derives from workPackages filtered by passed/verified status, messageCount derives from messageLog.length, and activeAgentCount derives from organization.agentCount or stage-based inference.

**Validates: Requirements 1.1, 1.4, 1.5**

### Property 2: Mission 原生详情完整性

_For any_ MissionRecord with populated stages, events, artifacts, and optional enrichment fields, the detail builder SHALL produce a valid MissionTaskDetail where stages array matches buildPlanetInteriorStages output, agents array contains at least the mission-core agent, timeline derives from events, and artifacts derives from mission.artifacts.

**Validates: Requirements 1.2**

### Property 3: 环形可视化几何不变量

_For any_ non-empty MissionStage array of length N, buildPlanetInteriorStages SHALL produce N MissionPlanetInteriorStage entries where: (a) arcStart of the first stage equals 0, (b) arcEnd of the last stage equals 360, (c) for each stage, arcEnd - arcStart equals 360/N, (d) for each stage, midAngle equals (arcStart + arcEnd) / 2, (e) for consecutive stages, stage[i].arcEnd equals stage[i+1].arcStart (no gaps or overlaps).

**Validates: Requirements 2.5**

### Property 4: Agent 可视化有效性

_For any_ MissionRecord with stages and optional workPackages, buildPlanetInteriorAgents SHALL produce an agent array where: (a) every agent.stageKey exists in the stages array, (b) every agent.status is one of 'idle' | 'working' | 'thinking' | 'done' | 'error', (c) every agent.angle is in the range [0, 360), (d) the array always contains at least one agent with id 'mission-core'.

**Validates: Requirements 2.6**

### Property 5: 阶段完成时数据丰富化

_For any_ MissionRecord in 'running' status with a stage transitioning to 'done', when the orchestrator processes the stage completion with organization/workPackages/messageLog data, the resulting MissionRecord SHALL contain the provided organization, workPackages, and messageLog fields.

**Validates: Requirements 3.4**

### Property 6: 阶段状态转换合法性

_For any_ sequence of stage update operations on a MissionRecord, each stage's status SHALL only transition along the allowed paths: pending → running, running → done, running → failed. A stage SHALL NOT transition from done or failed to any other status, and SHALL NOT skip from pending directly to done or failed.

**Validates: Requirements 3.5**

## 错误处理

### /api/planets 路由

| 场景                  | 处理方式                                      |
| --------------------- | --------------------------------------------- |
| Mission ID 不存在     | 返回 404 `{ error: 'Planet not found' }`      |
| MissionStore 内部错误 | 返回 500 `{ error: 'Internal server error' }` |
| 无效的 limit 参数     | 使用默认值 20，不报错                         |

### mission-client.ts

| 场景        | 处理方式                        |
| ----------- | ------------------------------- |
| 网络错误    | 抛出 Error，由 tasks-store 捕获 |
| 非 200 响应 | 解析 error 字段，抛出 Error     |

### tasks-store.ts Fallback

| 场景                     | 处理方式                                           |
| ------------------------ | -------------------------------------------------- |
| listPlanets() 失败       | 回退到 hydrateMissionTaskData()，console.warn 记录 |
| getPlanetInterior() 失败 | 使用 buildMissionInteriorStages() 本地计算         |
| 两种路径都失败           | 设置 error 状态，显示错误提示                      |

## 测试策略

### 单元测试

使用 vitest 框架，覆盖以下场景：

- **planets 路由测试**（server/tests/planet-routes.test.ts）
  - GET /api/planets 返回正确的 ListMissionPlanetsResponse 结构
  - GET /api/planets/:id 返回正确的 GetMissionPlanetResponse 结构
  - GET /api/planets/:id/interior 返回正确的 GetMissionPlanetInteriorResponse 结构
  - 不存在的 ID 返回 404
  - 空 MissionStore 返回空数组

- **MissionRecord 丰富化测试**
  - 阶段完成时 organization 字段被正确填充
  - workPackages 和 messageLog 字段被正确填充
  - 丰富化不影响现有字段

- **mission-client 测试**
  - listPlanets/getPlanet/getPlanetInterior 函数正确调用端点
  - 错误响应正确抛出异常

### 属性测试

使用 fast-check 库，每个属性测试运行至少 100 次迭代。

- **Property 1 测试**: 生成随机 MissionRecord（含 organization/workPackages/messageLog），验证摘要构建器输出完整性
  - Tag: **Feature: mission-native-projection, Property 1: Mission 原生摘要完整性**

- **Property 2 测试**: 生成随机 MissionRecord（含 events/artifacts），验证详情构建器输出完整性
  - Tag: **Feature: mission-native-projection, Property 2: Mission 原生详情完整性**

- **Property 3 测试**: 生成随机长度的 MissionStage 数组，验证 arc 几何不变量
  - Tag: **Feature: mission-native-projection, Property 3: 环形可视化几何不变量**

- **Property 4 测试**: 生成随机 MissionRecord（含 stages 和 workPackages），验证 agent 数组有效性
  - Tag: **Feature: mission-native-projection, Property 4: Agent 可视化有效性**

- **Property 5 测试**: 生成随机 MissionRecord 和阶段完成数据，验证丰富化结果
  - Tag: **Feature: mission-native-projection, Property 5: 阶段完成时数据丰富化**

- **Property 6 测试**: 生成随机阶段状态转换序列，验证只有合法转换被接受
  - Tag: **Feature: mission-native-projection, Property 6: 阶段状态转换合法性**
