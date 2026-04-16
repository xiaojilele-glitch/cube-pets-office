import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";

const STOPPING_CHILDREN = new WeakSet();

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeJson(value) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(item => (item === undefined ? null : normalizeJson(item)));
  }
  if (typeof value === "object" && value) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeJson(item)])
    );
  }
  return null;
}

function stableSerialize(value) {
  return JSON.stringify(normalizeJson(value));
}

export function buildRelayHeaders(secret, path, body, options = {}) {
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1_000));
  const nonce = options.nonce?.trim() || randomUUID();
  const signature = createHmac("sha256", secret)
    .update(["POST", path, timestamp, nonce, stableSerialize(body)].join("\n"))
    .digest("hex");

  return {
    "x-openclaw-timestamp": timestamp,
    "x-openclaw-nonce": nonce,
    "x-openclaw-signature": `sha256=${signature}`,
  };
}

export function buildExecutorCallbackRequest(secret, payload, options = {}) {
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1_000));
  const rawBody = JSON.stringify(payload);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return {
    rawBody,
    headers: {
      "content-type": "application/json",
      "x-cube-executor-timestamp": timestamp,
      "x-cube-executor-signature": `sha256=${signature}`,
      "x-cube-executor-id": options.executorId || "lobster",
    },
  };
}

export async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return {
    response,
    body: json,
  };
}

export async function waitForUrl(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 400;
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: options.method || "GET" });
      if (response.ok) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status} for ${url}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }

  throw new Error(
    `Timed out waiting for ${url}${
      lastError
        ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}`
        : ""
    }`
  );
}

export function startManagedProcess(name, command, env = {}, options = {}) {
  const child = Array.isArray(command)
    ? spawn(command[0], command.slice(1), {
        shell: options.shell ?? false,
        cwd: options.cwd,
        stdio: options.stdio || "inherit",
        env: {
          ...process.env,
          ...env,
        },
      })
    : spawn(command, {
        shell: options.shell ?? true,
        cwd: options.cwd,
        stdio: options.stdio || "inherit",
        env: {
          ...process.env,
          ...env,
        },
      });

  child.on("exit", code => {
    if (STOPPING_CHILDREN.has(child)) {
      STOPPING_CHILDREN.delete(child);
      return;
    }

    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
    }
  });

  return child;
}

export async function stopManagedProcess(child) {
  if (!child || child.killed || child.exitCode !== null) {
    return;
  }

  STOPPING_CHILDREN.add(child);

  if (process.platform === "win32" && child.pid) {
    await new Promise(resolve => {
      const killer = spawn(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        {
          stdio: "ignore",
          shell: false,
        }
      );

      const timer = setTimeout(() => {
        killer.kill("SIGKILL");
        resolve();
      }, 4_000);

      killer.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    return;
  }

  await new Promise(resolve => {
    const timer = setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 4_000);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });

    child.kill("SIGTERM");
  });
}
