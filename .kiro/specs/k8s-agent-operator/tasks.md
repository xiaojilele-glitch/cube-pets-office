# 实现计划：K8s Agent Operator

## 概述

基于设计文档，将 AgentOperator 的实现分为 10 个主要任务，从项目脚手架搭建开始，逐步实现 CRD 类型定义、核心 Reconciler、子资源管理、自动扩缩容、Webhook、监控指标、REST API、迁移工具，最后集成测试。使用 TypeScript + `@kubernetes/client-node` + vitest + fast-check。

## Tasks

- [ ] 1. 项目脚手架和核心类型定义
  - [ ] 1.1 创建 `services/k8s-agent-operator/` 目录结构，初始化 `package.json`（依赖：`@kubernetes/client-node`、`prom-client`、`express`、`ws`、`js-yaml`、`fast-check`、`vitest`），创建 `tsconfig.json` 和 `vitest.config.ts`
    - _Requirements: 项目基础设施_
  - [ ] 1.2 实现 `src/types/agent-deployment.ts`：定义 AgentDeploymentSpec、ScalingSpec、AgentDeploymentStatus、ProbeConfig 等 TypeScript 接口和类型守卫函数
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [ ]* 1.3 编写 CRD schema round-trip 属性测试
    - **Property 1: AgentDeployment CRD 序列化 round-trip**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
  - [ ] 1.4 实现 `src/utils/logger.ts`：结构化 JSON Logger，支持 LOG_LEVEL 环境变量配置
    - _Requirements: 15.4, 15.5_
  - [ ]* 1.5 编写 Logger 格式属性测试
    - **Property 8: 结构化日志格式正确性**
    - **Validates: Requirements 15.4, 15.5**
  - [ ] 1.6 实现 `src/utils/event-recorder.ts`：Kubernetes Event 记录器
    - _Requirements: 2.5, 6.6, 8.5_

- [ ] 2. Reconciler 核心逻辑和 Pod 管理
  - [ ] 2.1 实现 `src/controller/reconciler.ts`：主 reconcile 入口、ensureNamespace、updateStatus 方法
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 11.2, 11.3_
  - [ ] 2.2 实现 `buildPodSpec` 方法：根据 AgentDeployment 构建 Pod spec，包含 labels、resources、env、probes、affinity、ownerReference
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 13.1, 13.2, 13.3, 13.4_
  - [ ]* 2.3 编写 Pod spec 忠实性属性测试
    - **Property 2: Pod spec 忠实反映 AgentDeployment 配置**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 13.2, 13.3, 13.4**
  - [ ]* 2.4 编写 ownerReference 属性测试
    - **Property 3: 子资源 ownerReference 正确性**
    - **Validates: Requirements 3.1, 4.5, 5.5**
  - [ ] 2.5 实现 `reconcilePods` 方法：比较期望 Pod 数量与实际数量，创建或删除 Pod
    - _Requirements: 2.2, 2.4_
  - [ ]* 2.6 编写 Pod 数量一致性属性测试
    - **Property 14: 协调后 Pod 数量一致性**
    - **Validates: Requirements 2.2, 2.4**

- [ ] 3. Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 4. Service 和 ConfigMap 管理
  - [ ] 4.1 实现 `reconcileService` 方法：创建/更新 Service，设置 selector、ports、type、ownerReference
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [ ]* 4.2 编写 Service spec 忠实性属性测试
    - **Property 4: Service spec 忠实反映 AgentDeployment 配置**
    - **Validates: Requirements 4.2, 4.3, 4.4**
  - [ ] 4.3 实现 `reconcileConfigMap` 方法：创建/更新 ConfigMap，设置 data、volume 挂载、ownerReference，检测内容变化触发 Pod 重启
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [ ]* 4.4 编写 ConfigMap 忠实性属性测试
    - **Property 5: ConfigMap 忠实反映 AgentDeployment 配置**
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [ ] 5. 多租户隔离和资源配额
  - [ ] 5.1 实现 `ensureResourceQuota` 方法：为租户 namespace 创建 ResourceQuota（限制 pods、cpu、memory）
    - _Requirements: 11.5, 12.1, 12.2_
  - [ ] 5.2 实现 `ensureNetworkPolicy` 方法：为租户 namespace 创建 NetworkPolicy（限制跨 namespace 访问）
    - _Requirements: 11.4_
  - [ ]* 5.3 编写租户隔离资源完整性属性测试
    - **Property 12: 租户隔离资源完整性**
    - **Validates: Requirements 11.2, 11.3, 11.4, 11.5, 12.1, 12.2**
  - [ ]* 5.4 编写 ResourceQuota 超限告警单元测试
    - 测试超过配额时的 Warning Event 创建
    - _Requirements: 12.4_

- [ ] 6. 自动扩缩容
  - [ ] 6.1 实现 `src/scaler/metrics-client.ts`：从 Metrics Server 获取 CPU/内存指标，从 Pod /metrics 端点获取队列长度
    - _Requirements: 6.2, 7.1, 7.3_
  - [ ] 6.2 实现 `src/scaler/scaler.ts`：`calculateDesiredReplicas` 方法（基于 CPU/内存/队列长度计算期望副本数，限制变化量 ≤50%，限制在 [min, max] 范围内）
    - _Requirements: 6.3, 6.4, 6.5, 7.4, 7.5, 7.6, 8.4_
  - [ ]* 6.3 编写扩缩容计算属性测试
    - **Property 6: 扩缩容计算正确性**
    - **Validates: Requirements 6.3, 6.4, 6.5, 7.4, 7.5, 7.6, 8.4**
  - [ ] 6.4 实现 `CooldownTracker`：记录上次扩缩容时间，判断是否在冷却期内
    - _Requirements: 8.1, 8.2, 8.3_
  - [ ]* 6.5 编写冷却期属性测试
    - **Property 7: 冷却期阻止扩缩容**
    - **Validates: Requirements 8.2, 8.3**
  - [ ] 6.6 实现 `evaluate` 和 `applyScaling` 方法：定时评估所有 AgentDeployment，执行扩缩容并记录 Event
    - _Requirements: 6.6, 8.5_

- [ ] 7. Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 8. 滚动更新、回滚和健康监控
  - [ ] 8.1 实现 `rollingUpdate` 方法：逐个替换 Pod，遵守 maxSurge/maxUnavailable，通过 version label 区分蓝绿版本
    - _Requirements: 10.1, 10.2, 10.3, 10.4_
  - [ ] 8.2 实现 `recreateUpdate` 方法：先删除所有旧 Pod 再创建新 Pod
    - _Requirements: 10.1_
  - [ ] 8.3 实现 `rollback` 方法：新版本 readiness probe 超时后自动回滚到旧版本
    - _Requirements: 10.5_
  - [ ] 8.4 实现 Pod 健康监控：监听 Pod 状态事件，检测 CrashLoopBackOff 并创建告警 Event
    - _Requirements: 9.1, 9.2, 9.5_
  - [ ]* 8.5 编写滚动更新和回滚单元测试
    - 测试 maxSurge/maxUnavailable 行为、蓝绿 label、回滚触发
    - _Requirements: 10.2, 10.3, 10.4, 10.5_

- [ ] 9. Webhook 验证和变更
  - [ ] 9.1 实现 `src/webhook/webhook-server.ts`：Express HTTPS 服务器，处理 AdmissionReview 请求
    - _Requirements: 16.1_
  - [ ] 9.2 实现 `validate` 方法：验证必填字段、数值合法性、image 格式、resources 约束
    - _Requirements: 16.1, 16.2, 16.3_
  - [ ]* 9.3 编写 Webhook 验证属性测试
    - **Property 9: Webhook 验证拒绝无效配置**
    - **Validates: Requirements 16.1, 16.2, 16.3**
  - [ ] 9.4 实现 `mutate` 方法：注入默认 livenessProbe、添加 managed-by label 和 creation-timestamp annotation
    - _Requirements: 16.4, 16.5_
  - [ ]* 9.5 编写 Webhook 变更属性测试
    - **Property 10: Webhook 变更注入默认值**
    - **Validates: Requirements 16.4, 16.5**

- [ ] 10. Prometheus 指标导出
  - [ ] 10.1 实现 `src/metrics/metrics-exporter.ts`：使用 `prom-client` 注册所有指标（gauge/counter/histogram），暴露 /metrics 端点
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_
  - [ ]* 10.2 编写指标完整性属性测试
    - **Property 13: Prometheus 指标完整性**
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4**
  - [ ] 10.3 在 Reconciler 和 Scaler 中集成 MetricsExporter，在协调和扩缩容操作时更新指标
    - _Requirements: 14.1, 14.2, 14.3_

- [ ] 11. Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 12. REST API 和 WebSocket
  - [ ] 12.1 实现 `src/api/api-server.ts`：Express 服务器，注册 REST 路由（GET /api/deployments、GET /api/deployments/:ns/:name/pods、GET /api/deployments/:ns/:name/scaling-history、GET /api/deployments/:ns/:name/events、GET /api/tenants/:ns/quota）
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 12.5_
  - [ ] 12.2 实现 WebSocket 服务器：监听 AgentDeployment 和 Pod 状态变化，推送 deployment:status-changed、pod:status-changed、scaling:event 事件
    - _Requirements: 18.5_
  - [ ]* 12.3 编写 REST API 端点单元测试
    - 测试各端点的响应格式和数据正确性
    - _Requirements: 18.1, 18.2, 18.3, 18.4_

- [ ] 13. Docker Compose 迁移工具
  - [ ] 13.1 实现 `src/migration/migration-tool.ts`：解析 docker-compose.yml，转换 services/environment/volumes/ports 到 AgentDeployment，设置默认值，输出 YAML
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_
  - [ ]* 13.2 编写迁移转换属性测试
    - **Property 11: Docker Compose 迁移转换正确性**
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5**

- [ ] 14. Controller 主入口和集成
  - [ ] 14.1 实现 `src/controller/controller.ts`：创建 Informer 监听 AgentDeployment 事件，管理工作队列，调用 Reconciler
    - _Requirements: 2.1, 2.5_
  - [ ] 14.2 实现 `src/index.ts`：Operator 主入口，初始化 KubeConfig、Controller、Scaler、WebhookServer、MetricsExporter、ApiServer，启动所有组件
    - _Requirements: 全部_
  - [ ] 14.3 创建 CRD YAML 文件 `deploy/crd.yaml`：AgentDeployment CRD 定义（apiVersion: agent.io/v1alpha1）
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [ ] 14.4 创建部署 YAML 文件 `deploy/operator.yaml`：Operator Deployment、ServiceAccount、ClusterRole、ClusterRoleBinding、Webhook 配置
    - _Requirements: 全部_

- [ ] 15. 最终 Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

## Notes

- 标记 `*` 的任务为可选测试任务，可跳过以加速 MVP
- 每个任务引用了具体的需求编号，确保可追溯性
- Checkpoint 任务确保增量验证
- 属性测试使用 fast-check 库，每个属性至少运行 100 次迭代
- 单元测试使用 vitest，覆盖具体示例和边界情况
- 所有 K8s API 调用在测试中通过 mock 实现，不需要真实集群
