import type {
  A2AFrameworkType,
  A2AInvokeParams,
  A2AResult,
} from "../../../shared/a2a-protocol";

/** 框架适配器接口 */
export interface FrameworkAdapter {
  frameworkType: A2AFrameworkType;

  /** 将 A2A 参数转换为框架特定的请求格式 */
  adaptRequest(params: A2AInvokeParams): {
    url: string;
    headers: Record<string, string>;
    body: unknown;
  };

  /** 将框架特定的响应转换为 A2A 响应 */
  adaptResponse(rawResponse: unknown): A2AResult;
}
