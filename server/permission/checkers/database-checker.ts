/**
 * DatabaseChecker — 数据库权限检查
 *
 * - 表名通配符匹配（public_* allows, private_* denies）
 * - 危险操作拒绝（DROP, TRUNCATE, ALTER）始终拒绝
 * - 结果集大小限制（maxResultRows）
 */

import type { Action, PermissionConstraints } from "../../../shared/permission/contracts.js";
import type { ResourceChecker } from "./filesystem-checker.js";

/** Dangerous SQL operations — always denied */
export const DANGEROUS_OPERATIONS = ["DROP", "TRUNCATE", "ALTER"] as const;

/** Check if a SQL string contains any dangerous operation keyword */
export function containsDangerousOperation(sql: string): boolean {
  const upper = sql.toUpperCase();
  return DANGEROUS_OPERATIONS.some((op) => {
    // Match as whole word using word boundary logic
    const idx = upper.indexOf(op);
    if (idx === -1) return false;
    const before = idx === 0 ? " " : upper[idx - 1];
    const after = idx + op.length >= upper.length ? " " : upper[idx + op.length];
    const isWordBoundary = (ch: string) => !/[A-Z0-9_]/.test(ch);
    return isWordBoundary(before) && isWordBoundary(after);
  });
}

/** Simple wildcard matching for table names (supports * as wildcard) */
export function matchTablePattern(pattern: string, tableName: string): boolean {
  if (pattern === "*") return true;
  // Convert simple wildcard to regex
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + escaped + "$", "i").test(tableName);
}

/**
 * Resource format: "table_name" or "database.table_name" or raw SQL snippet
 * For dangerous operation checks, the full resource string is inspected.
 */
export class DatabaseChecker implements ResourceChecker {
  checkConstraints(action: Action, resource: string, constraints: PermissionConstraints): boolean {
    // 1. Dangerous operations — always denied
    if (constraints.forbiddenOperations && constraints.forbiddenOperations.length > 0) {
      if (containsDangerousOperation(resource)) {
        return false;
      }
    }
    // Also always check for the hardcoded dangerous operations
    if (containsDangerousOperation(resource)) {
      return false;
    }

    // 2. Table name matching
    const tableName = extractTableName(resource);
    if (tableName && constraints.tables && constraints.tables.length > 0) {
      const tableAllowed = constraints.tables.some((pattern) => matchTablePattern(pattern, tableName));
      if (!tableAllowed) return false;
    }

    // 3. Result set size limit — checked at query level, not here
    // maxResultRows is a constraint that the query executor should enforce

    return true;
  }
}

function extractTableName(resource: string): string {
  // If resource contains a dot, take the part after the last dot
  const dotIdx = resource.lastIndexOf(".");
  if (dotIdx !== -1) {
    return resource.slice(dotIdx + 1);
  }
  // Otherwise treat the whole resource as the table name
  // But skip if it looks like a SQL statement
  if (resource.includes(" ")) return "";
  return resource;
}
