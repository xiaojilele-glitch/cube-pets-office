# 审计链 / 不可篡改日志 设计文档

## 概述

审计链模块是系统的安全与合规基础设施层，为所有关键操作提供不可篡改的 Append-Only Log。核心由 AuditChain（哈希链引擎）、AuditStore（持久化存储）、AuditCollector（事件采集器）、AuditVerifier（完整性验证器）、AuditQuery（查询引擎）、AnomalyDetector（异常检测）、ComplianceMapper（合规映射）七个组件构成，通过 `/api/audit` REST API 和 Socket.IO `audit_event` 对外暴露。

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    前端层                                 │
│  AuditPanel · AuditTimeline · AuditChainVerifier         │
│  AnomalyAlertPanel · audit-store (Zustand)               │
├─────────────────────────────────────────────────────────┤
│                  REST API + Socket                        │
│  /api/audit/* · Socket audit_event                       │
├─────────────────────────────────────────────────────────┤
│                    审计链核心                              │
│  AuditChain (哈希链) · AuditCollector (采集)              │
│  AuditVerifier (验证) · TimestampProvider (时间源)        │
├─────────────────────────────────────────────────────────┤
│                    查询与分析                              │
│  AuditQuery (查询) · AnomalyDetector (异常检测)           │
│  ComplianceMapper (合规映射) · AuditExport (导出)         │
├─────────────────────────────────────────────────────────┤
│                    持久化层                                │
│  AuditStore (Append-Only WAL) · 归档冷存储                │
│  data/audit/chain.wal · data/audit/archive/              │
└─────────────────────────────────────────────────────────┘
```

## 核心组件

### AuditChain (`server/audit/audit-chain.ts`)
哈希链引擎，负责构建和维护密码学哈希链。

关键方法：
- `append(event: AuditEvent)` → 计算哈希、签名、生成 AuditLogEntry 并追加到链
- `getLatestHash()` → 返回链尾哈希值
- `getEntry(entryId: string)` → 按 ID 获取日志条目
- `getEntries(startSeq: number, endSeq: number)` → 按序号范围获取条目

哈希计算规则：
```
currentHash = SHA-256(
  JSON.stringify(event) + "|" + timestamp + "|" + previousHash + "|" + nonce
)
```

签名规则：
```
signature = ECDSA-P256.sign(privateKey, currentHash)
```

### AuditStore (`server/audit/audit-store.ts`)
Append-Only 持久化存储，基于 WAL（Write-Ahead Log）模式。

关键方法：
- `appendEntry(entry: AuditLogEntry)` → 追加条目到 WAL 文件
- `readEntries(startSeq, endSeq)` → 读取指定范围的条目
- `getEntryCount()` → 返回总条目数
- `getLastEntry()` → 返回最后一条条目
- `createSnapshot(targetDir)` → 创建快照用于归档

存储格式：
- 主存储：`data/audit/chain.wal`（JSONL 格式，每行一条 AuditLogEntry）
- 索引文件：`data/audit/chain.idx`（entryId → 文件偏移量，加速查询）
- 归档目录：`data/audit/archive/`（按月归档的压缩包）

### AuditCollector (`server/audit/audit-collector.ts`)
事件采集器，提供统一的事件记录接口，支持异步缓冲。

关键方法：
- `record(event: AuditEventInput)` → 采集事件并异步写入审计链
- `recordSync(event: AuditEventInput)` → 同步写入（用于 CRITICAL 事件）
- `flush()` → 刷新缓冲区
- `getBufferSize()` → 返回缓冲区大小

缓冲策略：
- 普通事件（INFO/WARNING）：写入内存缓冲，每 100ms 或缓冲满 50 条时批量刷新
- 关键事件（CRITICAL）：立即同步写入，不经过缓冲
- 采集失败：写入本地 fallback 文件 `data/audit/buffer.jsonl`，定时重试

### AuditVerifier (`server/audit/audit-verifier.ts`)
完整性验证器，验证审计链的哈希链连续性、签名有效性和时间戳顺序。

关键方法：
- `verifyChain(startEntryId?, endEntryId?)` → 验证指定范围的审计链
- `verifyEntry(entry: AuditLogEntry)` → 验证单条日志的哈希和签名
- `verifyTimestamps(entries: AuditLogEntry[])` → 验证时间戳顺序
- `schedulePeriodicVerification(intervalMs)` → 启动定期验证

验证流程：
```
1. 读取指定范围的日志条目
2. 逐条验证：
   a. 重新计算哈希，与 currentHash 比对
   b. 验证 previousHash 与前一条的 currentHash 一致
   c. 验证 ECDSA 签名
   d. 检查时间戳单调递增
   e. 检查序号连续性（无缺失）
3. 输出 VerificationResult（通过/失败 + 详细错误列表）
```

### TimestampProvider (`server/audit/timestamp-provider.ts`)
可信时间源提供者。

关键方法：
- `now()` → 返回 `{ systemTime, trustedTime, skew }` 双时间戳
- `verifyTimestamp(entry)` → 验证时间戳偏差是否在允许范围内

实现策略：
- 开发环境：使用系统时间 + NTP 偏移估算
- 生产环境：可选集成 RFC 3161 TSA 服务

### AuditQuery (`server/audit/audit-query.ts`)
查询引擎，支持多条件过滤和分页。

关键方法：
- `query(filters: AuditQueryFilters, page: PageOptions)` → 分页查询
- `search(keyword: string, page: PageOptions)` → 全文搜索
- `getPermissionTrail(agentId, timeRange)` → 权限变更历史
- `getPermissionViolations(timeRange)` → 权限违规事件
- `getDataLineageAudit(dataId)` → 数据血缘关联审计

### AnomalyDetector (`server/audit/anomaly-detector.ts`)
基于规则的异常检测引擎。

关键方法：
- `detectAnomalies(timeWindow: TimeRange)` → 检测异常模式
- `addRule(rule: AnomalyRule)` → 添加检测规则
- `getAlerts(timeRange)` → 获取告警列表

内置规则：
| 规则 | 说明 | 阈值 |
|------|------|------|
| high_frequency_access | 异常访问频率 | > 100 次/分钟 |
| off_hours_access | 异常时间访问 | 非工作时间（22:00-06:00） |
| privilege_escalation_abuse | 权限提升后立即访问敏感资源 | 提升后 5 分钟内 |
| brute_force_pattern | 多次失败后成功 | > 5 次失败后成功 |
| bulk_data_export | 批量数据导出 | > 1000 条/次 |

### ComplianceMapper (`server/audit/compliance-mapper.ts`)
合规框架映射引擎。

关键方法：
- `mapToFramework(framework: ComplianceFramework)` → 获取框架映射
- `generateReport(framework, timeRange)` → 生成合规报告
- `getComplianceScore(framework, timeRange)` → 计算合规性评分

### AuditExport (`server/audit/audit-export.ts`)
审计日志导出模块。

关键方法：
- `exportLog(filters, format: 'json' | 'csv')` → 导出审计日志
- `generateComplianceReport(timeRange, standard)` → 生成合规报告

### AuditRetention (`server/audit/audit-retention.ts`)
日志保留和归档策略管理。

关键方法：
- `applyRetentionPolicy()` → 执行保留策略（归档 + 删除过期日志）
- `archiveEntries(startSeq, endSeq, targetPath)` → 归档指定范围的日志
- `verifyArchive(archivePath)` → 验证归档包完整性

## 数据模型

### AuditEventType 枚举
```typescript
enum AuditEventType {
  DECISION_MADE = 'DECISION_MADE',
  PERMISSION_GRANTED = 'PERMISSION_GRANTED',
  PERMISSION_REVOKED = 'PERMISSION_REVOKED',
  DATA_ACCESSED = 'DATA_ACCESSED',
  AGENT_EXECUTED = 'AGENT_EXECUTED',
  AGENT_FAILED = 'AGENT_FAILED',
  CONFIG_CHANGED = 'CONFIG_CHANGED',
  USER_LOGIN = 'USER_LOGIN',
  USER_LOGOUT = 'USER_LOGOUT',
  ESCALATION_REQUESTED = 'ESCALATION_REQUESTED',
  ESCALATION_APPROVED = 'ESCALATION_APPROVED',
  AUDIT_QUERY = 'AUDIT_QUERY',
  AUDIT_EXPORT = 'AUDIT_EXPORT',
  AUDIT_ARCHIVE = 'AUDIT_ARCHIVE',
  AUDIT_DELETE = 'AUDIT_DELETE',
  ANOMALY_DETECTED = 'ANOMALY_DETECTED',
}

type AuditSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
type AuditCategory = 'security' | 'compliance' | 'operational';

interface AuditEventTypeDefinition {
  type: AuditEventType;
  severity: AuditSeverity;
  category: AuditCategory;
  description: string;
  version: number;
}
```

### AuditEvent
```typescript
interface AuditEvent {
  eventId: string;                    // ae_<timestamp>_<random>
  eventType: AuditEventType;
  timestamp: number;                  // Unix ms
  actor: {
    type: 'user' | 'agent' | 'system';
    id: string;                       // userId 或 agentId
    name?: string;
  };
  action: string;                     // 具体操作描述
  resource: {
    type: string;                     // mission | workflow | agent | config | data
    id: string;
    name?: string;
  };
  result: 'success' | 'failure' | 'denied' | 'error';
  context: {
    sessionId?: string;
    requestId?: string;
    sourceIp?: string;
    userAgent?: string;
    organizationId?: string;
  };
  metadata?: Record<string, unknown>;
  lineageId?: string;                 // 数据血缘关联 ID
}
```

### AuditLogEntry
```typescript
interface AuditLogEntry {
  entryId: string;                    // al_<sequence>
  sequenceNumber: number;             // 全局递增序号
  eventId: string;                    // 关联的 AuditEvent ID
  event: AuditEvent;                  // 完整事件数据
  previousHash: string;               // 前一条的 currentHash（创世条目为 "0"）
  currentHash: string;                // SHA-256 哈希
  nonce: string;                      // 随机数，增加哈希唯一性
  timestamp: {
    system: number;                   // 系统时间戳
    trusted?: number;                 // 可信时间戳（TSA）
    skew?: number;                    // 偏差（ms）
  };
  signature: string;                  // ECDSA-P256 签名（base64）
}
```

### VerificationResult
```typescript
interface VerificationResult {
  valid: boolean;
  checkedRange: { start: number; end: number };
  totalEntries: number;
  errors: VerificationError[];
  verifiedAt: number;
}

interface VerificationError {
  entryId: string;
  sequenceNumber: number;
  errorType: 'hash_mismatch' | 'chain_break' | 'signature_invalid' |
             'timestamp_regression' | 'sequence_gap' | 'entry_missing';
  expected?: string;
  actual?: string;
  message: string;
}
```

### AuditQueryFilters
```typescript
interface AuditQueryFilters {
  eventType?: AuditEventType | AuditEventType[];
  actorId?: string;
  actorType?: 'user' | 'agent' | 'system';
  resourceType?: string;
  resourceId?: string;
  result?: 'success' | 'failure' | 'denied' | 'error';
  severity?: AuditSeverity;
  category?: AuditCategory;
  timeRange?: { start: number; end: number };
  keyword?: string;
}

interface PageOptions {
  pageSize: number;   // 默认 50，最大 200
  pageNum: number;    // 从 1 开始
}

interface AuditQueryResult {
  entries: AuditLogEntry[];
  total: number;
  page: PageOptions;
  chainValid?: boolean;  // 查询范围内的链验证状态
}
```

### RetentionPolicy
```typescript
interface RetentionPolicy {
  severity: AuditSeverity;
  retentionDays: number;      // 在线保留天数
  archiveAfterDays: number;   // 归档触发天数
  deleteAfterDays: number;    // 删除触发天数（归档后）
}

// 默认策略
const DEFAULT_RETENTION_POLICIES: RetentionPolicy[] = [
  { severity: 'CRITICAL', retentionDays: 2555, archiveAfterDays: 365, deleteAfterDays: 2555 },  // 7 年
  { severity: 'WARNING',  retentionDays: 1095, archiveAfterDays: 180, deleteAfterDays: 1095 },  // 3 年
  { severity: 'INFO',     retentionDays: 365,  archiveAfterDays: 90,  deleteAfterDays: 365 },   // 1 年
];
```

### AnomalyAlert
```typescript
interface AnomalyAlert {
  alertId: string;                    // aa_<timestamp>_<random>
  ruleId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  anomalyType: string;
  description: string;
  affectedEvents: string[];           // 关联的 eventId 列表
  suggestedActions: string[];
  detectedAt: number;
  status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
}
```

### ComplianceMapping
```typescript
type ComplianceFramework = 'SOC2' | 'GDPR' | 'PCI-DSS' | 'HIPAA' | 'ISO27001';

interface ComplianceRequirement {
  requirementId: string;              // 如 "SOC2-CC6.1"
  description: string;
  requiredEventTypes: AuditEventType[];
  minimumRetentionDays: number;
}

interface ComplianceReport {
  framework: ComplianceFramework;
  timeRange: { start: number; end: number };
  generatedAt: number;
  coverageScore: number;              // 0-100
  totalRequirements: number;
  coveredRequirements: number;
  gaps: ComplianceGap[];
  eventStatistics: Record<AuditEventType, number>;
  riskEvents: AuditLogEntry[];
  reportHash: string;                 // 报告内容的 SHA-256
}

interface ComplianceGap {
  requirementId: string;
  description: string;
  missingEventTypes: AuditEventType[];
  recommendation: string;
}
```

## REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/audit/events | 查询审计日志（支持多条件过滤 + 分页） |
| GET | /api/audit/events/:id | 获取单条审计日志详情 |
| GET | /api/audit/events/search | 全文搜索审计日志 |
| POST | /api/audit/verify | 验证审计链完整性（指定范围） |
| GET | /api/audit/verify/status | 获取最近一次自动验证结果 |
| GET | /api/audit/stats | 审计统计信息（事件类型分布、时间趋势） |
| GET | /api/audit/export | 导出审计日志（JSON/CSV） |
| POST | /api/audit/compliance/report | 生成合规报告 |
| GET | /api/audit/anomalies | 获取异常告警列表 |
| PATCH | /api/audit/anomalies/:id | 更新告警状态（acknowledged/resolved/dismissed） |
| GET | /api/audit/permissions/:agentId | 获取 Agent 权限变更历史 |
| GET | /api/audit/permissions/violations | 获取权限违规事件 |
| GET | /api/audit/lineage/:dataId | 获取数据血缘关联的审计事件 |
| GET | /api/audit/retention/policies | 获取保留策略 |
| POST | /api/audit/retention/archive | 手动触发归档 |

## Socket 事件

| 事件名 | 方向 | 说明 |
|--------|------|------|
| `audit_event` | Server → Client | 新审计事件写入时广播 |
| `audit_anomaly` | Server → Client | 异常检测告警广播 |
| `audit_verification` | Server → Client | 定期验证结果广播 |

## 与现有模块的集成点

### 工作流引擎 (`server/core/workflow-engine.ts`)
- 在十阶段管道的关键节点注入审计采集：
  - `direction` 阶段完成 → `DECISION_MADE`
  - `execution` 阶段 Agent 调用 → `AGENT_EXECUTED` / `AGENT_FAILED`
  - `meta_audit` 阶段 → `DATA_ACCESSED`

### Mission 编排器 (`server/core/mission-orchestrator.ts`)
- `startMission()` → `DECISION_MADE`
- `applyExecutorEvent()` → `AGENT_EXECUTED` / `AGENT_FAILED`
- `submitDecision()` → `DECISION_MADE`

### 动态组织生成 (`server/core/dynamic-organization.ts`)
- 组织生成完成 → `CONFIG_CHANGED`
- Agent 角色分配 → `PERMISSION_GRANTED`

### 消息总线 (`server/core/message-bus.ts`)
- 越级消息拒绝 → `PERMISSION_REVOKED`（记录违规尝试）

### 记忆系统 (`server/memory/`)
- 向量检索 → `DATA_ACCESSED`
- SOUL.md 修改 → `CONFIG_CHANGED`

### 飞书集成 (`server/feishu/bridge.ts`)
- Relay 鉴权 → `USER_LOGIN` / `USER_LOGOUT`
- 任务启动 → `DECISION_MADE`

## 密钥管理

```
环境变量：
  AUDIT_SIGNING_PRIVATE_KEY    # ECDSA-P256 私钥（PEM 格式）
  AUDIT_SIGNING_PUBLIC_KEY     # ECDSA-P256 公钥（PEM 格式）
  AUDIT_TSA_URL                # 可选：RFC 3161 TSA 服务地址

首次启动时：
  若未配置密钥，自动生成 ECDSA-P256 密钥对并保存到 data/audit/keys/
  开发环境使用自签名密钥，生产环境建议使用外部 KMS
```

## 正确性属性（Property-Based Testing）

### P-1: 哈希链连续性
对于审计链中任意相邻的两条日志 entry[n] 和 entry[n+1]：
`entry[n+1].previousHash === entry[n].currentHash`

**验证: AC-3.2**

### P-2: 哈希不可伪造
对于任意日志条目 entry，重新计算哈希值必须与 entry.currentHash 一致：
`SHA256(JSON.stringify(entry.event) + "|" + entry.timestamp.system + "|" + entry.previousHash + "|" + entry.nonce) === entry.currentHash`

**验证: AC-3.3**

### P-3: Append-Only 不变量
审计链的长度只能单调递增，任何操作后 `chain.length >= previousLength`。
已写入的条目不可被修改或删除。

**验证: AC-3.5**

### P-4: 时间戳单调递增
对于审计链中任意相邻的两条日志：
`entry[n+1].timestamp.system >= entry[n].timestamp.system`

**验证: AC-4.4, AC-4.5**

### P-5: 签名有效性
对于任意日志条目 entry，使用公钥验证签名必须通过：
`ECDSA.verify(publicKey, entry.currentHash, entry.signature) === true`

**验证: AC-3.4**

### P-6: 序号连续性
对于审计链中任意相邻的两条日志：
`entry[n+1].sequenceNumber === entry[n].sequenceNumber + 1`

**验证: AC-5.2**

### P-7: 篡改检测
对于审计链中任意条目，修改其任意字段后，`verifyChain()` 必须返回 `valid: false` 并报告具体错误。

**验证: AC-5.1, AC-5.3**

### P-8: CRITICAL 事件必录
所有 severity=CRITICAL 的事件调用 `record()` 后，必须出现在审计链中（不会被缓冲丢弃）。

**验证: AC-1.3, AC-2.4**

## 测试框架

- 单元测试：Vitest
- 属性测试：fast-check（通过 Vitest 集成）
- 测试文件：`server/tests/audit-chain.test.ts`、`server/tests/audit-chain.pbt.test.ts`
