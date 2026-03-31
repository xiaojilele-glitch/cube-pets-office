# 需求文档

## 简介

Lobster Executor 即将通过 `lobster-executor-real` spec 实现真实 Docker 容器执行。然而，当前设计中完全没有任何安全策略——容器以默认权限运行，无资源限制、无网络隔离、无系统调用过滤。在执行用户生成的任意命令场景下，这意味着容器可以访问宿主机资源、发起任意网络请求、执行危险系统调用，构成严重安全风险。

本需求定义了为 Lobster Executor 添加生产级安全沙箱所需的全部行为，覆盖容器权限降级、资源限制、网络隔离、系统调用过滤、安全审计日志等维度。

## 术语表

- **SecurityPolicy**：安全策略配置对象，定义容器运行时的安全约束
- **SecurityLevel**：安全等级枚举（strict / balanced / permissive），预设不同强度的安全策略组合
- **Seccomp_Profile**：Linux seccomp-bpf 配置文件，定义允许/拒绝的系统调用集合
- **Capability**：Linux capability，细粒度的 root 权限分解单元
- **Network_Whitelist**：网络白名单，允许容器访问的域名/IP 列表
- **Audit_Log**：安全审计日志，记录容器生命周期中的安全相关事件
- **Resource_Limit**：资源限制配置（CPU、内存、磁盘、进程数）

## 需求

### 需求 1：安全策略配置体系

**用户故事：** 作为运维人员，我需要通过环境变量和配置文件灵活控制容器的安全等级，以便在不同部署场景中平衡安全性与可用性。

#### 验收标准

1.1 THE Executor SHALL 支持 LOBSTER_SECURITY_LEVEL 环境变量，值为 "strict"（默认）、"balanced" 或 "permissive"
1.2 WHEN SecurityLevel 为 "strict" 时，THE Executor SHALL 应用最严格的安全策略：drop ALL capabilities、只读根文件系统、禁用外网、最小 seccomp profile
1.3 WHEN SecurityLevel 为 "balanced" 时，THE Executor SHALL 保留 NET_BIND_SERVICE capability、允许白名单网络访问、使用标准 seccomp profile
1.4 WHEN SecurityLevel 为 "permissive" 时，THE Executor SHALL 保留常用 capabilities（NET_BIND_SERVICE、SYS_PTRACE）、允许所有网络访问、使用宽松 seccomp profile
1.5 THE Executor SHALL 支持通过 LOBSTER_SECCOMP_PROFILE 环境变量指定自定义 seccomp profile 文件路径（覆盖等级预设）
1.6 THE Executor SHALL 在启动时验证安全配置的有效性，无效配置应快速失败并输出清晰错误信息
1.7 THE SecurityPolicy 类型 SHALL 在 shared/executor/contracts.ts 中定义，以便 Cube Brain 和 Executor 共享

### 需求 2：容器权限降级

**用户故事：** 作为系统，我需要容器以最低权限运行，以便即使容器内代码被恶意利用也无法影响宿主机。

#### 验收标准

2.1 THE Executor SHALL 强制所有容器以非 root 用户运行（默认 UID 65534 / nobody）
2.2 THE Executor SHALL 支持 LOBSTER_CONTAINER_USER 环境变量自定义容器运行用户
2.3 THE Executor SHALL 在容器创建时 drop ALL Linux capabilities，仅按 SecurityLevel 添加必要的 capabilities
2.4 THE Executor SHALL 为容器应用 seccomp profile，过滤危险系统调用（如 mount、reboot、kexec_load 等）
2.5 THE Executor SHALL 提供默认的 seccomp.json 文件，位于 services/lobster-executor/seccomp.json
2.6 THE Executor SHALL 禁止容器获取新的权限（no-new-privileges）

### 需求 3：资源限制

**用户故事：** 作为系统，我需要限制每个容器的资源使用量，以便单个恶意或失控任务不会耗尽宿主机资源。

#### 验收标准

3.1 THE Executor SHALL 支持 LOBSTER_MAX_MEMORY 环境变量限制容器内存（默认 512MB）
3.2 THE Executor SHALL 支持 LOBSTER_MAX_CPUS 环境变量限制容器 CPU 配额（默认 1.0 核）
3.3 THE Executor SHALL 支持 LOBSTER_MAX_PIDS 环境变量限制容器内进程数（默认 256）
3.4 THE Executor SHALL 在容器创建时通过 Docker HostConfig 注入 Memory、NanoCpus、PidsLimit 参数
3.5 WHEN 容器因 OOM（内存超限）被 kill 时，THE Executor SHALL 发出 job.failed 事件，errorCode 为 "OOM_KILLED"
3.6 THE Executor SHALL 支持 LOBSTER_TMPFS_SIZE 环境变量配置容器内 /tmp 的 tmpfs 大小（默认 64MB），用于只读根文件系统场景下的临时写入

### 需求 4：网络隔离

**用户故事：** 作为系统，我需要控制容器的网络访问能力，以便防止容器发起未授权的外部请求或数据泄露。

#### 验收标准

4.1 WHEN SecurityLevel 为 "strict" 时，THE Executor SHALL 以 --network=none 模式启动容器（完全禁用网络）
4.2 WHEN SecurityLevel 为 "balanced" 时，THE Executor SHALL 创建专用 Docker network 并仅允许白名单域名/IP 的出站访问
4.3 THE Executor SHALL 支持 LOBSTER_NETWORK_WHITELIST 环境变量配置允许访问的域名/IP 列表（逗号分隔）
4.4 WHEN SecurityLevel 为 "permissive" 时，THE Executor SHALL 使用默认 Docker bridge 网络（不限制出站）
4.5 THE Executor SHALL 在 job.started 事件的 payload 中包含当前生效的网络策略信息

### 需求 5：文件系统隔离

**用户故事：** 作为系统，我需要限制容器的文件系统访问范围，以便容器无法读写宿主机上的敏感文件。

#### 验收标准

5.1 THE Executor SHALL 在 strict 和 balanced 模式下以 --read-only 启动容器（只读根文件系统）
5.2 THE Executor SHALL 仅挂载 Job 专属的 workspace 目录到容器的 /workspace 路径（可读写）
5.3 THE Executor SHALL 在只读模式下挂载 tmpfs 到 /tmp（大小由 LOBSTER_TMPFS_SIZE 控制）
5.4 THE Executor SHALL 禁止挂载宿主机的 /proc、/sys、Docker socket 等敏感路径
5.5 THE Executor SHALL 验证 workspace 挂载路径不包含路径遍历（../ 或绝对路径指向 dataRoot 之外）

### 需求 6：安全审计日志

**用户故事：** 作为运维人员，我需要查看容器执行过程中的安全相关事件，以便进行安全审计和问题排查。

#### 验收标准

6.1 THE Executor SHALL 记录每个容器的安全审计事件，包括：容器创建（含完整安全配置）、启动、资源超限、异常退出、安全策略违规、容器销毁
6.2 THE Executor SHALL 将审计日志写入 Job 数据目录下的 security-audit.jsonl 文件
6.3 THE Executor SHALL 新增 GET /api/executor/security-audit 端点，支持按 jobId 查询审计日志
6.4 THE Executor SHALL 在审计日志中包含时间戳、事件类型、Job ID、安全等级、详细信息
6.5 WHEN 容器因安全原因失败时（OOM、seccomp 违规、网络违规），THE Executor SHALL 在 job.failed 事件的 detail 中包含安全审计摘要

### 需求 7：异常处理与安全回调

**用户故事：** 作为系统，我需要在检测到安全异常时立即终止容器并通知 Cube Brain，以便系统能快速响应安全事件。

#### 验收标准

7.1 WHEN 容器因 OOM 被 kill 时，THE Executor SHALL 立即清理容器并发出 job.failed 事件（errorCode: "OOM_KILLED"）
7.2 WHEN 容器尝试执行被 seccomp 拒绝的系统调用时，THE Executor SHALL 记录审计日志并在容器退出后报告 errorCode "SECCOMP_VIOLATION"
7.3 WHEN 容器创建因安全配置无效而失败时，THE Executor SHALL 发出 job.failed 事件（errorCode: "SECURITY_CONFIG_INVALID"）
7.4 THE Executor SHALL 在所有安全相关的失败事件中包含 payload.securityContext 字段，描述生效的安全策略

### 需求 8：前端安全状态展示

**用户故事：** 作为用户，我希望在任务界面中看到当前 Job 的安全策略信息，以便了解任务运行在什么安全级别下。

#### 验收标准

8.1 THE Executor SHALL 在 job.started 事件的 payload 中包含 securitySummary 字段（安全等级、用户、网络模式、资源限制摘要）
8.2 THE /tasks 页面 SHALL 在 Job 详情中显示安全策略摘要（安全等级标签 + 关键限制参数）
8.3 THE 3D 场景 SHALL 在高安全等级（strict）执行时显示"🛡️ 沙箱保护中"视觉提示
