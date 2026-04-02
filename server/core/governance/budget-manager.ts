/**
 * 预算管理器 (Budget Manager) — 成本治理
 *
 * 支持四级预算层级（组织→部门→项目→Mission）的创建、更新、版本控制、
 * 层级校验、模板实例化和预算对账。
 *
 * @see Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6
 */

import { randomUUID } from 'node:crypto';

import type {
  HierarchicalBudget,
  BudgetLevel,
  BudgetTemplate,
  MissionBudget,
  Currency,
} from '../../../shared/cost-governance.js';
import { DEFAULT_BUDGET_TEMPLATES } from '../../../shared/cost-governance.js';
import { auditTrail } from './audit-trail.js';

/** 20% modification threshold requiring approval */
const APPROVAL_THRESHOLD = 0.2;

export interface BudgetUpdateResult {
  budget: HierarchicalBudget;
  requiresApproval: boolean;
}

export class BudgetManager {
  /** All budgets keyed by id */
  private budgets = new Map<string, HierarchicalBudget>();
  /** Version history: budgetId → snapshots (oldest first) */
  private versionHistory = new Map<string, HierarchicalBudget[]>();
  /** Simulated actual cost per budget (for reconcile) */
  private actualCosts = new Map<string, number>();

  // ---------------------------------------------------------------------------
  // createBudget
  // ---------------------------------------------------------------------------

  /**
   * 创建预算，自动生成 id、version=1、createdAt/updatedAt。
   * 负数或零的 totalBudget 会回退到默认模板值并 warn。
   */
  createBudget(
    input: Omit<HierarchicalBudget, 'id' | 'version' | 'createdAt' | 'updatedAt'>,
  ): HierarchicalBudget {
    let totalBudget = input.totalBudget;
    if (totalBudget <= 0) {
      console.warn('[BudgetManager] totalBudget 非法（≤0），使用默认模板兜底');
      totalBudget = DEFAULT_BUDGET_TEMPLATES[0].defaultBudget;
    }

    const now = Date.now();
    const budget: HierarchicalBudget = {
      ...input,
      totalBudget,
      id: randomUUID(),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    this.budgets.set(budget.id, budget);
    this.versionHistory.set(budget.id, [{ ...budget }]);

    auditTrail.record({
      action: 'BUDGET_CREATED',
      details: { budgetId: budget.id, level: budget.level, totalBudget: budget.totalBudget },
    });

    return budget;
  }

  // ---------------------------------------------------------------------------
  // updateBudget
  // ---------------------------------------------------------------------------

  /**
   * 更新预算，自动递增 version。
   * 如果 totalBudget 修改幅度超过 20%，返回 requiresApproval=true。
   */
  updateBudget(id: string, changes: Partial<HierarchicalBudget>): BudgetUpdateResult {
    const existing = this.budgets.get(id);
    if (!existing) {
      throw new Error(`[BudgetManager] 预算不存在: ${id}`);
    }

    let requiresApproval = false;

    // Check modification magnitude for totalBudget
    if (changes.totalBudget !== undefined && existing.totalBudget > 0) {
      const magnitude = Math.abs(changes.totalBudget - existing.totalBudget) / existing.totalBudget;
      if (magnitude > APPROVAL_THRESHOLD) {
        requiresApproval = true;
      }
    }

    // Validate non-negative totalBudget if provided
    if (changes.totalBudget !== undefined && changes.totalBudget <= 0) {
      console.warn('[BudgetManager] 更新的 totalBudget 非法（≤0），使用默认模板兜底');
      changes = { ...changes, totalBudget: DEFAULT_BUDGET_TEMPLATES[0].defaultBudget };
    }

    const now = Date.now();
    const updated: HierarchicalBudget = {
      ...existing,
      ...changes,
      id: existing.id,               // immutable
      version: existing.version + 1,  // auto-increment
      createdAt: existing.createdAt,  // immutable
      updatedAt: now,
    };

    this.budgets.set(id, updated);

    // Append to version history
    const history = this.versionHistory.get(id) ?? [];
    history.push({ ...updated });
    this.versionHistory.set(id, history);

    auditTrail.record({
      action: 'BUDGET_MODIFIED',
      details: {
        budgetId: id,
        version: updated.version,
        requiresApproval,
        changes: Object.keys(changes),
      },
    });

    return { budget: updated, requiresApproval };
  }

  // ---------------------------------------------------------------------------
  // validateHierarchy
  // ---------------------------------------------------------------------------

  /**
   * 检查子预算金额是否超过父预算的 totalBudget。
   * 计算方式：父预算 totalBudget − 已有子预算 totalBudget 之和 ≥ childBudget。
   * 父预算不存在时返回 false。
   */
  validateHierarchy(childBudget: number, parentId: string): boolean {
    const parent = this.budgets.get(parentId);
    if (!parent) {
      return false;
    }

    // Sum existing children's totalBudget
    let childrenSum = 0;
    this.budgets.forEach((b) => {
      if (b.parentId === parentId) {
        childrenSum += b.totalBudget;
      }
    });

    return childrenSum + childBudget <= parent.totalBudget;
  }

  // ---------------------------------------------------------------------------
  // getTemplates
  // ---------------------------------------------------------------------------

  /** 返回预算模板列表 */
  getTemplates(): BudgetTemplate[] {
    return DEFAULT_BUDGET_TEMPLATES;
  }

  // ---------------------------------------------------------------------------
  // createFromTemplate
  // ---------------------------------------------------------------------------

  /**
   * 从模板创建 MissionBudget。
   * 模板不存在时使用第一个默认模板兜底并 warn。
   */
  createFromTemplate(templateId: string, missionId: string): MissionBudget {
    let template = DEFAULT_BUDGET_TEMPLATES.find((t) => t.id === templateId);
    if (!template) {
      console.warn(`[BudgetManager] 模板不存在: ${templateId}，使用默认模板兜底`);
      template = DEFAULT_BUDGET_TEMPLATES[0];
    }

    const now = Date.now();
    const budget: MissionBudget = {
      missionId,
      budgetType: 'FIXED',
      tokenBudget: template.defaultTokenBudget,
      costBudget: template.defaultBudget,
      currency: 'USD' as Currency,
      budgetPeriod: template.defaultPeriod,
      alertThresholds: [...template.defaultAlertThresholds],
      createdAt: now,
      updatedAt: now,
    };

    return budget;
  }

  // ---------------------------------------------------------------------------
  // reconcile
  // ---------------------------------------------------------------------------

  /**
   * 预算对账：计算预算与实际成本差异。
   * 预算不存在时抛出错误。
   */
  reconcile(budgetId: string): { budget: number; actual: number; variance: number } {
    const b = this.budgets.get(budgetId);
    if (!b) {
      throw new Error(`[BudgetManager] 预算不存在: ${budgetId}`);
    }

    const actual = this.actualCosts.get(budgetId) ?? b.usedBudget;
    const variance = b.totalBudget - actual;

    return { budget: b.totalBudget, actual, variance };
  }

  // ---------------------------------------------------------------------------
  // getVersionHistory
  // ---------------------------------------------------------------------------

  /** 获取预算版本历史（按版本号升序） */
  getVersionHistory(budgetId: string): HierarchicalBudget[] {
    return this.versionHistory.get(budgetId) ?? [];
  }

  // ---------------------------------------------------------------------------
  // helpers (for testing / integration)
  // ---------------------------------------------------------------------------

  /** 获取单个预算 */
  getBudget(id: string): HierarchicalBudget | undefined {
    return this.budgets.get(id);
  }

  /** 设置实际成本（供外部模块写入，reconcile 时使用） */
  setActualCost(budgetId: string, cost: number): void {
    this.actualCosts.set(budgetId, cost);
  }
}

/** 单例 */
export const budgetManager = new BudgetManager();
