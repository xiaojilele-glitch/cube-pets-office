export type { FrameworkAdapter } from "./types";
export { CrewAIAdapter } from "./crewai";
export { LangGraphAdapter } from "./langgraph";
export { ClaudeAdapter } from "./claude";

import type { A2AFrameworkType } from "../../../shared/a2a-protocol";
import type { FrameworkAdapter } from "./types";
import { CrewAIAdapter } from "./crewai";
import { LangGraphAdapter } from "./langgraph";
import { ClaudeAdapter } from "./claude";

const SUPPORTED_FRAMEWORKS = ["crewai", "langgraph", "claude"] as const;

const adapterMap: Record<string, FrameworkAdapter> = {
  crewai: new CrewAIAdapter(),
  langgraph: new LangGraphAdapter(),
  claude: new ClaudeAdapter(),
};

/**
 * 根据框架类型获取对应的适配器实例。
 * 不支持的框架类型（包括 "custom"）将抛出错误并列出支持的框架。
 */
export function getAdapter(frameworkType: A2AFrameworkType): FrameworkAdapter {
  if (!Object.hasOwn(adapterMap, frameworkType)) {
    throw new Error(
      `Unsupported framework type: "${frameworkType}". Supported frameworks: ${SUPPORTED_FRAMEWORKS.join(", ")}`,
    );
  }
  return adapterMap[frameworkType];
}
