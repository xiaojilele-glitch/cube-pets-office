# 审计链 / 不可篡改日志 任务清单

- [ ] 1. 定义审计链契约层 (shared/audit/)
  - [ ] 1.1 定义 AuditEventType 枚举和 AuditSeverity、AuditCategory 类型
  - [ ] 1.2 定义 AuditEventTypeDefinition 及默认事件类型注册表（含 severity/category/description）
  - [ ] 1.3 定义 AuditEvent 接口（eventId/eventType/timestamp/actor/action/resource/result/context/metadata/lineageId）
  - [ ] 1.4 定义 AuditLogEntry 接口（entryId/sequenceNumber/event/previousHash/currentHash/nonce/timestamp/signature）
  - [ ] 1.5 定义 VerificationResult 和 VerificationError 接口
  - [ ] 1.6 定义 AuditQueryFilters、PageOptions、AuditQueryResult 接口
  - [ ] 1.7 定义 RetentionPolicy 及默认保留策略（CRITICAL 7年/WARNING 3年/INFO 1年）
  - [ ] 1.8 定义 AnomalyAlert 和 AnomalyRule 接口
  - [ ] 1.9 定义 ComplianceFramework、ComplianceRequirement、ComplianceReport、ComplianceGap 接口
  - [ ] 1.10 定义审计 REST API 路由常量 (shared/audit/api.ts)
  - [ ] 1.11 定义审计 Socket 事件常量 (shared/audit/socket.ts)
  - [ ] 1.12 模块导出 (shared/audit/index.ts)

- [ ] 2. 实现 AuditChain 哈希链引擎 (server/audit/audit-chain.ts)
  - [ ] 2.1 实现 ECDSA-P256 密钥管理（加载环境变量 / 自动生成 / 持久化到 data/audit/keys/）
  - [ ] 2.2 实现 computeHash()：SHA-256 哈希计算（event + timestamp + previousHash + nonce）
  - [ ] 2.3 实现 signEntry()：ECDSA-P256 签名
  - [ ] 2.4 实现 append()：生成 AuditLogEntry（计算哈希 → 签名 → 追加到存储）
  - [ ] 2.5 实现 getLatestHash() / getEntry() / getEntries()
  - [ ] 2.6 实现创世条目（genesis entry）：previousHash = "0"

- [ ] 3. 实现 AuditStore Append-Only 存储 (server/audit/audit-store.ts)
  - [ ] 3.1 实现 WAL 文件写入（JSONL 格式，data/audit/chain.wal）
  - [ ] 3.2 实现 appendEntry()：追加条目到 WAL（文件锁 + fsync）
  - [ ] 3.3 实现 readEntries()：按序号范围读取条目
  - [ ] 3.4 实现 getEntryCount() / getLastEntry()
  - [ ] 3.5 实现索引文件维护（data/audit/chain.idx，entryId → 偏移量）
  - [ ] 3.6 实现启动时从 WAL 恢复内存索引

- [ ] 4. 实现 TimestampProvider 时间源 (server/audit/timestamp-provider.ts)
  - [ ] 4.1 实现 now()：返回双时间戳（system + trusted + skew）
  - [ ] 4.2 实现 NTP 偏移估算（开发环境）
  - [ ] 4.3 实现 verifyTimestamp()：检查系统时间与可信时间偏差 < 1秒
  - [ ] 4.4 实现时间倒退检测和告警

- [ ] 5. 实现 AuditCollector 事件采集器 (server/audit/audit-collector.ts)
  - [ ] 5.1 实现 record()：异步缓冲写入（INFO/WARNING 事件）
  - [ ] 5.2 实现 recordSync()：同步写入（CRITICAL 事件）
  - [ ] 5.3 实现缓冲策略（100ms 或 50 条批量刷新）
  - [ ] 5.4 实现 flush()：手动刷新缓冲区
  - [ ] 5.5 实现采集失败 fallback（写入 data/audit/buffer.jsonl + 定时重试）

- [ ] 6. 实现 AuditVerifier 完整性验证器 (server/audit/audit-verifier.ts)
  - [ ] 6.1 实现 verifyEntry()：验证单条日志的哈希和签名
  - [ ] 6.2 实现 verifyChain()：验证指定范围的哈希链连续性 + 签名 + 时间戳顺序 + 序号连续性
  - [ ] 6.3 实现 verifyTimestamps()：验证时间戳单调递增
  - [ ] 6.4 实现 schedulePeriodicVerification()：定期验证（默认每小时）
  - [ ] 6.5 实现验证失败告警（通过 Socket audit_verification 广播）

- [ ] 7. 实现 AuditQuery 查询引擎 (server/audit/audit-query.ts)
  - [ ] 7.1 实现 query()：多条件过滤 + 分页查询
  - [ ] 7.2 实现 search()：全文搜索（关键词匹配 action/resource/metadata）
  - [ ] 7.3 实现 getPermissionTrail()：Agent 权限变更历史
  - [ ] 7.4 实现 getPermissionViolations()：权限违规事件查询
  - [ ] 7.5 实现 getDataLineageAudit()：数据血缘关联审计事件
  - [ ] 7.6 实现查询操作自身的审计记录（AUDIT_QUERY 事件）

- [ ] 8. 实现 AnomalyDetector 异常检测 (server/audit/anomaly-detector.ts)
  - [ ] 8.1 实现规则引擎框架（AnomalyRule 注册 + 匹配）
  - [ ] 8.2 实现内置规则：异常访问频率、异常时间访问、权限提升滥用、暴力破解模式、批量导出
  - [ ] 8.3 实现 detectAnomalies()：在指定时间窗口内运行所有规则
  - [ ] 8.4 实现告警生成和状态管理（open/acknowledged/resolved/dismissed）
  - [ ] 8.5 实现告警写入审计链（ANOMALY_DETECTED 事件）

- [ ] 9. 实现 ComplianceMapper 合规映射 (server/audit/compliance-mapper.ts)
  - [ ] 9.1 定义合规框架映射数据（SOC2/GDPR/PCI-DSS/HIPAA/ISO27001 → 事件类型）
  - [ ] 9.2 实现 mapToFramework()：获取框架要求与事件类型的映射
  - [ ] 9.3 实现 generateReport()：生成合规报告（覆盖范围/评分/缺口/风险事件）
  - [ ] 9.4 实现 getComplianceScore()：计算合规性评分

- [ ] 10. 实现 AuditExport 导出模块 (server/audit/audit-export.ts)
  - [ ] 10.1 实现 exportLog()：JSON 格式导出（含哈希链和签名）
  - [ ] 10.2 实现 exportLog()：CSV 格式导出
  - [ ] 10.3 实现导出文件完整性验证信息（总哈希 + 签名）
  - [ ] 10.4 实现导出操作审计记录（AUDIT_EXPORT 事件）

- [ ] 11. 实现 AuditRetention 保留和归档 (server/audit/audit-retention.ts)
  - [ ] 11.1 实现 applyRetentionPolicy()：按 severity 执行归档和删除
  - [ ] 11.2 实现 archiveEntries()：生成归档包（日志 + 哈希链 + 签名 + 时间戳）
  - [ ] 11.3 实现 verifyArchive()：验证归档包完整性
  - [ ] 11.4 实现删除前最终验证 + 删除操作审计记录（AUDIT_DELETE 事件）

- [ ] 12. 实现审计 REST API (server/routes/audit.ts)
  - [ ] 12.1 GET /api/audit/events：查询审计日志（多条件过滤 + 分页）
  - [ ] 12.2 GET /api/audit/events/:id：获取单条审计日志详情
  - [ ] 12.3 GET /api/audit/events/search：全文搜索
  - [ ] 12.4 POST /api/audit/verify：手动触发审计链验证
  - [ ] 12.5 GET /api/audit/verify/status：获取最近验证结果
  - [ ] 12.6 GET /api/audit/stats：审计统计信息
  - [ ] 12.7 GET /api/audit/export：导出审计日志
  - [ ] 12.8 POST /api/audit/compliance/report：生成合规报告
  - [ ] 12.9 GET /api/audit/anomalies：获取异常告警
  - [ ] 12.10 PATCH /api/audit/anomalies/:id：更新告警状态
  - [ ] 12.11 GET /api/audit/permissions/:agentId：Agent 权限变更历史
  - [ ] 12.12 GET /api/audit/permissions/violations：权限违规事件
  - [ ] 12.13 GET /api/audit/lineage/:dataId：数据血缘关联审计
  - [ ] 12.14 GET /api/audit/retention/policies：获取保留策略
  - [ ] 12.15 POST /api/audit/retention/archive：手动触发归档

- [ ] 13. 实现 Socket 事件广播
  - [ ] 13.1 audit_event：新审计事件写入时广播
  - [ ] 13.2 audit_anomaly：异常检测告警广播
  - [ ] 13.3 audit_verification：定期验证结果广播

- [ ] 14. 实现与现有模块的集成钩子
  - [ ] 14.1 工作流引擎集成：在 workflow-engine.ts 关键阶段注入审计采集
  - [ ] 14.2 Mission 编排器集成：在 mission-orchestrator.ts 关键操作注入审计采集
  - [ ] 14.3 动态组织生成集成：在 dynamic-organization.ts 注入审计采集
  - [ ] 14.4 消息总线集成：在 message-bus.ts 越级拒绝时注入审计采集
  - [ ] 14.5 记忆系统集成：在 memory/ 模块数据访问时注入审计采集
  - [ ] 14.6 飞书集成：在 feishu/bridge.ts 鉴权和任务启动时注入审计采集

- [ ] 15. 实现前端审计面板
  - [ ] 15.1 audit-store.ts：Zustand store（审计日志列表/详情/过滤/分页/Socket 监听）
  - [ ] 15.2 AuditPanel.tsx：审计日志主面板（事件列表 + 过滤 + 搜索）
  - [ ] 15.3 AuditTimeline.tsx：事件时间线可视化
  - [ ] 15.4 AuditChainVerifier.tsx：审计链完整性验证可视化（哈希链图 + 签名状态）
  - [ ] 15.5 AnomalyAlertPanel.tsx：异常告警面板（告警列表 + 风险等级 + 响应建议）
  - [ ] 15.6 路由注册和 Toolbar 入口

- [ ] 16. 单元测试
  - [ ] 16.1 audit-chain.test.ts：哈希链引擎测试（append/hash/sign/verify）
  - [ ] 16.2 audit-store.test.ts：WAL 存储测试（append/read/index/recovery）
  - [ ] 16.3 audit-collector.test.ts：采集器测试（缓冲/刷新/fallback/CRITICAL 同步写入）
  - [ ] 16.4 audit-verifier.test.ts：验证器测试（链验证/签名验证/时间戳验证/篡改检测）
  - [ ] 16.5 audit-query.test.ts：查询引擎测试（多条件过滤/分页/全文搜索）
  - [ ] 16.6 anomaly-detector.test.ts：异常检测测试（规则匹配/告警生成）
  - [ ] 16.7 audit-routes.test.ts：REST API 测试

- [ ] 17. 属性测试 (Property-Based Testing)
  - [ ] 17.1 P-1 哈希链连续性：任意相邻条目 entry[n+1].previousHash === entry[n].currentHash **验证: AC-3.2**
  - [ ] 17.2 P-2 哈希不可伪造：重新计算哈希值必须与 currentHash 一致 **验证: AC-3.3**
  - [ ] 17.3 P-3 Append-Only 不变量：链长度只能单调递增，已写入条目不可修改 **验证: AC-3.5**
  - [ ] 17.4 P-4 时间戳单调递增：相邻条目时间戳不倒退 **验证: AC-4.4, AC-4.5**
  - [ ] 17.5 P-5 签名有效性：任意条目的签名可通过公钥验证 **验证: AC-3.4**
  - [ ] 17.6 P-6 序号连续性：相邻条目序号差为 1 **验证: AC-5.2**
  - [ ] 17.7 P-7 篡改检测：修改任意条目的任意字段后 verifyChain() 返回 valid=false **验证: AC-5.1, AC-5.3**
  - [ ] 17.8 P-8 CRITICAL 事件必录：severity=CRITICAL 的事件必须出现在审计链中 **验证: AC-1.3, AC-2.4**
