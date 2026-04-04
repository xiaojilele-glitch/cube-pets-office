/**
 * FilesystemChecker — 文件系统权限检查
 *
 * - 路径模式匹配（简单 glob: *, **)
 * - 敏感目录黑名单（/etc, /sys, /proc, ~/.ssh）始终拒绝
 * - 沙箱路径隔离（/sandbox/agent_<id>/）
 */

import type { Action, PermissionConstraints } from "../../../shared/permission/contracts.js";

/** Sensitive directories — always denied regardless of permissions */
export const SENSITIVE_DIRS = ["/etc", "/sys", "/proc", "~/.ssh"] as const;

export interface ResourceChecker {
  checkConstraints(action: Action, resource: string, constraints: PermissionConstraints): boolean;
}

/**
 * Simple glob matching supporting * (single segment) and ** (any depth).
 * Converts a glob pattern to a RegExp.
 */
export function globToRegex(pattern: string): RegExp {
  // Normalize trailing slashes
  const p = pattern.replace(/\/+$/, "");
  let regex = "";
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === "*") {
      if (p[i + 1] === "*") {
        // ** matches any number of path segments
        if (p[i + 2] === "/") {
          regex += "(?:.+/)?";
          i += 3;
        } else {
          regex += ".*";
          i += 2;
        }
      } else {
        // * matches anything except /
        regex += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      regex += "[^/]";
      i += 1;
    } else if (".+^${}()|[]\\".includes(ch)) {
      regex += "\\" + ch;
      i += 1;
    } else {
      regex += ch;
      i += 1;
    }
  }
  return new RegExp("^" + regex + "$");
}

/** Check if a path matches a glob pattern */
export function matchGlob(pattern: string, path: string): boolean {
  return globToRegex(pattern).test(path);
}

/** Check if a path starts with any sensitive directory */
export function isSensitivePath(path: string): boolean {
  const normalized = path.replace(/\/+$/, "");
  for (const dir of SENSITIVE_DIRS) {
    if (normalized === dir || normalized.startsWith(dir + "/")) {
      return true;
    }
  }
  return false;
}

export class FilesystemChecker implements ResourceChecker {
  checkConstraints(action: Action, resource: string, constraints: PermissionConstraints): boolean {
    // 1. Sensitive directories — always denied
    if (isSensitivePath(resource)) {
      return false;
    }

    // 2. Path pattern matching
    const patterns = constraints.pathPatterns;
    if (!patterns || patterns.length === 0) {
      // No path patterns means no filesystem access allowed
      return false;
    }

    // Check if resource matches at least one allowed pattern
    return patterns.some((pattern) => matchGlob(pattern, resource));
  }
}
