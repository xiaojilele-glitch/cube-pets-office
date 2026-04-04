import { resolve } from "node:path";
import type Dockerode from "dockerode";
import type {
  SecurityLevel,
  SecurityPolicy,
} from "../../../shared/executor/contracts.js";
import { SECURITY_LEVELS } from "../../../shared/executor/contracts.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Host paths that must never be bind-mounted into containers. */
export const SENSITIVE_HOST_PATHS = [
  "/proc",
  "/sys",
  "/var/run/docker.sock",
  "/etc/shadow",
  "/etc/passwd",
];

// ─── SecurityConfig ─────────────────────────────────────────────────────────

export interface SecurityConfig {
  securityLevel: SecurityLevel;
  containerUser: string;
  maxMemory: string;
  maxCpus: string;
  maxPids: number;
  tmpfsSize: string;
  networkWhitelist: string[];
  seccompProfilePath?: string;
}

// ─── Helper functions (Task 1.5) ────────────────────────────────────────────

/**
 * Parse a comma-separated whitelist string into a trimmed array.
 * Empty / blank input returns an empty array.
 */
export function parseNetworkWhitelist(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse a human-readable memory string into bytes.
 * Supports suffixes: "k"/"K" (KiB), "m"/"M" (MiB), "g"/"G" (GiB).
 * Plain numeric strings are treated as bytes.
 */
export function parseMemoryString(raw: string): number {
  const trimmed = raw.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([kmg]?)$/);
  if (!match) {
    throw new Error(`Invalid memory string: "${raw}"`);
  }
  const value = Number.parseFloat(match[1]);
  const unit = match[2];
  switch (unit) {
    case "k":
      return Math.round(value * 1024);
    case "m":
      return Math.round(value * 1024 * 1024);
    case "g":
      return Math.round(value * 1024 * 1024 * 1024);
    default:
      return Math.round(value);
  }
}

// ─── readSecurityConfig (Task 1.2) ──────────────────────────────────────────

/**
 * Read security configuration from environment variables with sensible defaults.
 */
export function readSecurityConfig(
  env: NodeJS.ProcessEnv = process.env,
): SecurityConfig {
  const rawLevel = env.LOBSTER_SECURITY_LEVEL ?? "strict";
  if (!SECURITY_LEVELS.includes(rawLevel as SecurityLevel)) {
    throw new Error(
      `Invalid LOBSTER_SECURITY_LEVEL "${rawLevel}". Must be one of: ${SECURITY_LEVELS.join(", ")}`,
    );
  }

  const rawPids = env.LOBSTER_MAX_PIDS;
  let maxPids = 256;
  if (rawPids !== undefined) {
    const parsed = Number.parseInt(rawPids, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error(`Invalid LOBSTER_MAX_PIDS "${rawPids}". Must be a positive integer.`);
    }
    maxPids = parsed;
  }

  return {
    securityLevel: rawLevel as SecurityLevel,
    containerUser: env.LOBSTER_CONTAINER_USER ?? "65534",
    maxMemory: env.LOBSTER_MAX_MEMORY ?? "512m",
    maxCpus: env.LOBSTER_MAX_CPUS ?? "1.0",
    maxPids,
    tmpfsSize: env.LOBSTER_TMPFS_SIZE ?? "64m",
    networkWhitelist: parseNetworkWhitelist(env.LOBSTER_NETWORK_WHITELIST ?? ""),
    seccompProfilePath: env.LOBSTER_SECCOMP_PROFILE || undefined,
  };
}

// ─── resolveSecurityPolicy (Task 1.3) ───────────────────────────────────────

/**
 * Resolve a full SecurityPolicy from a SecurityConfig.
 * Applies security-level presets first, then overlays environment-variable overrides.
 */
export function resolveSecurityPolicy(config: SecurityConfig): SecurityPolicy {
  const base = levelPreset(config.securityLevel);

  return {
    ...base,
    user: config.containerUser,
    seccompProfile: config.seccompProfilePath ?? base.seccompProfile,
    resources: {
      memoryBytes: parseMemoryString(config.maxMemory),
      nanoCpus: Math.round(Number.parseFloat(config.maxCpus) * 1_000_000_000),
      pidsLimit: config.maxPids,
      tmpfsSizeBytes: parseMemoryString(config.tmpfsSize),
    },
    network: {
      ...base.network,
      whitelist:
        config.networkWhitelist.length > 0
          ? config.networkWhitelist
          : base.network.whitelist,
    },
  };
}

function levelPreset(level: SecurityLevel): SecurityPolicy {
  switch (level) {
    case "strict":
      return {
        level: "strict",
        user: "65534",
        readonlyRootfs: true,
        noNewPrivileges: true,
        capDrop: ["ALL"],
        capAdd: [],
        seccompProfile: undefined,
        resources: defaultResources(),
        network: { mode: "none" },
      };
    case "balanced":
      return {
        level: "balanced",
        user: "65534",
        readonlyRootfs: true,
        noNewPrivileges: true,
        capDrop: ["ALL"],
        capAdd: ["NET_BIND_SERVICE"],
        seccompProfile: undefined,
        resources: defaultResources(),
        network: { mode: "whitelist", whitelist: [] },
      };
    case "permissive":
      return {
        level: "permissive",
        user: "65534",
        readonlyRootfs: false,
        noNewPrivileges: true,
        capDrop: ["ALL"],
        capAdd: ["NET_BIND_SERVICE", "SYS_PTRACE"],
        seccompProfile: undefined,
        resources: defaultResources(),
        network: { mode: "bridge" },
      };
  }
}

function defaultResources() {
  return {
    memoryBytes: 536_870_912,    // 512 MiB
    nanoCpus: 1_000_000_000,     // 1.0 core
    pidsLimit: 256,
    tmpfsSizeBytes: 67_108_864,  // 64 MiB
  };
}


// ─── NetworkPolicyBuilder (Task 3.1) ────────────────────────────────────────

/** Default custom Docker network name used for balanced (whitelist) mode. */
export const SANDBOX_NETWORK_NAME = "lobster-sandbox-net";

/**
 * Resolve the Docker NetworkMode string from a SecurityPolicy.
 *
 * - strict  → "none"          (no network at all)
 * - balanced → custom network  (e.g. "lobster-sandbox-net")
 * - permissive → "bridge"     (default Docker bridge)
 */
export function resolveNetworkMode(policy: SecurityPolicy): string {
  switch (policy.network.mode) {
    case "none":
      return "none";
    case "whitelist":
      return SANDBOX_NETWORK_NAME;
    case "bridge":
      return "bridge";
  }
}

// ─── Docker config converters (Task 1.4) ────────────────────────────────────

/**
 * Convert a SecurityPolicy into a partial Dockerode HostConfig.
 */
export function toDockerHostConfig(
  policy: SecurityPolicy,
): Partial<Dockerode.HostConfig> {
  const securityOpt: string[] = [];
  if (policy.noNewPrivileges) {
    securityOpt.push("no-new-privileges");
  }
  if (policy.seccompProfile) {
    securityOpt.push(`seccomp=${policy.seccompProfile}`);
  }

  const networkMode = resolveNetworkMode(policy);

  const hostConfig: Partial<Dockerode.HostConfig> = {
    Memory: policy.resources.memoryBytes,
    NanoCpus: policy.resources.nanoCpus,
    PidsLimit: policy.resources.pidsLimit,
    ReadonlyRootfs: policy.readonlyRootfs,
    CapDrop: policy.capDrop,
    CapAdd: policy.capAdd.length > 0 ? policy.capAdd : undefined,
    SecurityOpt: securityOpt.length > 0 ? securityOpt : undefined,
    NetworkMode: networkMode,
    Tmpfs: policy.readonlyRootfs
      ? { "/tmp": `size=${policy.resources.tmpfsSizeBytes},exec` }
      : undefined,
  };

  return hostConfig;
}

/**
 * Convert a SecurityPolicy into partial Dockerode ContainerCreateOptions.
 * (Currently only sets the User field; HostConfig is handled separately.)
 */
export function toDockerCreateOptions(
  policy: SecurityPolicy,
): Partial<Dockerode.ContainerCreateOptions> {
  return {
    User: policy.user,
  };
}

// ─── validateWorkspacePath (Task 1.6) ───────────────────────────────────────

/**
 * Validate that a requested workspace path resolves within the allowed dataRoot.
 * Throws if the resolved path escapes dataRoot (path traversal).
 * Returns the resolved absolute path on success.
 */
export function validateWorkspacePath(
  requestedPath: string,
  dataRoot: string,
): string {
  const resolvedRoot = resolve(dataRoot);
  const resolvedPath = resolve(resolvedRoot, requestedPath);

  if (
    !resolvedPath.startsWith(resolvedRoot + "/") &&
    !resolvedPath.startsWith(resolvedRoot + "\\") &&
    resolvedPath !== resolvedRoot
  ) {
    throw new Error(
      `Path traversal detected: "${requestedPath}" resolves outside dataRoot`,
    );
  }

  return resolvedPath;
}
