# Lobster Executor Phase 1

## Scope

This Worktree B phase implements the first executable slice of the standalone lobster executor without touching `client/**`, `server/index.ts`, or the main README.

- Landed under `services/lobster-executor/**`
- Shared contracts are consumed read-only from `shared/executor/**`
- No runtime dependency points at `..\openclaw-feishu-progress`
- Docker lifecycle, callback signing, and timestamp verification are intentionally deferred to the next phase

## Endpoints

### `GET /health`

Returns executor liveness, contract version, queue counts, data root, and a small feature matrix.

### `POST /api/executor/jobs`

Accepts a `shared/executor` `ExecutorJobRequest`, validates that:

- `request.jobId` exists inside `plan.jobs`
- `request.missionId` matches `plan.missionId`
- callback auth headers match the frozen contract
- the current phase only uses a `payload.runner.kind = "mock"` runner

The endpoint responds with the shared `CreateExecutorJobResponse` payload and then runs the job asynchronously.

### `GET /api/executor/jobs`

Local debugging endpoint for Worktree B smoke/testing. Lists recent job summaries and is not part of the frozen shared contract.

### `GET /api/executor/jobs/:id`

Local debugging endpoint for Worktree B smoke/testing. Returns job status, event history, and generated artifacts.

### `POST /api/executor/jobs/:id/cancel`

Reserved route only. It currently returns `501` so that the path is explicit before cancellation lands with Docker lifecycle support.

## Supported Phase 1 Payload

The frozen shared contract keeps `payload` generic. The current executor understands this local runner shape:

```json
{
  "runner": {
    "kind": "mock",
    "outcome": "success",
    "steps": 3,
    "delayMs": 40,
    "logs": ["step 1", "step 2", "step 3"],
    "summary": "Optional final summary"
  }
}
```

If `payload.runner` is omitted, the executor still defaults to a mock success runner.

## Local Data Layout

Runtime artifacts are written under `tmp/lobster-executor/jobs/<missionId>/<jobId>/`.

Each accepted job currently produces:

- `request.json`
- `events.jsonl`
- `executor.log`
- `result.json`

## Run Locally

Start the service:

```powershell
npx tsx services/lobster-executor/src/index.ts
```

Optional environment variables:

- `LOBSTER_EXECUTOR_PORT` default: `3031`
- `LOBSTER_EXECUTOR_HOST` default: `0.0.0.0`
- `LOBSTER_EXECUTOR_DATA_ROOT` default: `tmp/lobster-executor`
- `LOBSTER_EXECUTOR_NAME` default: `lobster-executor`

Run the Worktree B smoke flow:

```powershell
node scripts/lobster-executor-smoke.mjs
```

If the service is already running elsewhere:

```powershell
$env:LOBSTER_SMOKE_NO_SPAWN='1'
$env:LOBSTER_EXECUTOR_BASE_URL='http://127.0.0.1:3031'
node scripts/lobster-executor-smoke.mjs
```

## Security Sandbox

The executor enforces a multi-layer security sandbox on every Docker container. Security is controlled by a single `LOBSTER_SECURITY_LEVEL` environment variable with three presets.

### Security Levels

| Feature             | `strict` (default)      | `balanced`                       | `permissive`                                   |
| ------------------- | ----------------------- | -------------------------------- | ---------------------------------------------- |
| Linux capabilities  | Drop ALL, add none      | Drop ALL, add `NET_BIND_SERVICE` | Drop ALL, add `NET_BIND_SERVICE`, `SYS_PTRACE` |
| Root filesystem     | Read-only               | Read-only                        | Read-write                                     |
| `no-new-privileges` | Yes                     | Yes                              | Yes                                            |
| Network             | `none` (fully isolated) | Whitelist only                   | Default bridge                                 |
| Seccomp profile     | Minimal allow-list      | Minimal allow-list               | Minimal allow-list                             |
| tmpfs `/tmp`        | 64 MB (configurable)    | 64 MB (configurable)             | Not mounted                                    |

### Environment Variables

| Variable                    | Description                                         | Default                 |
| --------------------------- | --------------------------------------------------- | ----------------------- |
| `LOBSTER_SECURITY_LEVEL`    | Security preset: `strict`, `balanced`, `permissive` | `strict`                |
| `LOBSTER_CONTAINER_USER`    | UID the container process runs as                   | `65534` (nobody)        |
| `LOBSTER_MAX_MEMORY`        | Container memory limit (e.g. `512m`, `1g`)          | `512m`                  |
| `LOBSTER_MAX_CPUS`          | CPU quota in cores (e.g. `1.0`, `2.0`)              | `1.0`                   |
| `LOBSTER_MAX_PIDS`          | Max processes inside the container                  | `256`                   |
| `LOBSTER_TMPFS_SIZE`        | Size of `/tmp` tmpfs in read-only mode              | `64m`                   |
| `LOBSTER_NETWORK_WHITELIST` | Comma-separated domains/IPs for balanced mode       | (empty)                 |
| `LOBSTER_SECCOMP_PROFILE`   | Path to a custom seccomp JSON profile               | Built-in `seccomp.json` |

### Seccomp Profile

A default seccomp profile ships at `services/lobster-executor/seccomp.json`. It uses a deny-by-default strategy (`SCMP_ACT_ERRNO`) and explicitly allows ~90 safe syscalls needed for typical Node.js / Python workloads. Dangerous syscalls like `mount`, `reboot`, `kexec_load`, `ptrace` (in strict mode), and `bpf` are blocked.

Override with a custom profile via `LOBSTER_SECCOMP_PROFILE=/path/to/custom.json`.

### Audit Logging

Every container lifecycle event is recorded to `<dataRoot>/security-audit.jsonl`. Each line is a JSON object with:

- `timestamp` — ISO 8601
- `jobId` / `missionId`
- `eventType` — `container.created`, `container.started`, `container.oom`, `container.seccomp_violation`, `container.security_failure`, `container.destroyed`, `resource.exceeded`
- `securityLevel` — the active level
- `detail` — event-specific metadata

Query audit entries via the API:

```
GET /api/executor/security-audit?jobId=<jobId>
```

### Security Smoke Test

```bash
# Start executor in real + strict mode:
LOBSTER_EXECUTION_MODE=real LOBSTER_SECURITY_LEVEL=strict \
  npx tsx services/lobster-executor/src/index.ts

# In another terminal:
LOBSTER_SMOKE_NO_SPAWN=1 node scripts/secure-sandbox-smoke.mjs
```

## Next Phase

The remaining Worktree B items stay unchanged:

1. Replace the mock runner with Docker container lifecycle management.
2. Add runtime log collection and artifact mount plumbing.
3. Deliver callback signing and timestamp verification.
4. Keep `shared/mission/**` and `shared/executor/**` changes in Worktree 0 only.
