# Implementation Plan: lobster-executor-real

## Overview

将 Lobster Executor 从 mock 实现升级为真实 Docker 容器执行器。实现顺序遵循设计架构：先扩展配置与共享类型，再实现纯函数模块（HmacSigner、LogBatcher、ConcurrencyLimiter），然后构建 CallbackSender，接着实现 DockerRunner 和 MockRunner（策略模式），最后集成到 LobsterExecutorService 并更新健康检查。

## Tasks

- [x] 1. Extend configuration and shared types
  - [x] 1.1 Extend `LobsterExecutorConfig` in `services/lobster-executor/src/types.ts`
    - Add fields: `executionMode`, `defaultImage`, `maxConcurrentJobs`, `dockerHost`, `dockerTlsVerify`, `dockerCertPath`, `callbackSecret`
    - Add `containerId?` and `executionMode` fields to `StoredJobRecord`
    - Update `LobsterExecutorHealthResponse.features` to have `dockerLifecycle: boolean` and `callbackSigning: boolean`
    - Add `docker` field to `LobsterExecutorHealthResponse`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1_

  - [x] 1.2 Extend `readLobsterExecutorConfig` in `services/lobster-executor/src/config.ts`
    - Read `LOBSTER_EXECUTION_MODE`, `LOBSTER_DEFAULT_IMAGE`, `LOBSTER_MAX_CONCURRENT_JOBS`, `DOCKER_HOST`, `DOCKER_TLS_VERIFY`, `DOCKER_CERT_PATH`, `EXECUTOR_CALLBACK_SECRET` from env
    - Apply platform-specific defaults for `DOCKER_HOST` (Linux: `/var/run/docker.sock`, Windows: `npipe:////./pipe/docker_engine`)
    - _Requirements: 4.1, 4.4, 4.5, 5.1_

  - [x] 1.3 Write property test for Docker config mapping (Property 11)
    - **Property 11: Docker 配置映射**
    - _For any_ DOCKER_HOST, DOCKER_TLS_VERIFY, DOCKER_CERT_PATH env var combination, `readLobsterExecutorConfig` should correctly reflect these values with platform-appropriate defaults
    - **Validates: Requirements 4.1**

- [x] 2. Implement pure function modules
  - [x] 2.1 Create `services/lobster-executor/src/hmac-signer.ts`
    - Implement `signPayload(secret, timestamp, rawBody)` using HMAC-SHA256 on `"timestamp.rawBody"` format
    - Implement `createCallbackHeaders(executorId, secret, rawBody, now?)` returning `x-cube-executor-signature`, `x-cube-executor-timestamp`, `x-cube-executor-id` headers
    - _Requirements: 2.2, 2.3_

  - [x] 2.2 Write property test for HMAC round-trip (Property 2)
    - **Property 2: HMAC 签名验证往返**
    - _For any_ random secret, timestamp, and rawBody, `signPayload` output should equal recomputing HMAC-SHA256 on `"timestamp.rawBody"`
    - **Validates: Requirements 2.2**

  - [x] 2.3 Create `services/lobster-executor/src/log-batcher.ts`
    - Implement `LogBatcher` class with `push(line)`, `flush()`, `destroy()` methods
    - Batch constraints: max 4KB per batch, max 500ms interval between flushes
    - Call `onFlush(lines)` callback when batch is ready
    - _Requirements: 2.6_

  - [x] 2.4 Write property test for log batch constraints (Property 8)
    - **Property 8: 日志批量约束**
    - _For any_ sequence of log lines, each batch produced by LogBatcher should not exceed 4KB and batches should flush within 500ms
    - **Validates: Requirements 2.6**

  - [x] 2.5 Create `services/lobster-executor/src/concurrency-limiter.ts`
    - Implement `ConcurrencyLimiter` class with `acquire()` and `release()` methods
    - Semaphore pattern: `acquire()` waits when at capacity, `release()` unblocks next waiter
    - _Requirements: 4.5_

  - [x] 2.6 Write property test for concurrency limit (Property 12)
    - **Property 12: 并发 Job 限制**
    - _For any_ number of concurrent acquire calls exceeding maxConcurrent, the number of simultaneously held permits should never exceed maxConcurrent
    - **Validates: Requirements 4.5**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement CallbackSender
  - [x] 4.1 Create `services/lobster-executor/src/callback-sender.ts`
    - Implement `CallbackSender` class using `HmacSigner` for signing
    - `send(eventsUrl, event)` serializes event, signs with HMAC, sends HTTP POST
    - Retry logic: max 3 retries with exponential backoff (1s, 2s, 4s)
    - All retries exhausted → log warning, do not throw (callback failure must not block Job)
    - _Requirements: 2.1, 2.2, 2.4, 2.5_

  - [x] 4.2 Write property test for callback retry and fault tolerance (Property 7)
    - **Property 7: 回调重试与容错**
    - _For any_ callback failure scenario, CallbackSender should retry up to 3 times with exponential backoff, and Job execution should continue after all retries fail
    - **Validates: Requirements 2.4, 2.5**

  - [x] 4.3 Write property test for callback event coverage (Property 6)
    - **Property 6: 回调投递覆盖所有事件**
    - _For any_ sequence of events emitted during Job execution, each event should trigger exactly one HTTP POST to callback.eventsUrl
    - **Validates: Requirements 2.1**

- [x] 5. Implement JobRunner strategy pattern
  - [x] 5.1 Create `services/lobster-executor/src/runner.ts`
    - Define `JobRunner` interface with `run(record, emitEvent)` method
    - Export factory function to create runner based on `executionMode` config
    - _Requirements: 5.1, 5.2_

  - [x] 5.2 Create `services/lobster-executor/src/mock-runner.ts`
    - Extract existing mock logic from `LobsterExecutorService.runAcceptedJob()` into `MockRunner` class implementing `JobRunner`
    - Behavior must be identical to current `runAcceptedJob()` implementation
    - _Requirements: 5.2, 5.4_

  - [x] 5.3 Create `services/lobster-executor/src/docker-runner.ts`
    - Implement `DockerRunner` class implementing `JobRunner`
    - Container creation: map payload.image, payload.env, payload.command, workspace bind mount
    - Log streaming: real-time stdout/stderr capture to log file
    - Timeout handling: SIGTERM → 10s grace → SIGKILL, errorCode `"TIMEOUT"`
    - Artifact collection from `/workspace/artifacts/`
    - Container cleanup after completion (success or failure)
    - Event emission: job.started (with containerId), job.progress (every 5s or on log), job.completed/job.failed
    - Use CallbackSender for event delivery and LogBatcher for log events
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 2.1, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 5.4 Write property test for container creation config (Property 1)
    - **Property 1: 容器创建配置正确性**
    - _For any_ Job payload with image, env, command, workspaceRoot fields, DockerRunner's container creation options should correctly reflect Image, Env, Cmd, and Binds
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 4.4**

  - [x] 5.5 Write property test for exit code mapping (Property 3)
    - **Property 3: 退出码到状态映射**
    - _For any_ integer exit code, exit code 0 should map to "completed" status, non-zero should map to "failed"
    - **Validates: Requirements 1.8**

  - [x] 5.6 Write property test for event sequence order (Property 9)
    - **Property 9: 事件序列顺序**
    - _For any_ successfully completed Job, events should start with job.accepted (queued), then job.started (running), zero or more job.progress, ending with job.completed (completed)
    - **Validates: Requirements 3.1, 3.2, 3.4**

  - [x] 5.7 Write property test for failed event content (Property 10)
    - **Property 10: 失败事件内容完整性**
    - _For any_ failed Job, the job.failed event should contain non-empty errorCode, metrics.durationMs > 0, and detail with at most 50 lines of stderr
    - **Validates: Requirements 3.5, 3.6**

  - [x] 5.8 Write property test for log stream integrity (Property 5)
    - **Property 5: 日志流完整性**
    - _For any_ sequence of stdout/stderr output from a container, the Job's log file should contain all output lines in order
    - **Validates: Requirements 1.5**

  - [x] 5.9 Write property test for container cleanup with file retention (Property 4)
    - **Property 4: 容器清理后文件保留**
    - _For any_ completed Job (success or failure), the container should be removed but log files and artifacts directory should remain in dataDirectory
    - **Validates: Requirements 1.9, 1.10**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Integrate into LobsterExecutorService and update app
  - [x] 7.1 Refactor `LobsterExecutorService` to use `JobRunner` strategy
    - Replace inline `runAcceptedJob()` with delegation to `JobRunner.run()`
    - Inject `ConcurrencyLimiter` — acquire before `runner.run()`, release after
    - Select runner based on `executionMode` config at construction time
    - Pass `CallbackSender` to `DockerRunner` when in "real" mode
    - _Requirements: 1.1, 4.5, 5.1, 5.2_

  - [x] 7.2 Update `/health` endpoint in `services/lobster-executor/src/app.ts`
    - Add Docker daemon connectivity check (ping) when in "real" mode
    - Include `docker.status` ("connected"/"disconnected") and `docker.host` in response
    - Update `features.dockerLifecycle` and `features.callbackSigning` to reflect actual mode
    - Include queue stats
    - _Requirements: 4.2, 4.3_

  - [x] 7.3 Add Docker daemon startup validation
    - On service startup in "real" mode, verify Docker daemon connectivity
    - If Docker is unavailable, fast-fail with clear error message
    - _Requirements: 4.2_

  - [x] 7.4 Verify backward compatibility
    - Run existing `app.test.ts` tests in mock mode — all must pass without modification
    - Verify HTTP API routes and response formats are unchanged
    - _Requirements: 5.3, 5.4_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests use fast-check with minimum 100 iterations per property
- Unit tests validate specific examples and edge cases
- All 12 design properties are covered: Properties 1-5 in task 5, Properties 6-7 in task 4, Property 8 in task 2, Properties 9-10 in task 5, Property 11 in task 1, Property 12 in task 2
- `dockerode` is the Docker client library — install via `npm install dockerode @types/dockerode`
