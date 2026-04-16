/**
 * Property 11: Docker 配置映射
 *
 * For any DOCKER_HOST, DOCKER_TLS_VERIFY, DOCKER_CERT_PATH env var combination,
 * readLobsterExecutorConfig should correctly reflect these values with
 * platform-appropriate defaults.
 *
 * **Validates: Requirements 4.1**
 *
 * Feature: lobster-executor-real, Property 11: Docker 配置映射
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { readLobsterExecutorConfig } from "./config.js";

/* ─── Arbitraries ─── */

/** Non-empty string suitable for env var values */
const arbEnvValue = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter(s => s.trim().length > 0);

/** Optional env value: either a non-empty string or undefined (meaning "not set") */
const arbOptionalEnv = fc.option(arbEnvValue, { nil: undefined });

/** Platform string — either "win32" or a non-win32 value */
const arbPlatform = fc.constantFrom("win32", "linux", "darwin", "freebsd");

/* ─── Tests ─── */

describe("Property 11: Docker 配置映射", () => {
  it("DOCKER_HOST is used when set, otherwise platform-specific default applies", () => {
    fc.assert(
      fc.property(arbOptionalEnv, arbPlatform, (dockerHost, platform) => {
        const env: NodeJS.ProcessEnv = {};
        if (dockerHost !== undefined) {
          env.DOCKER_HOST = dockerHost;
        }

        const cfg = readLobsterExecutorConfig(env, platform);

        if (dockerHost !== undefined) {
          expect(cfg.dockerHost).toBe(dockerHost);
        } else if (platform === "win32") {
          expect(cfg.dockerHost).toBe("npipe:////./pipe/docker_engine");
        } else {
          expect(cfg.dockerHost).toBe("/var/run/docker.sock");
        }
      }),
      { numRuns: 200 }
    );
  });

  it("DOCKER_TLS_VERIFY='1' maps to true, anything else maps to undefined", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant("1"),
          fc.constant("0"),
          fc.constant(""),
          fc.constant("true"),
          fc.constant("yes"),
          arbEnvValue
        ),
        tlsVerify => {
          const env: NodeJS.ProcessEnv = { DOCKER_TLS_VERIFY: tlsVerify };

          const cfg = readLobsterExecutorConfig(env, "linux");

          if (tlsVerify === "1") {
            expect(cfg.dockerTlsVerify).toBe(true);
          } else {
            expect(cfg.dockerTlsVerify).toBeUndefined();
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("DOCKER_TLS_VERIFY unset maps to undefined", () => {
    const cfg = readLobsterExecutorConfig({}, "linux");
    expect(cfg.dockerTlsVerify).toBeUndefined();
  });

  it("DOCKER_CERT_PATH is used when set, undefined when not set", () => {
    fc.assert(
      fc.property(arbOptionalEnv, certPath => {
        const env: NodeJS.ProcessEnv = {};
        if (certPath !== undefined) {
          env.DOCKER_CERT_PATH = certPath;
        }

        const cfg = readLobsterExecutorConfig(env, "linux");

        if (certPath !== undefined) {
          expect(cfg.dockerCertPath).toBe(certPath);
        } else {
          expect(cfg.dockerCertPath).toBeUndefined();
        }
      }),
      { numRuns: 200 }
    );
  });

  it("all three Docker env vars are independently resolved in any combination", () => {
    fc.assert(
      fc.property(
        arbOptionalEnv,
        fc.option(fc.constantFrom("1", "0", "", "true", "yes"), {
          nil: undefined,
        }),
        arbOptionalEnv,
        arbPlatform,
        (dockerHost, tlsVerify, certPath, platform) => {
          const env: NodeJS.ProcessEnv = {};
          if (dockerHost !== undefined) env.DOCKER_HOST = dockerHost;
          if (tlsVerify !== undefined) env.DOCKER_TLS_VERIFY = tlsVerify;
          if (certPath !== undefined) env.DOCKER_CERT_PATH = certPath;

          const cfg = readLobsterExecutorConfig(env, platform);

          // DOCKER_HOST
          if (dockerHost !== undefined) {
            expect(cfg.dockerHost).toBe(dockerHost);
          } else if (platform === "win32") {
            expect(cfg.dockerHost).toBe("npipe:////./pipe/docker_engine");
          } else {
            expect(cfg.dockerHost).toBe("/var/run/docker.sock");
          }

          // DOCKER_TLS_VERIFY
          if (tlsVerify === "1") {
            expect(cfg.dockerTlsVerify).toBe(true);
          } else {
            expect(cfg.dockerTlsVerify).toBeUndefined();
          }

          // DOCKER_CERT_PATH
          if (certPath !== undefined) {
            expect(cfg.dockerCertPath).toBe(certPath);
          } else {
            expect(cfg.dockerCertPath).toBeUndefined();
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
