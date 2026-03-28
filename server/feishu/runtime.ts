import path from "node:path";
import { loadFeishuBridgeConfigFromEnv } from "./config.js";
import {
  FeishuProgressBridge,
  type FeishuBridgeConfig,
  type FeishuBridgeDelivery,
} from "./bridge.js";
import { FeishuApiDelivery } from "./delivery.js";
import {
  FileFeishuWebhookDedupStore,
  InMemoryFeishuWebhookDedupStore,
  type FeishuWebhookDedupStore,
} from "./webhook-dedup-store.js";
import { InMemoryFeishuTaskStore, type FeishuTaskStore } from "./task-store.js";
import {
  WorkflowFeishuTaskDispatcher,
  type FeishuTaskDispatcher,
} from "./workflow-dispatcher.js";
import { FeishuWorkflowTracker } from "./workflow-tracker.js";

export interface FeishuBridgeRuntime {
  config: FeishuBridgeConfig;
  taskStore: FeishuTaskStore;
  bridge: FeishuProgressBridge;
  dispatcher?: FeishuTaskDispatcher;
  workflowTracker?: FeishuWorkflowTracker;
  webhookDedupStore: FeishuWebhookDedupStore;
}

export interface CreateFeishuBridgeRuntimeOptions {
  config?: FeishuBridgeConfig;
  delivery?: FeishuBridgeDelivery;
  taskStore?: FeishuTaskStore;
  dispatcher?: FeishuTaskDispatcher;
  workflowTracker?: FeishuWorkflowTracker;
  webhookDedupStore?: FeishuWebhookDedupStore;
}

function createDedupStore(config: FeishuBridgeConfig): FeishuWebhookDedupStore {
  if (config.webhookDedupFilePath) {
    return new FileFeishuWebhookDedupStore(
      path.resolve(config.webhookDedupFilePath)
    );
  }
  return new InMemoryFeishuWebhookDedupStore();
}

export function createFeishuBridgeRuntime(
  options: CreateFeishuBridgeRuntimeOptions = {}
): FeishuBridgeRuntime {
  const config = options.config ?? loadFeishuBridgeConfigFromEnv();
  const taskStore = options.taskStore ?? new InMemoryFeishuTaskStore();
  const delivery = options.delivery ?? new FeishuApiDelivery(config);
  const bridge = new FeishuProgressBridge(delivery, config);
  const workflowTracker = options.workflowTracker ?? new FeishuWorkflowTracker(taskStore);
  const dispatcher = options.dispatcher ?? new WorkflowFeishuTaskDispatcher();
  const webhookDedupStore = options.webhookDedupStore ?? createDedupStore(config);

  taskStore.subscribe(task => bridge.handleTaskUpdate(task));

  return {
    config,
    taskStore,
    bridge,
    dispatcher,
    workflowTracker,
    webhookDedupStore,
  };
}

let defaultRuntime: FeishuBridgeRuntime | null = null;

export function getDefaultFeishuBridgeRuntime(): FeishuBridgeRuntime {
  if (!defaultRuntime) {
    defaultRuntime = createFeishuBridgeRuntime();
  }
  return defaultRuntime;
}
