import { spawn } from "node:child_process";

const port = process.env.PORT || "3000";
const baseUrl = `http://127.0.0.1:${port}`;
const startupTimeoutMs = Number(process.env.SMOKE_STARTUP_TIMEOUT_MS || 30000);
const probeIntervalMs = 500;
const routesToCheck = ["/", "/tasks", "/command-center", "/lineage"];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth(url, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.json();
        if (body?.status === "ok") {
          return body;
        }
      }
    } catch {
      // Server may still be starting.
    }

    await sleep(probeIntervalMs);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function assertHtmlRoute(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Smoke route failed: ${url} -> HTTP ${response.status}`);
  }

  const body = await response.text();
  if (!body.includes("<!doctype html") && !body.includes("<!DOCTYPE html")) {
    throw new Error(`Smoke route did not return HTML shell: ${url}`);
  }
}

function terminate(child) {
  return new Promise(resolve => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }

    child.once("exit", () => resolve());
    child.kill("SIGTERM");

    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 5000).unref();
  });
}

const child = spawn(process.execPath, ["scripts/start-prod.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: port,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";

child.stdout.on("data", chunk => {
  stdout += chunk.toString();
});

child.stderr.on("data", chunk => {
  stderr += chunk.toString();
});

try {
  await waitForHealth(`${baseUrl}/api/health`, startupTimeoutMs);

  for (const route of routesToCheck) {
    await assertHtmlRoute(`${baseUrl}${route}`);
  }

  console.log(`[prod-smoke] healthy on ${baseUrl}`);
} catch (error) {
  await terminate(child);
  const details = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  throw new Error(
    `${error instanceof Error ? error.message : String(error)}${
      details ? `\n\n[server output]\n${details}` : ""
    }`
  );
}

await terminate(child);
