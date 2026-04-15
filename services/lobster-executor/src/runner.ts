import type { ExecutorEvent } from "../../../shared/executor/contracts.js";
import type { LobsterExecutorConfig, StoredJobRecord } from "./types.js";
import type { CallbackSender } from "./callback-sender.js";
import { MockRunner, type MockRunnerOptions } from "./mock-runner.js";
import { DockerRunner } from "./docker-runner.js";
import { NativeRunner } from "./native-runner.js";

/**
 * Strategy interface for Job execution.
 * Implementations: MockRunner (mock mode) and DockerRunner (real mode).
 */
export interface JobRunner {
  run(
    record: StoredJobRecord,
    emitEvent: (event: ExecutorEvent) => void,
  ): Promise<void>;
  cancel?(record: StoredJobRecord): Promise<void>;
  pause?(record: StoredJobRecord): Promise<void>;
  resume?(record: StoredJobRecord): Promise<void>;
}

/**
 * Factory: create the appropriate JobRunner based on executionMode config.
 *
 * - "mock"  → MockRunner  (no Docker dependency)
 * - "real"  → DockerRunner (requires Docker daemon + CallbackSender)
 */
export function createJobRunner(
  config: LobsterExecutorConfig,
  callbackSender?: CallbackSender,
  mockRunnerOptions?: MockRunnerOptions,
): JobRunner {
  if (config.executionMode === "mock") {
    return new MockRunner(mockRunnerOptions);
  }

  if (config.executionMode === "native") {
    if (!callbackSender) {
      throw new Error(
        'CallbackSender is required when executionMode is "native"',
      );
    }
    return new NativeRunner(callbackSender);
  }

  if (!callbackSender) {
    throw new Error(
      'CallbackSender is required when executionMode is "real"',
    );
  }
  return new DockerRunner(config, callbackSender);
}
