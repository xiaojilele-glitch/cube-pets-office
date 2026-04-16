import { resolve } from "node:path";
import Dockerode from "dockerode";
import type { LobsterExecutorConfig } from "./types.js";
import { readSecurityConfig } from "./security-policy.js";

function parsePort(rawPort: string | undefined, fallback: number): number {
  if (!rawPort) return fallback;
  const parsed = Number.parseInt(rawPort, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultDockerHost(platform: string): string {
  return platform === "win32"
    ? "npipe:////./pipe/docker_engine"
    : "/var/run/docker.sock";
}

export function parseDockerHost(
  dockerHost: string | undefined
): Dockerode.DockerOptions {
  if (!dockerHost) return {};

  if (dockerHost.startsWith("npipe:")) {
    const pipePath = dockerHost.replace(/^npipe:\/\//, "").replace(/\//g, "\\");
    return { socketPath: pipePath };
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

export function readLobsterExecutorConfig(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform
): LobsterExecutorConfig {
  const securityConfig = readSecurityConfig(env);
  const rawMode = env.LOBSTER_EXECUTION_MODE;
  const executionMode =
    rawMode === "mock" ? "mock" : rawMode === "native" ? "native" : "real";

  return {
    host: env.LOBSTER_EXECUTOR_HOST || "0.0.0.0",
    port: parsePort(env.LOBSTER_EXECUTOR_PORT, 3031),
    dataRoot: resolve(env.LOBSTER_EXECUTOR_DATA_ROOT || "tmp/lobster-executor"),
    serviceName: env.LOBSTER_EXECUTOR_NAME || "lobster-executor",
    executionMode,
    defaultImage: env.LOBSTER_DEFAULT_IMAGE || "node:20-slim",
    maxConcurrentJobs: Math.max(
      1,
      Number.parseInt(env.LOBSTER_MAX_CONCURRENT_JOBS || "2", 10) || 2
    ),
    dockerHost:
      env.LOBSTER_DOCKER_HOST || env.DOCKER_HOST || defaultDockerHost(platform),
    dockerTlsVerify: env.DOCKER_TLS_VERIFY === "1" ? true : undefined,
    dockerCertPath: env.DOCKER_CERT_PATH || undefined,
    callbackSecret: env.EXECUTOR_CALLBACK_SECRET || "",
    aiImage: env.LOBSTER_AI_IMAGE || "cube-ai-sandbox:latest",

    // Security sandbox fields
    securityLevel: securityConfig.securityLevel,
    containerUser: securityConfig.containerUser,
    maxMemory: securityConfig.maxMemory,
    maxCpus: securityConfig.maxCpus,
    maxPids: securityConfig.maxPids,
    tmpfsSize: securityConfig.tmpfsSize,
    networkWhitelist: securityConfig.networkWhitelist,
    seccompProfilePath: securityConfig.seccompProfilePath,
  };
}
