/**
 * McpChecker — MCP 工具权限检查
 *
 * - 工具 ID 白名单匹配
 * - 操作白名单匹配
 * - 参数约束检查
 */

import type {
  Action,
  PermissionConstraints,
} from "../../../shared/permission/contracts.js";
import type { ResourceChecker } from "./filesystem-checker.js";

/**
 * Resource format: "toolId" or "toolId:operation"
 * e.g. "file-reader" or "file-reader:read"
 */
export class McpChecker implements ResourceChecker {
  checkConstraints(
    action: Action,
    resource: string,
    constraints: PermissionConstraints
  ): boolean {
    const { toolId, operation } = parseMcpResource(resource);

    // 1. Tool ID whitelist — use endpoints field as tool whitelist
    if (constraints.endpoints && constraints.endpoints.length > 0) {
      const toolAllowed = constraints.endpoints.some(
        allowed => allowed === toolId || allowed === "*"
      );
      if (!toolAllowed) return false;
    }

    // 2. Operation whitelist — use methods field as operation whitelist
    if (operation && constraints.methods && constraints.methods.length > 0) {
      const opAllowed = constraints.methods.some(
        m => m === operation || m === "*"
      );
      if (!opAllowed) return false;
    }

    // 3. Parameter constraints
    if (constraints.parameterConstraints) {
      // MCP parameter constraints are validated against the resource metadata
      // The actual parameter values would be passed as part of the resource string
      // For now, we validate the format of constraints themselves
      for (const [, regexStr] of Object.entries(
        constraints.parameterConstraints
      )) {
        try {
          new RegExp(regexStr);
        } catch {
          return false;
        }
      }
    }

    return true;
  }
}

function parseMcpResource(resource: string): {
  toolId: string;
  operation: string | null;
} {
  const colonIdx = resource.indexOf(":");
  if (colonIdx === -1) return { toolId: resource, operation: null };
  return {
    toolId: resource.slice(0, colonIdx),
    operation: resource.slice(colonIdx + 1),
  };
}
