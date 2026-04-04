# 实施任务

## 任务列表

- [x] 1. 安全策略类型与配置基础
  - [x] 1.1 在 `shared/executor/contracts.ts` 中新增 SecurityLevel、SecurityResourceLimits、SecurityNetworkPolicy、SecurityPolicy、SecurityAuditEntry 类型定义
  - [x] 1.2 在 `services/lobster-executor/src/security-policy.ts` 中实现 readSecurityConfig()，从环境变量读取安全配置（LOBSTER_SECURITY_LEVEL、LOBSTER_CONTAINER_USER、LOBSTER_MAX_MEMORY、LOBSTER_MAX_CPUS、LOBSTER_MAX_PIDS、LOBSTER_TMPFS_SIZE、LOBSTER_NETWORK_WHITELIST、LOBSTER_SECCOMP_PROFILE）
  - [x] 1.3 在 `services/lobster-executor/src/security-policy.ts` 中实现 resolveSecurityPolicy(config)，根据 SecurityLevel 生成完整的 SecurityPolicy 对象（三种等级预设 + 环境变量覆盖）
  - [x] 1.4 在 `services/lobster-executor/src/security-policy.ts` 中实现 toDockerHostConfig(policy) 和 toDockerCreateOptions(policy)，将 SecurityPolicy 转换为 dockerode 容器创建参数
  - [x] 1.5 在 `services/lobster-executor/src/security-policy.ts` 中实现 parseNetworkWhitelist(raw) 和 parseMemoryString(raw) 辅助函数
  - [x] 1.6 在 `services/lobster-executor/src/security-policy.ts` 中实现 validateWorkspacePath(requestedPath, dataRoot) 路径遍历防护
  - [x] 1.7 编写 `services/lobster-executor/src/security-policy.test.ts` 单元测试，覆盖配置读取、策略解析、Docker 参数转换、路径校验
  - [x] 1.8 编写属性测试 Property 1: 安全等级到容器配置映射正确性
  - [x] 1.9 编写属性测试 Property 2: 容器用户始终非 root
  - [x] 1.10 编写属性测试 Property 3: Capability drop ALL 不变量
  - [x] 1.11 编写属性测试 Property 4: no-new-privileges 不变量
  - [x] 1.12 编写属性测试 Property 5: 资源限制参数正确映射
  - [x] 1.13 编写属性测试 Property 8: 网络白名单解析正确性
  - [x] 1.14 编写属性测试 Property 9: 路径遍历防护
  - [x] 1.15 编写属性测试 Property 12: 敏感路径禁止挂载

- [x] 2. Seccomp Profile 与容器安全启动
  - [x] 2.1 创建 `services/lobster-executor/seccomp.json` 默认 seccomp profile 文件（允许安全系统调用，拒绝 mount/reboot/kexec_load 等危险调用）
  - [x] 2.2 修改 `services/lobster-executor/src/config.ts`，在 LobsterExecutorConfig 中新增安全相关配置字段，更新 readLobsterExecutorConfig() 读取安全环境变量
  - [x] 2.3 修改 DockerRunner.createContainer()（`services/lobster-executor/src/docker-runner.ts` 或 `service.ts`），在容器创建时注入 SecurityPolicy 生成的安全配置（User、CapDrop、CapAdd、SecurityOpt、ReadonlyRootfs、Memory、NanoCpus、PidsLimit、NetworkMode、Tmpfs）
  - [x] 2.4 在 DockerRunner 中实现 OOM 检测逻辑：检查容器 inspect 结果的 State.OOMKilled 字段，生成 errorCode "OOM_KILLED"
  - [x] 2.5 在 DockerRunner 中实现 seccomp 违规检测：当退出码为 159（128+31=SIGSYS）时，生成 errorCode "SECCOMP_VIOLATION"

- [x] 3. 网络隔离实现
  - [x] 3.1 在 `services/lobster-executor/src/security-policy.ts` 中实现 NetworkPolicyBuilder：strict 模式返回 NetworkMode "none"，balanced 模式创建/复用自定义 Docker network，permissive 模式返回 "bridge"
  - [x] 3.2 在 job.started 事件的 payload 中附加当前生效的网络策略信息（mode + whitelist）
  - [x] 3.3 编写属性测试 Property 7: 网络模式与安全等级一致性
  - [x] 3.4 编写属性测试 Property 6: 只读文件系统与安全等级一致性

- [x] 4. 安全审计日志
  - [x] 4.1 在 `services/lobster-executor/src/security-audit.ts` 中实现 SecurityAuditLogger 类（log、getByJobId、getAll 方法），写入 security-audit.jsonl 文件
  - [x] 4.2 在 DockerRunner 的容器生命周期关键点调用 SecurityAuditLogger.log()：容器创建、启动、OOM、seccomp 违规、安全失败、销毁
  - [x] 4.3 在 `services/lobster-executor/src/app.ts` 中新增 GET /api/executor/security-audit?jobId=xxx 路由
  - [x] 4.4 在安全相关的 job.failed 事件中附加 payload.securityContext 字段
  - [x] 4.5 编写 `services/lobster-executor/src/security-audit.test.ts` 单元测试
  - [x] 4.6 编写属性测试 Property 10: 审计日志字段完整性
  - [x] 4.7 编写属性测试 Property 11: 安全失败事件包含 securityContext

- [x] 5. 前端安全状态展示
  - [x] 5.1 在 job.started 事件的 payload 中附加 securitySummary 字段（level、user、networkMode、readonlyRootfs、memoryLimit、cpuLimit、pidsLimit）
  - [x] 5.2 在 `client/src/components/tasks/TaskDetailView.tsx` 的 Execution tab 中新增安全策略摘要卡片，显示安全等级标签和关键限制参数
  - [x] 5.3 在 `client/src/components/Scene3D.tsx` 或相关 3D 组件中，当 Job 处于 strict 安全等级时显示"🛡️ 沙箱保护中"视觉提示

- [x] 6. 测试、文档与验证
  - [x] 6.1 编写安全 smoke 测试脚本 `scripts/secure-sandbox-smoke.mjs`，验证越权命令拒绝、资源超限终止、网络隔离生效
  - [x] 6.2 更新 `docs/executor/lobster-executor.md` 增加安全沙箱章节（配置说明、安全等级对比、环境变量列表）
  - [x] 6.3 更新 `.env.example` 添加所有安全相关环境变量及注释
  - [x] 6.4 运行 `npm run check` 确保类型检查通过
