/**
 * 模板管理器 (Template Manager)
 *
 * 管理 NL 执行计划模板的保存、加载、列表和版本更新。
 * 使用本地 JSON 文件持久化 (`data/nl-templates.json`)。
 *
 * @see Requirements 19.3, 19.4, 19.5
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  NLExecutionPlan,
  PlanTemplate,
  TemplateVersion,
} from "../../../shared/nl-command/contracts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_TEMPLATE_PATH = resolve(
  __dirname,
  "../../../data/nl-templates.json"
);

interface TemplateFile {
  version: number;
  templates: PlanTemplate[];
}

export class TemplateManager {
  private templates: Map<string, PlanTemplate> = new Map();
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_TEMPLATE_PATH;
    this.loadFromFile();
  }

  /**
   * 从执行计划保存为模板。
   * 剥离 planId、commandId、status、createdAt、updatedAt，保留计划核心结构。
   * @see Requirement 19.3
   */
  save(
    plan: NLExecutionPlan,
    name: string,
    description: string,
    createdBy: string
  ): PlanTemplate {
    const now = Date.now();
    const templateId = `tpl-${now}-${Math.random().toString(36).slice(2, 8)}`;

    const {
      planId: _,
      commandId: __,
      status: ___,
      createdAt: ____,
      updatedAt: _____,
      ...planCore
    } = plan;

    const initialVersion: TemplateVersion = {
      version: 1,
      description,
      createdAt: now,
      createdBy,
    };

    const template: PlanTemplate = {
      templateId,
      name,
      description,
      plan: planCore,
      version: 1,
      versions: [initialVersion],
      createdBy,
      createdAt: now,
      updatedAt: now,
    };

    this.templates.set(templateId, template);
    this.persist();
    return template;
  }

  /**
   * 按 templateId 加载模板。
   * @see Requirement 19.3
   */
  load(templateId: string): PlanTemplate | undefined {
    return this.templates.get(templateId);
  }

  /**
   * 列出模板，可选按 createdBy 过滤。
   * @see Requirement 19.5
   */
  list(createdBy?: string): PlanTemplate[] {
    const all = Array.from(this.templates.values());
    if (createdBy !== undefined) {
      return all.filter(t => t.createdBy === createdBy);
    }
    return all;
  }

  /**
   * 更新模板：递增版本号，保留旧版本到 versions 数组。
   * @see Requirement 19.4
   */
  update(
    templateId: string,
    plan: NLExecutionPlan,
    description: string,
    updatedBy: string
  ): PlanTemplate {
    const existing = this.templates.get(templateId);
    if (!existing) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const now = Date.now();
    const newVersion = existing.version + 1;

    const {
      planId: _,
      commandId: __,
      status: ___,
      createdAt: ____,
      updatedAt: _____,
      ...planCore
    } = plan;

    const versionEntry: TemplateVersion = {
      version: newVersion,
      description,
      createdAt: now,
      createdBy: updatedBy,
    };

    const updated: PlanTemplate = {
      ...existing,
      plan: planCore,
      description,
      version: newVersion,
      versions: [...existing.versions, versionEntry],
      updatedAt: now,
    };

    this.templates.set(templateId, updated);
    this.persist();
    return updated;
  }

  // ---------------------------------------------------------------------------
  // 持久化
  // ---------------------------------------------------------------------------

  private loadFromFile(): void {
    if (!existsSync(this.filePath)) {
      return;
    }
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as TemplateFile;
      if (Array.isArray(parsed.templates)) {
        this.templates = new Map(parsed.templates.map(t => [t.templateId, t]));
      }
    } catch {
      console.warn(
        `[TemplateManager] 持久化文件损坏，以空模板启动: ${this.filePath}`
      );
    }
  }

  private persist(): void {
    const data: TemplateFile = {
      version: 1,
      templates: Array.from(this.templates.values()),
    };
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("[TemplateManager] 持久化写入失败:", err);
    }
  }
}
