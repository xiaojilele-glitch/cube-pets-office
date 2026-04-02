# Implementation Plan: 成本治理策略（Cost Governance Strategy）

## Overview

在已有 cost-observability 模块基础上，构建主动成本治理系统。实现顺序：共享类型 → 审计链 → 预算管理 → 告警系统 → 模型降级 → 并发限制 → 任务暂停与审批 → 成本预测 → 成本优化 → 成本分摊 → 成本报表 → 权限管理 → GovernanceEngine 编排 → REST API → Socket.IO → 前端 Store → 治理面板 → 动态组织集成。每个子系统独立实现并配套测试，最后通过 GovernanceEngine 统一编排。

## Tasks

- [x] 1. 共享类型定义
  - [x] 1.1 创建 `shared/cost-governance.ts`，定义所有成本治理相关 TypeScript 类型
    - 预算类型：BudgetType、BudgetPeriod、Currency、MissionBudget、AlertThresholdConfig、TokenBudgetByModel
    - 告警类型：AlertType、BudgetAlert、AlertResponseStrategy
    - 降级类型：ModelDowngradePolicy、DowngradeCondition、DowngradeRecord
    - 限流类型：ConcurrencyLevel、RateLevel、ConcurrencyLimitPolicy
    - 暂停/审批类型：TaskPausePolicy、ApprovalRequest、ApprovalAction、ApprovalStatus
    - 优化类型：CostOptimizationSuggestion、OptimizationType、RiskLevel
    - 预测类型：CostPrediction、PredictionMethod
    - 分摊类型：CostAllocation、AllocationTarget、AllocationType、AllocationDimension
    - 报表类型：CostReportRequest、CostReportResult、CostReportDataItem、CostAnomaly、TrendData
    - 预算层级：HierarchicalBudget、BudgetLevel、BudgetTemplate
    - 权限类型：CostPermission
    - 审计类型：AuditEntry、AuditAction
    - 治理快照：GovernanceSnapshot
    - 常量：EXCHANGE_RATES、CONCURRENCY_LIMITS、RATE_LIMITS、DOWNGRADE_CHAIN、DEFAULT_BUDGET_TEMPLATES
    - 工具函数：convertCurrency
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 3.1, 4.1, 5.1, 6.1, 9.1, 14.1_
  - [ ]* 1.2 编写币种转换往返属性测试
    - **Property 1: 币种转换往返一致性**
    - **Validates: Requirements 1.4**

- [x] 2. 审计链模块
  - [x] 2.1 创建 `server/core/governance/audit-trail.ts`，实现 AuditTrail 类
    - 实现 record(entry) 记录审计事件，自动生成 id 和 timestamp
    - 实现 query(filters) 按 missionId、action、userId、timeRange 过滤查询
    - 实现 persist() 持久化到 `data/cost-governance-audit.json`
    - 实现 load() 启动时加载历史审计数据
    - 导出 auditTrail 单例
    - _Requirements: 3.5, 4.4, 4.7, 5.6, 6.7, 7.5, 14.5_
  - [ ]* 2.2 编写审计链完整性属性测试
    - **Property 6: 审计链完整性**
    - **Validates: Requirements 3.5, 4.4, 4.7, 5.6, 6.7, 7.5, 14.5**

- [x] 3. 预算管理模块
  - [x] 3.1 创建 `server/core/governance/budget-manager.ts`，实现 BudgetManager 类
    - 实现 createBudget() 创建预算（自动版本控制）
    - 实现 updateBudget() 更新预算（检查修改幅度，超 20% 需审批）
    - 实现 validateHierarchy() 检查子预算不超过父预算
    - 实现 getTemplates() 返回预算模板列表
    - 实现 createFromTemplate() 从模板创建 MissionBudget
    - 实现 reconcile() 预算对账（计算预算与实际成本差异）
    - 实现 getVersionHistory() 获取预算版本历史
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_
  - [ ]* 3.2 编写预算层级约束属性测试
    - **Property 22: 预算层级约束**
    - **Validates: Requirements 11.1, 11.5**
  - [ ]* 3.3 编写预算模板实例化属性测试
    - **Property 23: 预算模板实例化**
    - **Validates: Requirements 11.2**
  - [ ]* 3.4 编写预算修改审批阈值属性测试
    - **Property 24: 预算修改审批阈值**
    - **Validates: Requirements 11.3, 11.4**

- [x] 4. 告警管理模块
  - [x] 4.1 创建 `server/core/governance/alert-manager.ts`，实现 AlertManager 类
    - 实现 evaluate() 根据 MissionBudget 的 alertThresholds 评估告警
    - 实现 executeResponse() 根据告警级别执行响应策略（LOG/REDUCE_CONCURRENCY/DOWNGRADE_MODEL/PAUSE_TASK）
    - 实现 notify() 通过 Socket.IO 和 Webhook 发送通知
    - 实现 getActiveAlerts() / resolveAlert() 管理告警生命周期
    - 支持自定义阈值覆盖默认阈值
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6_
  - [ ]* 4.2 编写告警类型与响应策略映射属性测试
    - **Property 5: 告警类型与响应策略映射**
    - **Validates: Requirements 3.2, 3.3, 3.6**

- [x] 5. Checkpoint - 基础模块验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. 模型降级管理模块
  - [x] 6.1 创建 `server/core/governance/downgrade-manager.ts`，实现 ModelDowngradeManager 类
    - 定义 DOWNGRADE_CHAIN 常量（gpt-4o → gpt-4o-mini → glm-4.6 → glm-5-turbo）
    - 实现 applyDowngrade() 执行降级（支持灰度百分比参数）
    - 实现 rollback() 降级回滚
    - 实现 getEffectiveModel() 根据降级状态返回有效模型
    - 实现 getRecords() 获取降级记录
    - 降级和回滚操作均记录到 AuditTrail
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_
  - [ ]* 6.2 编写降级链正确性属性测试
    - **Property 7: 降级链正确性**
    - **Validates: Requirements 4.2**
  - [ ]* 6.3 编写灰度降级比例属性测试
    - **Property 8: 灰度降级比例**
    - **Validates: Requirements 4.5**
  - [ ]* 6.4 编写降级失败自动回滚属性测试
    - **Property 9: 降级失败自动回滚**
    - **Validates: Requirements 4.6**
