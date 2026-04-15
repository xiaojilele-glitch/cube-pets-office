import { spawn } from "node:child_process";

const children = [];
let shuttingDown = false;

function run(name, command, extraEnv = {}, options = {}) {
  const { waitForReady = false, readyText = "" } = options;
  const child = spawn(command, {
    stdio: waitForReady ? ["inherit", "pipe", "pipe"] : "inherit",
    env: {
      ...process.env,
      ...extraEnv,
    },
    shell: true,
  });

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
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => process.exit(exitCode), 200);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  const server = run(
    "server",
    "npx tsx server/index.ts",
    { PORT: "3001" },
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
          () => reject(new Error("Timed out waiting for dev server readiness log.")),
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

  run("client", "npm run dev");
  run("executor", "npx tsx services/lobster-executor/src/index.ts");
}

void main();
