# Manual Verification

## 1. Local machine with Docker

1. Ensure Docker Desktop or the Docker daemon is running.
2. Run `npm run dev:all`.
3. Confirm the logs show Docker is reachable.
4. Confirm executor starts without fallback warnings.
5. Submit a task that requires execution and verify Docker-backed runtime behavior.

## 2. Local machine without Docker

1. Stop Docker Desktop or point `LOBSTER_DOCKER_HOST` to an unreachable endpoint.
2. Run `npm run dev:all`.
3. Confirm the logs show fallback to `LOBSTER_EXECUTION_MODE=native`.
4. Confirm server, client, and executor still start successfully.
5. Submit a task that requires execution and verify host-process execution artifacts are produced.

## 3. Explicit mock mode

1. Set `LOBSTER_EXECUTION_MODE=mock`.
2. Run `npm run dev:all`.
3. Confirm startup preserves `mock` instead of probing for Docker-backed execution.

## 4. GitHub Pages static deployment

1. Build with `GITHUB_PAGES=true` or `DEPLOY_TARGET=github-pages`.
2. Open the deployed static site.
3. Confirm the app stays in `Frontend Mode`.
4. Confirm Advanced Runtime is unavailable.
5. Confirm API failures degrade to browser preview/demo behavior instead of executor-backed execution.
