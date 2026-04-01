import type { DemoDataBundle } from "./schema";
import { DEMO_ORGANIZATION } from "./organization";
import { DEMO_AGENTS } from "./agents";
import { DEMO_WORKFLOW } from "./workflow";
import { DEMO_MESSAGES } from "./messages";
import { DEMO_TASKS } from "./tasks";
import { DEMO_MEMORY_ENTRIES } from "./memory";
import { DEMO_EVOLUTION_LOGS } from "./evolution";
import { DEMO_EVENTS } from "./events";

export const DEMO_BUNDLE: DemoDataBundle = {
  version: 1,
  scenarioName: "手游营销推广方案",
  scenarioDescription:
    "设计一个手游营销推广方案，覆盖策划、技术、AI推荐和数据工程四个维度",
  organization: DEMO_ORGANIZATION,
  workflow: DEMO_WORKFLOW,
  agents: DEMO_AGENTS,
  messages: DEMO_MESSAGES,
  tasks: DEMO_TASKS,
  memoryEntries: DEMO_MEMORY_ENTRIES,
  evolutionLogs: DEMO_EVOLUTION_LOGS,
  events: DEMO_EVENTS,
};
