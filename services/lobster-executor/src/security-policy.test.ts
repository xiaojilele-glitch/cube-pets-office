import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  readSecurityConfig,
  resolveSecurityPolicy,
  toDockerHostConfig,
  toDockerCreateOptions,
  parseNetworkWhitelist,
  parseMemoryString,
  validateWorkspacePath,
  resolveNetworkMode,
  SANDBOX_NETWORK_NAME,
} from "./security-policy.js";

// ─── readSecurityConfig ─────────────────────────────────────────────────────

describe("readSecurityConfig", () => {
  it("returns defaults when no env vars set", () => {
    const config = readSecurityConfig({});
    expect(config).toEqual({
      securityLevel: "strict",
      containerUser: "65534",
      maxMemory: "512m",
      maxCpus: "1.0",
      maxPids: 256,
      tmpfsSize: "64m",
      networkWhitelist: [],
      seccompProfilePath: undefined,
    });
  });

  it("reads custom env var overrides", () => {
    const config = readSecurityConfig({
      LOBSTER_SECURITY_LEVEL: "balanced",
      LOBSTER_CONTAINER_USER: "1000",
      LOBSTER_MAX_MEMORY: "1g",
      LOBSTER_MAX_CPUS: "2.0",
      LOBSTER_MAX_PIDS: "512",
      LOBSTER_TMPFS_SIZE: "128m",
      LOBSTER_NETWORK_WHITELIST: "example.com, api.test.io",
      LOBSTER_SECCOMP_PROFILE: "/custom/seccomp.json",
    });
    expect(config.securityLevel).toBe("balanced");
    expect(config.containerUser).toBe("1000");
    expect(config.maxMemory).toBe("1g");
    expect(config.maxCpus).toBe("2.0");
    expect(config.maxPids).toBe(512);
    expect(config.tmpfsSize).toBe("128m");
    expect(config.networkWhitelist).toEqual(["example.com", "api.test.io"]);
    expect(config.seccompProfilePath).toBe("/custom/seccomp.json");
  });

  it("throws on invalid LOBSTER_SECURITY_LEVEL", () => {
    expect(() =>
      readSecurityConfig({ LOBSTER_SECURITY_LEVEL: "ultra" })
    ).toThrow(/Invalid LOBSTER_SECURITY_LEVEL/);
  });

  it("throws on invalid LOBSTER_MAX_PIDS", () => {
    expect(() => readSecurityConfig({ LOBSTER_MAX_PIDS: "abc" })).toThrow(
      /Invalid LOBSTER_MAX_PIDS/
    );
    expect(() => readSecurityConfig({ LOBSTER_MAX_PIDS: "0" })).toThrow(
      /Invalid LOBSTER_MAX_PIDS/
    );
    expect(() => readSecurityConfig({ LOBSTER_MAX_PIDS: "-5" })).toThrow(
      /Invalid LOBSTER_MAX_PIDS/
    );
  });
});

// ─── resolveSecurityPolicy ──────────────────────────────────────────────────

describe("resolveSecurityPolicy", () => {
  it("strict level: capAdd empty, network none, readonlyRootfs true", () => {
    const policy = resolveSecurityPolicy({
      securityLevel: "strict",
      containerUser: "65534",
      maxMemory: "512m",
      maxCpus: "1.0",
      maxPids: 256,
      tmpfsSize: "64m",
      networkWhitelist: [],
    });
    expect(policy.level).toBe("strict");
    expect(policy.capAdd).toEqual([]);
    expect(policy.capDrop).toEqual(["ALL"]);
    expect(policy.network.mode).toBe("none");
    expect(policy.readonlyRootfs).toBe(true);
    expect(policy.noNewPrivileges).toBe(true);
  });

  it("balanced level: capAdd NET_BIND_SERVICE, network whitelist", () => {
    const policy = resolveSecurityPolicy({
      securityLevel: "balanced",
      containerUser: "65534",
      maxMemory: "512m",
      maxCpus: "1.0",
      maxPids: 256,
      tmpfsSize: "64m",
      networkWhitelist: [],
    });
    expect(policy.level).toBe("balanced");
    expect(policy.capAdd).toEqual(["NET_BIND_SERVICE"]);
    expect(policy.network.mode).toBe("whitelist");
    expect(policy.readonlyRootfs).toBe(true);
  });

  it("permissive level: capAdd includes SYS_PTRACE, network bridge, readonlyRootfs false", () => {
    const policy = resolveSecurityPolicy({
      securityLevel: "permissive",
      containerUser: "65534",
      maxMemory: "512m",
      maxCpus: "1.0",
      maxPids: 256,
      tmpfsSize: "64m",
      networkWhitelist: [],
    });
    expect(policy.level).toBe("permissive");
    expect(policy.capAdd).toEqual(["NET_BIND_SERVICE", "SYS_PTRACE"]);
    expect(policy.network.mode).toBe("bridge");
    expect(policy.readonlyRootfs).toBe(false);
  });

  it("environment overrides apply to resources", () => {
    const policy = resolveSecurityPolicy({
      securityLevel: "strict",
      containerUser: "1000",
      maxMemory: "1g",
      maxCpus: "2.0",
      maxPids: 512,
      tmpfsSize: "128m",
      networkWhitelist: [],
    });
    expect(policy.user).toBe("1000");
    expect(policy.resources.memoryBytes).toBe(1073741824);
    expect(policy.resources.nanoCpus).toBe(2_000_000_000);
    expect(policy.resources.pidsLimit).toBe(512);
    expect(policy.resources.tmpfsSizeBytes).toBe(134217728);
  });

  it("custom networkWhitelist overrides preset", () => {
    const policy = resolveSecurityPolicy({
      securityLevel: "balanced",
      containerUser: "65534",
      maxMemory: "512m",
      maxCpus: "1.0",
      maxPids: 256,
      tmpfsSize: "64m",
      networkWhitelist: ["api.example.com", "10.0.0.1"],
    });
    expect(policy.network.whitelist).toEqual(["api.example.com", "10.0.0.1"]);
  });

  it("seccompProfilePath overrides preset", () => {
    const policy = resolveSecurityPolicy({
      securityLevel: "strict",
      containerUser: "65534",
      maxMemory: "512m",
      maxCpus: "1.0",
      maxPids: 256,
      tmpfsSize: "64m",
      networkWhitelist: [],
      seccompProfilePath: "/custom/profile.json",
    });
    expect(policy.seccompProfile).toBe("/custom/profile.json");
  });
});

// ─── toDockerHostConfig ─────────────────────────────────────────────────────

describe("toDockerHostConfig", () => {
  const strictPolicy = resolveSecurityPolicy({
    securityLevel: "strict",
    containerUser: "65534",
    maxMemory: "512m",
    maxCpus: "1.0",
    maxPids: 256,
    tmpfsSize: "64m",
    networkWhitelist: [],
  });

  it("sets Memory, NanoCpus, PidsLimit correctly", () => {
    const hc = toDockerHostConfig(strictPolicy);
    expect(hc.Memory).toBe(536870912);
    expect(hc.NanoCpus).toBe(1_000_000_000);
    expect(hc.PidsLimit).toBe(256);
  });

  it("CapDrop is always ALL", () => {
    const hc = toDockerHostConfig(strictPolicy);
    expect(hc.CapDrop).toEqual(["ALL"]);
  });

  it("SecurityOpt includes no-new-privileges", () => {
    const hc = toDockerHostConfig(strictPolicy);
    expect(hc.SecurityOpt).toContain("no-new-privileges");
  });

  it("Tmpfs set when readonlyRootfs is true", () => {
    const hc = toDockerHostConfig(strictPolicy);
    expect(hc.ReadonlyRootfs).toBe(true);
    expect(hc.Tmpfs).toBeDefined();
    expect(hc.Tmpfs!["/tmp"]).toContain("size=");
  });

  it("Tmpfs undefined when readonlyRootfs is false (permissive)", () => {
    const permissivePolicy = resolveSecurityPolicy({
      securityLevel: "permissive",
      containerUser: "65534",
      maxMemory: "512m",
      maxCpus: "1.0",
      maxPids: 256,
      tmpfsSize: "64m",
      networkWhitelist: [],
    });
    const hc = toDockerHostConfig(permissivePolicy);
    expect(hc.ReadonlyRootfs).toBe(false);
    expect(hc.Tmpfs).toBeUndefined();
  });

  it("NetworkMode is none for strict", () => {
    const hc = toDockerHostConfig(strictPolicy);
    expect(hc.NetworkMode).toBe("none");
  });

  it("NetworkMode is bridge for permissive", () => {
    const permissivePolicy = resolveSecurityPolicy({
      securityLevel: "permissive",
      containerUser: "65534",
      maxMemory: "512m",
      maxCpus: "1.0",
      maxPids: 256,
      tmpfsSize: "64m",
      networkWhitelist: [],
    });
    const hc = toDockerHostConfig(permissivePolicy);
    expect(hc.NetworkMode).toBe("bridge");
  });

  it("CapAdd undefined when empty (strict)", () => {
    const hc = toDockerHostConfig(strictPolicy);
    expect(hc.CapAdd).toBeUndefined();
  });

  it("CapAdd set for balanced", () => {
    const balancedPolicy = resolveSecurityPolicy({
      securityLevel: "balanced",
      containerUser: "65534",
      maxMemory: "512m",
      maxCpus: "1.0",
      maxPids: 256,
      tmpfsSize: "64m",
      networkWhitelist: [],
    });
    const hc = toDockerHostConfig(balancedPolicy);
    expect(hc.CapAdd).toEqual(["NET_BIND_SERVICE"]);
  });

  it("NetworkMode is custom network name for balanced", () => {
    const balancedPolicy = resolveSecurityPolicy({
      securityLevel: "balanced",
      containerUser: "65534",
      maxMemory: "512m",
      maxCpus: "1.0",
      maxPids: 256,
      tmpfsSize: "64m",
      networkWhitelist: [],
    });
    const hc = toDockerHostConfig(balancedPolicy);
    expect(hc.NetworkMode).toBe(SANDBOX_NETWORK_NAME);
    expect(hc.NetworkMode).not.toBe("none");
    expect(hc.NetworkMode).not.toBe("bridge");
  });

  it("includes seccomp in SecurityOpt when seccompProfile set", () => {
    const policyWithSeccomp = resolveSecurityPolicy({
      securityLevel: "strict",
      containerUser: "65534",
      maxMemory: "512m",
      maxCpus: "1.0",
      maxPids: 256,
      tmpfsSize: "64m",
      networkWhitelist: [],
      seccompProfilePath: "/path/to/seccomp.json",
    });
    const hc = toDockerHostConfig(policyWithSeccomp);
    expect(hc.SecurityOpt).toContain("seccomp=/path/to/seccomp.json");
  });
});

// ─── toDockerCreateOptions ──────────────────────────────────────────────────

describe("toDockerCreateOptions", () => {
  it("sets User field correctly", () => {
    const policy = resolveSecurityPolicy({
      securityLevel: "strict",
      containerUser: "1000",
      maxMemory: "512m",
      maxCpus: "1.0",
      maxPids: 256,
      tmpfsSize: "64m",
      networkWhitelist: [],
    });
    const opts = toDockerCreateOptions(policy);
    expect(opts.User).toBe("1000");
  });

  it("defaults to nobody (65534)", () => {
    const policy = resolveSecurityPolicy({
      securityLevel: "strict",
      containerUser: "65534",
      maxMemory: "512m",
      maxCpus: "1.0",
      maxPids: 256,
      tmpfsSize: "64m",
      networkWhitelist: [],
    });
    const opts = toDockerCreateOptions(policy);
    expect(opts.User).toBe("65534");
  });
});

// ─── parseNetworkWhitelist ──────────────────────────────────────────────────

describe("parseNetworkWhitelist", () => {
  it("empty string returns empty array", () => {
    expect(parseNetworkWhitelist("")).toEqual([]);
  });

  it("whitespace-only string returns empty array", () => {
    expect(parseNetworkWhitelist("   ")).toEqual([]);
  });

  it("comma-separated values are trimmed", () => {
    expect(parseNetworkWhitelist("  a.com , b.com , c.com  ")).toEqual([
      "a.com",
      "b.com",
      "c.com",
    ]);
  });

  it("handles single value", () => {
    expect(parseNetworkWhitelist("example.com")).toEqual(["example.com"]);
  });

  it("filters out empty segments from trailing commas", () => {
    expect(parseNetworkWhitelist("a.com,,b.com,")).toEqual(["a.com", "b.com"]);
  });
});

// ─── parseMemoryString ──────────────────────────────────────────────────────

describe("parseMemoryString", () => {
  it('"512m" → 536870912', () => {
    expect(parseMemoryString("512m")).toBe(536870912);
  });

  it('"1g" → 1073741824', () => {
    expect(parseMemoryString("1g")).toBe(1073741824);
  });

  it('"1024k" → 1048576', () => {
    expect(parseMemoryString("1024k")).toBe(1048576);
  });

  it("plain number treated as bytes", () => {
    expect(parseMemoryString("65536")).toBe(65536);
  });

  it("handles uppercase suffixes", () => {
    expect(parseMemoryString("512M")).toBe(536870912);
    expect(parseMemoryString("1G")).toBe(1073741824);
    expect(parseMemoryString("1024K")).toBe(1048576);
  });

  it("handles whitespace", () => {
    expect(parseMemoryString("  512m  ")).toBe(536870912);
  });

  it("throws on invalid string", () => {
    expect(() => parseMemoryString("abc")).toThrow(/Invalid memory string/);
    expect(() => parseMemoryString("512x")).toThrow(/Invalid memory string/);
    expect(() => parseMemoryString("")).toThrow(/Invalid memory string/);
  });
});

// ─── validateWorkspacePath ──────────────────────────────────────────────────

describe("validateWorkspacePath", () => {
  const dataRoot = process.cwd();

  it("valid subpath returns resolved path", () => {
    const result = validateWorkspacePath("jobs/abc/workspace", dataRoot);
    expect(result).toBe(resolve(dataRoot, "jobs/abc/workspace"));
  });

  it("path with ../ that escapes dataRoot throws", () => {
    expect(() => validateWorkspacePath("../../etc/passwd", dataRoot)).toThrow(
      /Path traversal detected/
    );
  });

  it("absolute path outside dataRoot throws", () => {
    const outsidePath = resolve(dataRoot, "..", "outside");
    expect(() => validateWorkspacePath(outsidePath, dataRoot)).toThrow(
      /Path traversal detected/
    );
  });

  it("path resolving to dataRoot itself is allowed", () => {
    const result = validateWorkspacePath(".", dataRoot);
    expect(result).toBe(resolve(dataRoot));
  });

  it("../ that stays within dataRoot is allowed", () => {
    const result = validateWorkspacePath("jobs/../jobs/abc", dataRoot);
    expect(result).toBe(resolve(dataRoot, "jobs/abc"));
  });
});
