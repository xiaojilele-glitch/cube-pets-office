# Agent 细粒度权限模型 需求文档

## 概述

Agent 细粒度权限模型负责在执行层安全沙箱（secure-sandbox）基础上，实现治理层的权限控制。通过 Agent-Resource-Action 三维权限矩阵，对不同 Agent 的文件系统、网络、API、数据库等资源访问进行分级授权。每个 Agent 在执行前获得权限令牌（CapabilityToken），运行时权限检查引擎拦截非授权操作，支持动态权限调整和审计追踪。

与 secure-sandbox 的关系：secure-sandbox 处理 Docker 容器级别的物理隔离（执行层），本模块处理 Agent 逻辑级别的权限控制（治理层），两者互补。

## 术语表

- **AgentRole**：Agent 权限角色，预定义的权限集合（如 Reader、Writer、Admin）
- **Permission**：单条权限定义，包含资源类型、操作和约束条件
- **AgentPermissionPolicy**：Agent 的权限策略，包含分配的角色和自定义权限
- **CapabilityToken**：权限令牌，JWT 格式，包含 Agent 的完整权限矩阵
- **PermissionCheckEngine**：运行时权限检查引擎，拦截并验证每个操作
- **PermissionTemplate**：权限模板，按 Agent 职责预定义的最小权限集合
- **ResourceType**：资源类型枚举（filesystem、network、api、database、mcp_tool）
- **PermissionMatrix**：权限矩阵，resourceType → actions → constraints 的三维映射

## 需求

### 需求 1: 定义 Agent 权限角色和权限集

**用户故事：** 作为系统管理员，我需要预定义 Agent 权限角色（如 Reader、Writer、Admin），每个角色包含对不同资源类型的权限集合，这样可以快速为新 Agent 分配权限而无需逐一配置。

#### 验收标准

- AC-1.1: 系统支持创建 `AgentRole`（包含 roleId、roleName、description、permissions 数组）
- AC-1.2: 权限集定义为 `Permission`（包含 resourceType、action、constraints）
- AC-1.3: 预定义角色包括 Reader（只读）、Writer（读写）、Admin（全权）、Executor（执行脚本）、NetworkCaller（网络调用）
- AC-1.4: 每个权限包含资源类型（filesystem、network、api、database、mcp_tool）、操作（read、write、execute、delete）、约束条件（路径前缀、域名白名单、速率限制）
- AC-1.5: 角色定义存储到数据库，支持版本控制和变更审计

### 需求 2: 为 Agent 分配权限角色和自定义权限

**用户故事：** 作为系统，我需要在 Agent 创建或动态组织生成时，根据 Agent 的职责自动分配权限角色，并支持细粒度的权限覆盖，这样不同 Agent 获得差异化的资源访问权限。

#### 验收标准

- AC-2.1: `AgentPermissionPolicy` 定义 Agent 的权限配置（包含 agentId、assignedRoles、customPermissions、expiresAt）
- AC-2.2: 系统根据 Agent 的 role（如 "CodeExecutor"、"DataAnalyzer"）自动匹配预定义角色
- AC-2.3: 支持权限覆盖：在基础角色基础上添加或移除特定权限（如 "CodeExecutor" 基于 Executor 角色，但禁止网络访问）
- AC-2.4: 权限策略包含生效时间和过期时间，支持临时权限授予
- AC-2.5: 权限分配记录到审计日志，包含操作者、时间、变更内容

### 需求 3: 生成 Agent 权限令牌（CapabilityToken）

**用户故事：** 作为系统，我需要在 Agent 执行前生成包含权限信息的令牌，令牌包含 Agent 的所有授权资源和操作，这样运行时可以快速验证权限而无需频繁查询数据库。

#### 验收标准

- AC-3.1: `CapabilityToken` 包含 agentId、permissions、issuedAt、expiresAt、signature
- AC-3.2: 令牌采用 JWT 格式，包含加密签名防止篡改
- AC-3.3: 令牌的 payload 包含权限矩阵（resourceType → [actions] → constraints）
- AC-3.4: 令牌有效期默认为工作流执行时长 + 1 小时，支持自定义
- AC-3.5: 令牌生成时记录日志（agentId、permissions、expiresAt），便于审计

### 需求 4: 运行时权限检查引擎

**用户故事：** 作为系统，我需要在 Agent 执行每个操作时（如文件读写、网络请求、API 调用）拦截并检查权限，这样确保 Agent 只能访问授权的资源。

#### 验收标准

- AC-4.1: `PermissionCheckEngine` 提供 `checkPermission(agentId, resourceType, action, resource, token)` 接口
- AC-4.2: 检查流程：验证令牌有效性 → 查询权限矩阵 → 匹配资源和操作 → 应用约束条件
- AC-4.3: 约束条件包括路径前缀匹配（如 `/data/public/*` 允许，`/data/private/*` 拒绝）、域名白名单（如 `*.company.com` 允许）、速率限制（如每分钟 100 次请求）
- AC-4.4: 权限检查失败返回 `PermissionDenied` 异常，包含拒绝原因和建议
- AC-4.5: 检查延迟 < 5ms（缓存优化），支持批量检查

### 需求 5: 文件系统权限控制

**用户故事：** 作为系统，我需要对 Agent 的文件系统访问进行细粒度控制，包括读、写、执行权限和路径隔离，这样防止 Agent 访问敏感文件或系统文件。

#### 验收标准

- AC-5.1: 文件系统权限定义为 `FilesystemPermission`（包含 action: read|write|execute|delete、pathPattern、recursive）
- AC-5.2: 路径模式支持通配符（如 `/data/user_*/input/*`）和正则表达式
- AC-5.3: 权限检查拦截所有文件操作：open、read、write、delete、chmod、mkdir 等
- AC-5.4: 默认权限：禁止访问 `/etc`、`/sys`、`/proc`、`~/.ssh` 等系统敏感目录
- AC-5.5: 支持沙箱路径隔离：Agent 只能访问分配给它的工作目录（如 `/sandbox/agent_<id>/`）
- AC-5.6: 文件操作权限检查失败时记录到审计日志（agentId、operation、path、result）

### 需求 6: 网络权限控制

**用户故事：** 作为系统，我需要对 Agent 的网络访问进行控制，包括域名白名单、端口限制、协议限制，这样防止 Agent 访问内部网络或恶意网站。

#### 验收标准

- AC-6.1: 网络权限定义为 `NetworkPermission`（包含 action: connect|dns|http|https、domainPattern、ports、rateLimit）
- AC-6.2: 域名白名单支持通配符（如 `*.api.company.com`）和 CIDR 表示法（如 `10.0.0.0/8`）
- AC-6.3: 端口限制支持单个端口和范围（如 443、8000-9000）
- AC-6.4: 协议限制包括 HTTP、HTTPS、DNS、TCP、UDP
- AC-6.5: 速率限制包括连接数/分钟、请求数/分钟、带宽限制
- AC-6.6: 默认权限：禁止访问私有 IP 段（10.0.0.0/8、172.16.0.0/12、192.168.0.0/16）
- AC-6.7: 网络请求权限检查失败时记录到审计日志（agentId、destination、port、protocol、result）

### 需求 7: API 和 MCP 工具权限控制

**用户故事：** 作为系统，我需要对 Agent 调用外部 API 和 MCP 工具的权限进行控制，包括 API 端点白名单、工具白名单、参数验证，这样防止 Agent 调用未授权的 API 或工具。

#### 验收标准

- AC-7.1: API 权限定义为 `ApiPermission`（包含 action: call、apiId、endpoints、methods、parameterConstraints）
- AC-7.2: 端点白名单支持路径模式（如 `/api/v1/users/*`）和方法限制（GET、POST、PUT、DELETE）
- AC-7.3: 参数约束支持字段级别的验证（如 `userId` 必须匹配 `^[0-9]+$`、`limit` 不超过 1000）
- AC-7.4: MCP 工具权限定义为 `McpToolPermission`（包含 toolId、allowedOperations、parameterConstraints）
- AC-7.5: 权限检查在 API 调用前进行，验证端点、方法、参数
- AC-7.6: 支持 API 调用的审计日志（agentId、apiId、endpoint、method、parameters、result）

### 需求 8: 数据库权限控制

**用户故事：** 作为系统，我需要对 Agent 的数据库访问进行控制，包括表级别的读写权限、SQL 查询限制，这样防止 Agent 访问敏感数据或执行危险的 SQL 操作。

#### 验收标准

- AC-8.1: 数据库权限定义为 `DatabasePermission`（包含 action: select|insert|update|delete、database、tables、rowLevelFilter）
- AC-8.2: 表级别权限支持通配符（如 `public_*` 允许，`private_*` 拒绝）
- AC-8.3: 行级别过滤支持 WHERE 条件（如 `WHERE owner_id = <agentId>`）
- AC-8.4: SQL 查询限制包括禁止 DROP、TRUNCATE、ALTER 等危险操作
- AC-8.5: 支持查询超时和结果集大小限制（如最多返回 10000 行）
- AC-8.6: 数据库操作权限检查失败时记录到审计日志（agentId、database、table、operation、result）

### 需求 9: 动态权限调整和临时授权

**用户故事：** 作为系统，我需要支持在工作流执行过程中动态调整 Agent 权限，以及临时授予特定权限（如临时提升权限以完成特定任务），这样提高系统的灵活性。

#### 验收标准

- AC-9.1: `grantTemporaryPermission(agentId, permission, duration)` 临时授予权限，自动过期
- AC-9.2: `revokePermission(agentId, permission)` 立即撤销权限
- AC-9.3: `escalatePermission(agentId, reason, approverList)` 请求权限提升，需要审批
- AC-9.4: 权限变更立即生效，已发放的令牌需要刷新或重新验证
- AC-9.5: 所有权限变更记录到审计日志，包含操作者、原因、审批人、时间

### 需求 10: 权限冲突检测和风险评估

**用户故事：** 作为系统，我需要检测权限配置中的冲突和风险（如过度授权、权限组合风险），并提醒管理员，这样防止权限配置错误导致的安全问题。

#### 验收标准

- AC-10.1: `detectPermissionConflicts(agentId)` 检测权限配置中的冲突（如同时允许读和删除）
- AC-10.2: `assessPermissionRisk(agentId)` 评估权限风险等级（低、中、高、严重）
- AC-10.3: 风险评估考虑因素：权限范围、敏感资源访问、权限组合、历史异常行为
- AC-10.4: 高风险权限配置自动告警，包含风险描述和建议
- AC-10.5: 支持权限配置的版本控制和回滚

### 需求 11: 权限审计和合规报告

**用户故事：** 作为审计人员，我需要查询 Agent 的权限历史、权限使用情况、权限违规事件，这样可以生成合规报告和追踪权限滥用。

#### 验收标准

- AC-11.1: `getPermissionAuditTrail(agentId, timeRange)` 返回 Agent 的权限变更历史
- AC-11.2: `getPermissionUsageReport(agentId, timeRange)` 返回 Agent 的权限使用统计（如访问的资源、操作次数）
- AC-11.3: `getPermissionViolations(timeRange)` 返回所有权限违规事件（拒绝的操作、异常访问）
- AC-11.4: 审计日志包含 agentId、operation、resource、result、timestamp、reason
- AC-11.5: 支持导出合规报告（PDF/JSON），包含权限配置、使用情况、违规事件

### 需求 12: 权限模板和最小权限原则

**用户故事：** 作为系统，我需要提供权限模板库，根据 Agent 的职责自动应用最小权限原则，这样简化权限管理并提高安全性。

#### 验收标准

- AC-12.1: 预定义权限模板包括 CodeExecutor、DataAnalyzer、FileProcessor、ApiCaller、DatabaseReader 等
- AC-12.2: 每个模板包含最小必要的权限集合，遵循最小权限原则
- AC-12.3: 系统根据 Agent 的 role 自动选择匹配的模板
- AC-12.4: 支持模板的自定义和扩展（如创建 "CustomAnalyzer" 模板）
- AC-12.5: 模板变更时，自动更新使用该模板的所有 Agent 的权限（可选）

### 需求 13: 权限管理前端界面

**用户故事：** 作为管理员，我需要在前端看到 Agent 的权限配置、权限矩阵、权限变更历史，这样可以直观管理和审计权限。

#### 验收标准

- AC-13.1: 权限管理面板展示所有 Agent 的权限配置（角色、自定义权限、过期时间）
- AC-13.2: 权限矩阵视图展示 Agent × Resource × Action 的权限分布
- AC-13.3: 支持权限搜索和过滤（按 Agent、资源类型、权限等级）
- AC-13.4: 权限变更历史展示时间轴，包含操作者、变更内容、审批状态
- AC-13.5: 支持权限的快速编辑、批量操作、导入导出

### 需求 14: 权限与动态组织生成的集成

**用户故事：** 作为系统，我需要在动态组织生成时自动为新生成的 Agent 分配权限，这样确保组织中的每个 Agent 都有合适的权限配置。

#### 验收标准

- AC-14.1: 动态组织生成时，根据 Agent 的 role 自动查询权限模板
- AC-14.2: 为每个新生成的 Agent 创建 `AgentPermissionPolicy`
- AC-14.3: 权限配置与组织结构绑定，组织删除时权限自动清理
- AC-14.4: 支持在组织生成时指定权限覆盖（如 "禁止网络访问"）
- AC-14.5: 组织中的权限继承关系：CEO 权限 ⊇ Manager 权限 ⊇ Worker 权限
