# 实现计划: 自然语言指挥中心 (NL Command Center)

## 概述

基于设计文档，将自然语言指挥中心分解为增量式编码任务。每个任务构建在前一个任务之上，从共享类型定义开始，逐步实现核心服务、REST API、Socket 事件和前端界面。测试任务作为子任务嵌入对应的实现任务中。

## 任务

- [ ] 1. 定义共享类型和契约
  - [ ] 1.1 创建 `shared/nl-command/contracts.ts`，定义所有核心类型
    - 包含 StrategicCommand, CommandAnalysis, ClarificationDialog, FinalizedCommand, MissionDecomposition, DecomposedMission, MissionDependency, TaskDecomposition, DecomposedTask, TaskDependency
    - 包含 NLExecutionPlan, PlanTimeline, TimelineEntry, ResourceAllocation, RiskAssessment, CostBudget, ContingencyPlan
    - 包含 PlanApprovalRequest, ApprovalDecision, PlanAdjustment, AdjustmentChange
    - 包含 Alert, AlertRule, AlertCondition, AlertType, AlertPriority
    - 包含 Comment, CommentVersion, AuditEntry, AuditQueryFilter, AuditOperationType
    - 包含 PlanTemplate, TemplateVersion, ExecutionMetrics, OptimizationReport
    - 包含 Permission, UserRole, PermissionConfig
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 7.1, 8.1, 10.1, 16.2, 17.1_
  - [ ] 1.2 创建 `shared/nl-command/socket.ts`，定义 Socket.IO 事件常量
    - _Requirements: 9.4_
  - [ ] 1.3 创建 `shared/nl-command/api.ts`，定义 REST API 路由常量和请求/响应类型
    - _Requirements: 所有 API 相关需求_
  - [ ] 1.4 创建 `shared/nl-command/index.ts` 模块导出
  - [ ]* 1.5 编写 StrategicCommand 和 NLExecutionPlan 结构完整性属性测试
    - **Property 1: StrategicCommand 结构完整性**
    - **Property 7: 分解输出结构完整性**
    - **Validates: Requirements 1.1, 3.2, 3.3, 4.2, 4.3**

- [ ] 2. 实现审计链 (Audit Trail)
  - [ ] 2.1 创建 `server/core/nl-command/audit-trail.ts`
    - 实现 AuditTrail 类：record(), query(), export()
    - 使用本地 JSON 文件持久化 (`data/nl-audit.json`)
    - 支持按时间范围、操作者、操作类型、实体 ID 过滤
    - 支持 JSON 导出
    - _Requirements: 16.1, 16.2, 16.3, 16.4_
  - [ ]* 2.2 编写审计查询过滤属性测试
    - **Property 17: 审计查询过滤正确性**
    - **Validates: Requirements 16.1, 16.3**
  - [ ]* 2.3 编写审计导出 JSON 往返属性测试
    - **Property 18: 审计导出 JSON 往返一致性**
    - **Validates: Requirements 16.4**
  - [ ]* 2.4 编写审计链单元测试
    - 测试 record/query/export 基本功能
    - 测试边界条件（空过滤、大量条目）
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

- [ ] 3. 实现权限控制
  - [ ] 3.1 创建 `server/core/nl-command/permission-guard.ts`
    - 实现 PermissionGuard 类：checkPermission(), getPermissions()
    - 定义角色-权限映射（admin/manager/operator/viewer）
    - 支持实体级细粒度权限覆盖
    - _Requirements: 17.1, 17.2, 17.3_
  - [ ]* 3.2 编写权限执行属性测试
    - **Property 16: 权限执行正确性**
    - **Validates: Requirements 17.1, 17.2, 17.3**

- [ ] 4. Checkpoint - 基础设施层验证
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. 实现指令解析器 (Command Analyzer)
  - [ ] 5.1 创建 `server/core/nl-command/command-analyzer.ts`
    - 实现 CommandAnalyzer 类：analyze(), generateClarificationQuestions(), updateAnalysis(), finalize()
    - 调用 LLM 解析指令意图、约束、目标
    - 检测歧义并生成澄清问题
    - 集成 AuditTrail 记录操作
    - _Requirements: 1.2, 1.3, 1.4, 2.2, 2.4, 2.5_
  - [ ] 5.2 创建 `server/core/nl-command/clarification-dialog.ts`
    - 实现 ClarificationDialogManager 类：createDialog(), addAnswer(), isComplete()
    - 支持自由文本和选择式回答
    - 集成 AuditTrail 记录澄清过程
    - _Requirements: 2.1, 2.3, 2.6_
  - [ ]* 5.3 编写澄清对话属性测试
    - **Property 4: 澄清对话接受两种回答类型**
    - **Property 5: 澄清更新分析并最终确认**
    - **Validates: Requirements 2.3, 2.4, 2.5**
  - [ ]* 5.4 编写指令解析器单元测试
    - Mock LLM 测试解析结构
    - 测试澄清问题生成
    - 测试 FinalizedCommand 生成
    - _Requirements: 1.2, 1.3, 2.2, 2.4, 2.5_

- [ ] 6. 实现 Mission 分解器
  - [ ] 6.1 创建 `server/core/nl-command/mission-decomposer.ts`
    - 实现 MissionDecomposer 类：decompose(), generateOrganization()
    - 调用 LLM 生成 Mission 列表
    - 识别依赖关系，生成拓扑排序的执行顺序
    - 检测循环依赖并报告
    - 通过 MissionOrchestrator 创建 MissionRecord
    - 触发动态组织生成
    - 集成 AuditTrail
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 14.1, 14.2, 14.3_
  - [ ] 6.2 创建 `server/core/nl-command/task-decomposer.ts`
    - 实现 TaskDecomposer 类：decompose()
    - 调用 LLM 生成 Task 列表
    - 识别依赖关系，生成执行顺序
    - 集成 AuditTrail
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6_
  - [ ] 6.3 创建 `server/core/nl-command/topo-sort.ts`
    - 实现通用拓扑排序工具函数
    - 支持循环检测
    - 支持并行分组（同层可并行的节点归为一组）
    - _Requirements: 3.5, 4.5_
  - [ ]* 6.4 编写拓扑排序属性测试
    - **Property 6: 分解执行顺序拓扑排序正确性**
    - **Validates: Requirements 3.4, 3.5, 4.4, 4.5**
  - [ ]* 6.5 编写分解器单元测试
    - Mock LLM 测试分解逻辑
    - 测试循环依赖检测
    - 测试组织生成触发
    - _Requirements: 3.2, 3.4, 4.2, 4.4, 14.1_

- [ ] 7. 实现执行计划生成器
  - [ ] 7.1 创建 `server/core/nl-command/execution-plan-generator.ts`
    - 实现 ExecutionPlanGenerator 类：generate(), adjustPlan(), computeCriticalPath()
    - 生成时间线（关键路径算法）
    - 生成资源分配
    - 调用 LLM 生成风险评估
    - 计算成本预算
    - 生成应急计划
    - 集成 AuditTrail
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 15.1, 15.2_
  - [ ]* 7.2 编写成本预算求和属性测试
    - **Property 8: 成本预算求和不变量**
    - **Validates: Requirements 5.5, 15.5**
  - [ ]* 7.3 编写关键路径属性测试
    - **Property 9: 时间线关键路径有效性**
    - **Validates: Requirements 5.2**
  - [ ]* 7.4 编写执行计划生成器单元测试
    - 测试时间线计算
    - 测试资源分配
    - 测试成本预算
    - _Requirements: 5.2, 5.3, 5.5_

- [ ] 8. Checkpoint - 核心服务层验证
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. 实现审批管理器
  - [ ] 9.1 创建 `server/core/nl-command/plan-approval.ts`
    - 实现 PlanApproval 类：createApprovalRequest(), submitApproval(), isApprovalComplete()
    - 支持多级审批
    - 集成 AuditTrail
    - _Requirements: 7.1, 7.2, 7.4, 7.5, 7.6_
  - [ ]* 9.2 编写审批工作流属性测试
    - **Property 10: 审批工作流完整性**
    - **Validates: Requirements 7.2, 7.5, 8.4, 11.5, 15.3**
  - [ ]* 9.3 编写审批管理器单元测试
    - 测试多级审批流程
    - 测试拒绝和修改意见
    - _Requirements: 7.2, 7.4, 7.5_

- [ ] 10. 实现动态调整器
  - [ ] 10.1 创建 `server/core/nl-command/plan-adjustment.ts`
    - 实现 PlanAdjustmentManager 类：proposeAdjustment(), applyAdjustment()
    - 实现偏差检测逻辑
    - 集成审批流程
    - 集成 AuditTrail
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6_
  - [ ]* 10.2 编写偏差检测属性测试
    - **Property 24: 偏差检测正确性**
    - **Validates: Requirements 8.2**
  - [ ]* 10.3 编写计划调整属性测试
    - **Property 11: 计划调整更新不变量**
    - **Validates: Requirements 8.5**

- [ ] 11. 实现告警引擎
  - [ ] 11.1 创建 `server/core/nl-command/alert-engine.ts`
    - 实现 AlertEngine 类：registerRule(), evaluate(), notify()
    - 支持 5 种告警类型
    - 支持自定义规则
    - 同类告警 5 分钟去重
    - 通过 Socket.IO 推送
    - 集成 AuditTrail
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_
  - [ ]* 11.2 编写告警规则评估属性测试
    - **Property 12: 告警规则评估正确性**
    - **Validates: Requirements 10.3, 10.4**
  - [ ]* 11.3 编写告警引擎单元测试
    - 测试规则注册和评估
    - 测试去重逻辑
    - _Requirements: 10.1, 10.3, 10.4_

- [ ] 12. 实现决策支持引擎
  - [ ] 12.1 创建 `server/core/nl-command/decision-support.ts`
    - 实现 DecisionSupportEngine 类：analyzeRisks(), suggestCostOptimization(), suggestResourceAdjustment(), collectExecutionData(), generateOptimizationReport()
    - 调用 LLM 生成建议
    - 收集执行指标
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 20.1, 20.2, 20.5_
  - [ ]* 12.2 编写执行指标收集属性测试
    - **Property 21: 执行指标收集与偏差计算**
    - **Validates: Requirements 20.1, 20.2**
  - [ ]* 12.3 编写成本对比属性测试
    - **Property 23: 计划与实际对比正确性**
    - **Validates: Requirements 13.4**

- [ ] 13. 实现协作和评论
  - [ ] 13.1 创建 `server/core/nl-command/comment-manager.ts`
    - 实现 CommentManager 类：addComment(), editComment(), getComments(), parseMetions()
    - 支持版本历史
    - 支持 @mention 解析
    - 集成权限控制
    - 集成 AuditTrail
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
  - [ ]* 13.2 编写评论 CRUD 属性测试
    - **Property 14: 评论 CRUD 与版本历史**
    - **Validates: Requirements 12.1, 12.3**
  - [ ]* 13.3 编写 @mention 解析属性测试
    - **Property 15: @mention 解析正确性**
    - **Validates: Requirements 12.2**

- [ ] 14. 实现报告生成和模板
  - [ ] 14.1 创建 `server/core/nl-command/report-generator.ts`
    - 实现 ReportGenerator 类：generate(), export(), compare()
    - 支持 Markdown 和 JSON 导出
    - 支持计划与实际对比
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_
  - [ ] 14.2 创建 `server/core/nl-command/template-manager.ts`
    - 实现 TemplateManager 类：save(), load(), list(), update()
    - 支持版本管理
    - _Requirements: 19.3, 19.4, 19.5_
  - [ ]* 14.3 编写报告结构属性测试
    - **Property 22: 报告结构完整性与格式正确性**
    - **Validates: Requirements 13.1, 13.2**
  - [ ]* 14.4 编写模板往返属性测试
    - **Property 19: 模板保存/加载往返一致性**
    - **Validates: Requirements 19.3, 19.4**

- [ ] 15. Checkpoint - 服务层完整验证
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. 实现 REST API 路由
  - [ ] 16.1 创建 `server/routes/nl-command.ts`
    - 实现所有 REST API 端点
    - 指令管理：POST/GET /api/nl-command/commands, GET /api/nl-command/commands/:id
    - 澄清对话：POST /api/nl-command/commands/:id/clarify, GET /api/nl-command/commands/:id/dialog
    - 执行计划：GET /api/nl-command/plans/:id, POST approve/adjust
    - 监控与告警：GET dashboard/alerts, POST alerts/rules
    - 决策支持：GET risks/suggestions, POST apply-suggestion
    - 协作：POST/GET comments
    - 报告：GET/POST reports
    - 历史与模板：GET history/templates, POST templates
    - 审计：GET audit, POST audit/export
    - 集成权限检查中间件
    - _Requirements: 所有 API 相关需求_
  - [ ] 16.2 在 `server/index.ts` 中注册 nl-command 路由
    - _Requirements: 所有 API 相关需求_
  - [ ]* 16.3 编写 REST API 路由单元测试
    - 使用 supertest 测试各端点
    - 测试请求验证和错误响应
    - _Requirements: 所有 API 相关需求_

- [ ] 17. 实现 Socket.IO 事件集成
  - [ ] 17.1 创建 `server/core/nl-command/socket-emitter.ts`
    - 实现 NLCommandSocketEmitter 类
    - 封装所有 nl_command_* 事件的发送
    - 集成到各服务组件中
    - _Requirements: 9.4_
  - [ ] 17.2 在 `server/core/socket.ts` 中注册 nl-command 命名空间事件
    - _Requirements: 9.4_

- [ ] 18. 实现指挥中心编排器（串联所有服务）
  - [ ] 18.1 创建 `server/core/nl-command/orchestrator.ts`
    - 实现 NLCommandOrchestrator 类
    - 串联完整流程：指令提交 → 解析 → 澄清 → 分解 → 计划生成 → 审批 → 执行 → 监控
    - 管理 StrategicCommand 生命周期状态机
    - 集成所有子服务
    - _Requirements: 所有需求_
  - [ ] 18.2 创建 `server/core/nl-command/index.ts` 模块导出和初始化
    - _Requirements: 所有需求_

- [ ] 19. Checkpoint - 服务端完整验证
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 20. 实现前端 Zustand Store
  - [ ] 20.1 创建 `client/src/lib/nl-command-store.ts`
    - 实现 NLCommandStore（Zustand）
    - 管理指令列表、当前指令、执行计划、告警、评论等状态
    - 封装 REST API 调用
    - 监听 Socket.IO nl_command_* 事件实时更新
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [ ] 20.2 创建 `client/src/lib/nl-command-client.ts`
    - 封装所有 NL Command REST API 调用
    - _Requirements: 所有 API 相关需求_
  - [ ]* 20.3 编写过滤和排序属性测试
    - **Property 13: 过滤和排序正确性**
    - **Validates: Requirements 9.5**

- [ ] 21. 实现指挥中心主界面
  - [ ] 21.1 创建 `client/src/pages/nl-command/CommandCenterPage.tsx`
    - 四区布局：指令输入区、计划展示区、实时监控区、决策支持区
    - 支持全屏模式和多面板布局
    - _Requirements: 18.1, 18.6_
  - [ ] 21.2 创建 `client/src/components/nl-command/CommandInput.tsx`
    - 自然语言文本输入组件
    - 支持历史指令自动补全
    - 支持澄清对话交互
    - _Requirements: 18.2, 2.3_
  - [ ] 21.3 创建 `client/src/components/nl-command/ClarificationPanel.tsx`
    - 澄清对话面板
    - 支持自由文本和选择式回答
    - _Requirements: 2.3_

- [ ] 22. 实现计划可视化组件
  - [ ] 22.1 创建 `client/src/components/nl-command/GanttChart.tsx`
    - 甘特图组件，展示 Mission/Task 时间线
    - 标记关键路径
    - 支持缩放和拖拽
    - _Requirements: 6.1_
  - [ ] 22.2 创建 `client/src/components/nl-command/DependencyGraph.tsx`
    - 依赖关系图组件
    - 展示 Mission/Task 之间的依赖关系
    - _Requirements: 6.2_
  - [ ] 22.3 创建 `client/src/components/nl-command/ResourceChart.tsx`
    - 资源分配图组件
    - _Requirements: 6.3_
  - [ ] 22.4 创建 `client/src/components/nl-command/RiskHeatMap.tsx`
    - 风险热力图组件
    - _Requirements: 6.4_
  - [ ] 22.5 创建 `client/src/components/nl-command/CostChart.tsx`
    - 成本分布图组件
    - _Requirements: 6.5_

- [ ] 23. 实现监控和告警前端组件
  - [ ] 23.1 创建 `client/src/components/nl-command/DashboardMetrics.tsx`
    - 关键指标卡片（总 Mission 数、完成率、活跃 Task、风险等级）
    - _Requirements: 9.1_
  - [ ] 23.2 创建 `client/src/components/nl-command/MissionList.tsx`
    - Mission 列表组件，支持过滤和排序
    - 支持钻取查看详情
    - _Requirements: 9.2, 9.5, 9.6_
  - [ ] 23.3 创建 `client/src/components/nl-command/AlertPanel.tsx`
    - 告警面板组件
    - 实时展示告警
    - _Requirements: 10.2_

- [ ] 24. 实现决策支持和协作前端组件
  - [ ] 24.1 创建 `client/src/components/nl-command/SuggestionPanel.tsx`
    - 决策建议面板
    - 支持一键应用建议
    - _Requirements: 11.4, 18.5_
  - [ ] 24.2 创建 `client/src/components/nl-command/ApprovalDialog.tsx`
    - 审批对话框
    - 支持查看完整计划、提交审批意见
    - _Requirements: 7.3, 7.4_
  - [ ] 24.3 创建 `client/src/components/nl-command/CommentThread.tsx`
    - 评论线程组件
    - 支持 @mention
    - 支持版本历史查看
    - _Requirements: 12.1, 12.2, 12.3_

- [ ] 25. 实现历史和模板前端组件
  - [ ] 25.1 创建 `client/src/components/nl-command/HistoryPanel.tsx`
    - 历史指令列表
    - 支持基于历史创建新指令
    - _Requirements: 19.1, 19.2_
  - [ ] 25.2 创建 `client/src/components/nl-command/TemplateManager.tsx`
    - 模板管理组件
    - 支持保存、加载、版本管理
    - _Requirements: 19.3, 19.4, 19.5_
  - [ ]* 25.3 编写历史克隆属性测试
    - **Property 20: 历史指令克隆产生新 ID**
    - **Validates: Requirements 19.2**

- [ ] 26. 实现报告前端组件
  - [ ] 26.1 创建 `client/src/components/nl-command/ReportView.tsx`
    - 报告展示组件
    - 支持计划与实际对比视图
    - 支持导出 Markdown/JSON
    - _Requirements: 13.1, 13.2, 13.4, 13.5_

- [ ] 27. 路由集成和导航
  - [ ] 27.1 在 `client/src/App.tsx` 中添加 `/command-center` 路由
    - _Requirements: 18.1_
  - [ ] 27.2 在 `client/src/components/Toolbar.tsx` 中添加指挥中心入口
    - _Requirements: 18.1_

- [ ] 28. Checkpoint - 前端完整验证
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 29. 审计链记录集成测试
  - [ ]* 29.1 编写审计链记录属性测试
    - **Property 3: 审计链记录不变量**
    - **Validates: Requirements 1.4, 2.6, 3.6, 4.6, 7.6, 8.6, 10.5, 12.5, 17.4**
    - 测试所有可审计操作后审计链正确记录

- [ ] 30. 最终 Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP
- 每个任务引用具体的需求编号以确保可追溯性
- Checkpoint 确保增量验证
- 属性测试验证通用正确性属性
- 单元测试验证具体示例和边界条件
- LLM 调用在测试中使用 mock provider
- 前端组件使用 shadcn/ui 基础组件库
