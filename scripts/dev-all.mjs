import { spawn } from "node:child_process";
import dotenv from "dotenv";
import Dockerode from "dockerode";

dotenv.config();

const children = [];
let shuttingDown = false;

function resolveCommand(command) {
  if (
    process.platform === "win32" &&
    (command === "npm" || command === "npx")
  ) {
    return `${command}.cmd`;
  }
  return command;
}

function quoteShellArg(value) {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function defaultDockerHost() {
  return process.platform === "win32"
    ? "npipe:////./pipe/docker_engine"
    : "/var/run/docker.sock";
}

function parseDockerOptions(dockerHost) {
  if (!dockerHost) return {};

  if (dockerHost.startsWith("npipe:")) {
    return {
      socketPath: dockerHost.replace(/^npipe:\/\//, "").replace(/\//g, "\\"),
    };
  }

  if (dockerHost.startsWith("/") || dockerHost.startsWith("\\\\.\\pipe\\")) {
    return { socketPath: dockerHost };
  }

  try {
    const url = new URL(dockerHost.replace(/^tcp:\/\//, "http://"));
    return {
      host: url.hostname,
      port: url.port || "2375",
      protocol: "http",
    };
  } catch {
    return { host: dockerHost };
  }
}

function resolveRequestedExecutionMode() {
  const requestedMode = process.env.LOBSTER_EXECUTION_MODE;
  if (requestedMode === "mock" || requestedMode === "native") {
    return requestedMode;
  }
  return "real";
}

async function isDockerReachable(dockerHost) {
  try {
    const docker = new Dockerode(parseDockerOptions(dockerHost));
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

async function resolveDevEnvironment() {
  const requestedExecutionMode = resolveRequestedExecutionMode();
  if (requestedExecutionMode !== "real") {
    return {
      LOBSTER_EXECUTION_MODE: requestedExecutionMode,
    };
  }

  const dockerHost =
    process.env.LOBSTER_DOCKER_HOST ||
    process.env.DOCKER_HOST ||
    defaultDockerHost();
  const dockerReachable = await isDockerReachable(dockerHost);

  if (dockerReachable) {
    return {
      LOBSTER_EXECUTION_MODE: "real",
    };
  }

  console.warn(
    `[dev:all] Docker is unavailable at "${dockerHost}". Falling back to ` +
      `LOBSTER_EXECUTION_MODE=native so the dev stack can keep running.`
  );

  return {
    LOBSTER_EXECUTION_MODE: "native",
  };
}

function terminateChild(child) {
  if (!child.pid) return;

  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // Ignore shutdown races
    }
  }

  const forceKillTimer = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // Ignore shutdown races
      }
    }
  }, 1500);
  forceKillTimer.unref?.();
}

function run(name, command, args = [], extraEnv = {}, options = {}) {
  const { waitForReady = false, readyText = "" } = options;
  const resolvedCommand = resolveCommand(command);
  const child = spawn(
    process.platform === "win32"
      ? [resolvedCommand, ...args].map(quoteShellArg).join(" ")
      : resolvedCommand,
    process.platform === "win32" ? [] : args,
    {
      stdio: waitForReady ? ["inherit", "pipe", "pipe"] : "inherit",
      env: {
        ...process.env,
        ...extraEnv,
      },
      shell: process.platform === "win32",
      detached: process.platform !== "win32",
    }
  );

  let readyResolve;
  let readyReject;
  let isReady = false;
  let stdoutBuffer = "";
  let stderrBuffer = "";

  const readyPromise = waitForReady
    ? new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      })
    : Promise.resolve();

  if (waitForReady) {
    child.stdout?.on("data", chunk => {
      const text = chunk.toString();
      process.stdout.write(text);
      stdoutBuffer += text;

      if (!isReady && readyText && stdoutBuffer.includes(readyText)) {
        isReady = true;
        readyResolve?.();
      }
    });

    child.stderr?.on("data", chunk => {
      const text = chunk.toString();
      process.stderr.write(text);
      stderrBuffer += text;
    });
  }

  child.on("error", error => {
    if (waitForReady && !isReady) {
      readyReject?.(error);
    }

    if (shuttingDown) return;
    console.error(`[${name}] failed to start: ${error.message}`);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (waitForReady && !isReady) {
      const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
      const output = [stdoutBuffer.trim(), stderrBuffer.trim()]
        .filter(Boolean)
        .join("\n");
      readyReject?.(
        new Error(
          output
            ? `[${name}] exited with ${reason}\n${output}`
            : `[${name}] exited with ${reason}`
        )
      );
    }

    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`[${name}] exited with ${reason}`);
    shutdown(code ?? 1);
  });

  children.push(child);
  return { child, readyPromise };
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    terminateChild(child);
  }

  const exitTimer = setTimeout(
    () => process.exit(exitCode),
    process.platform === "win32" ? 1800 : 400
  );
  exitTimer.unref?.();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  const sharedDevEnv = await resolveDevEnvironment();

  const server = run(
    "server",
    "npm",
    ["run", "dev:server"],
    {
      PORT: "3001",
      ...sharedDevEnv,
    },
    {
      waitForReady: true,
      readyText: "Server running on http://localhost:3001/",
    }
  );

  try {
    await Promise.race([
      server.readyPromise,
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error("Timed out waiting for dev server readiness log.")
            ),
          180000
        )
      ),
    ]);
  } catch (error) {
    console.error(
      `[dev:all] ${error instanceof Error ? error.message : String(error)}`
    );
    shutdown(1);
    return;
  }

  run("client", "npm", ["run", "dev"], sharedDevEnv);
  run(
    "executor",
    "npx",
    ["tsx", "services/lobster-executor/src/index.ts"],
    sharedDevEnv
  );
}

void main();
