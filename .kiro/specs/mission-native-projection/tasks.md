# 实施计划: Mission 原生投影

## 概述

采用增量迁移策略：先扩展数据模型，再实现服务端路由，然后扩展前端 client，最后重构 tasks-store。每个阶段都可独立验证，过渡期保留 fallback 机制。

## 任务

- [x] 1. 扩展 MissionRecord 数据模型
  - [x] 1.1 在 shared/mission/contracts.ts 中添加 MissionOrganizationSnapshot、MissionWorkPackage、MissionMessageLogEntry 接口定义
    - 添加三个新接口到 contracts.ts
    - 在 MissionRecord 接口中添加 organization?、workPackages?、messageLog? 可选字段
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 1.2 编写 MissionRecord 扩展字段的属性测试
    - **Property 6: 阶段状态转换合法性**
    - **Validates: Requirements 3.5**

- [x] 2. 实现 /api/planets 路由核心转换函数
  - [x] 2.1 创建 server/routes/planets.ts，实现 missionToPlanetOverview() 转换函数
    - 从 MissionRecord 映射到 MissionPlanetOverviewItem
    - 处理 complexity、radius、position、tags 等计算字段
    - _Requirements: 2.1, 2.2_

  - [x] 2.2 实现 buildPlanetInteriorStages() 环形几何计算函数
    - 从 MissionStage[] 计算 arcStart、arcEnd、midAngle
    - 确保 360 度均匀分配
    - _Requirements: 2.5_

  - [x] 2.3 编写环形几何计算的属性测试
    - **Property 3: 环形可视化几何不变量**
    - **Validates: Requirements 2.5**

  - [x] 2.4 实现 buildPlanetInteriorAgents() agent 推断函数
    - 从 workPackages 推断 worker agents
    - 始终包含 mission-core agent
    - 使用 withAgentAngles 计算角度
    - _Requirements: 2.6_

  - [x] 2.5 编写 agent 推断的属性测试
    - **Property 4: Agent 可视化有效性**
    - **Validates: Requirements 2.6**

- [x] 3. 实现 /api/planets 路由端点
  - [x] 3.1 实现 GET /api/planets 端点，返回 ListMissionPlanetsResponse
    - 调用 runtime.listTasks() 获取 MissionRecord[]
    - 使用 missionToPlanetOverview() 转换
    - 支持 limit 查询参数
    - _Requirements: 2.1, 2.4_

  - [x] 3.2 实现 GET /api/planets/:id 端点，返回 GetMissionPlanetResponse
    - 调用 runtime.getTask(id) 获取单个 MissionRecord
    - 404 处理
    - _Requirements: 2.2, 2.4_

  - [x] 3.3 实现 GET /api/planets/:id/interior 端点，返回 GetMissionPlanetInteriorResponse
    - 组合 buildPlanetInteriorStages + buildPlanetInteriorAgents + events
    - _Requirements: 2.3, 2.5, 2.6_

  - [x] 3.4 在 server/index.ts 中注册 /api/planets 路由
    - 导入 createPlanetRouter 并挂载到 app.use('/api/planets', ...)
    - _Requirements: 2.1_

  - [x] 3.5 编写 /api/planets 路由的单元测试
    - 参照 server/tests/mission-routes.test.ts 的模式
    - 测试三个端点的正常响应和 404 场景
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 4. 检查点 - 确保服务端测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [x] 5. MissionOrchestrator 数据丰富化
  - [x] 5.1 在 MissionOrchestrator.applyExecutorEvent() 中添加丰富化逻辑
    - 当检测到阶段完成事件时，提取 organization、workPackages、messageLog
    - 使用 replaceMission() 更新 MissionRecord
    - _Requirements: 3.4, 3.5_

  - [x] 5.2 编写丰富化逻辑的属性测试
    - **Property 5: 阶段完成时数据丰富化**
    - **Validates: Requirements 3.4**

- [x] 6. 扩展前端 mission-client.ts
  - [x] 6.1 在 mission-client.ts 中添加 listPlanets()、getPlanet()、getPlanetInterior() 函数
    - 导入 ListMissionPlanetsResponse、GetMissionPlanetResponse、GetMissionPlanetInteriorResponse 类型
    - 使用现有的 withQuery()、routeFor()、parseJson() 工具函数
    - _Requirements: 4.1_

- [x] 7. 重构 tasks-store.ts 使用 Planet API
  - [x] 7.1 新增 buildPlanetSummaryRecord() 函数，从 MissionPlanetOverviewItem 映射到 MissionTaskSummary
    - 映射 planet.tags → departmentLabels
    - 从关联的 MissionRecord 提取 taskCount、messageCount 等
    - _Requirements: 1.1, 1.5_

  - [x] 7.2 新增 buildPlanetDetailRecord() 函数，从 MissionPlanetInteriorData 映射到 MissionTaskDetail
    - 映射 interior.stages → TaskStageRing[]
    - 映射 interior.agents → TaskInteriorAgent[]
    - 构建 timeline、artifacts、decisionPresets
    - _Requirements: 1.2_

  - [x] 7.3 编写摘要构建器的属性测试
    - **Property 1: Mission 原生摘要完整性**
    - **Validates: Requirements 1.1, 1.4, 1.5**

  - [x] 7.4 编写详情构建器的属性测试
    - **Property 2: Mission 原生详情完整性**
    - **Validates: Requirements 1.2**

  - [x] 7.5 新增 hydratePlanetTaskData() 函数，使用 listPlanets() 替代 listMissions() + workflow 补充
    - 调用 listPlanets() 获取概览数据
    - 对选中任务调用 getPlanetInterior() 获取详情
    - _Requirements: 4.2, 4.3, 4.5_

  - [x] 7.6 修改 hydrateTaskData() 入口函数，优先使用 hydratePlanetTaskData()，失败时 fallback 到 hydrateMissionTaskData()
    - try/catch 包裹 hydratePlanetTaskData()
    - catch 中 console.warn 并调用 hydrateMissionTaskData()
    - _Requirements: 4.4_

- [x] 8. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [x] 9. 集成验证与 UI 兼容性
  - [x] 9.1 验证 tasks-store 输出与 UI 组件的兼容性
    - 确保 MissionTaskSummary 所有字段类型与 TasksPage、TaskDetailPage 期望一致
    - 确保 MissionTaskDetail 的 stages、agents 字段与 TaskPlanetInterior 组件兼容
    - _Requirements: 1.4_

  - [x] 9.2 编写端到端集成测试
    - 创建 mission → 通过 /api/planets 获取 → 验证 tasks-store 输出
    - _Requirements: 1.1, 1.2, 2.1, 4.2_

- [x] 10. 最终检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

## 备注

- 标记 `*` 的任务为可选，可跳过以加速 MVP
- 每个任务引用具体需求以确保可追溯性
- 检查点确保增量验证
- 属性测试验证通用正确性属性
- 单元测试验证具体示例和边界情况
- 阶段三清理（移除 workflow 依赖代码）将在后续迭代中进行，不在本计划范围内
