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

## Next Phase

The remaining Worktree B items stay unchanged:

1. Replace the mock runner with Docker container lifecycle management.
2. Add runtime log collection and artifact mount plumbing.
3. Deliver callback signing and timestamp verification.
4. Keep `shared/mission/**` and `shared/executor/**` changes in Worktree 0 only.
