/**
 * OntologyRegistry — 本体模型注册表
 *
 * 管理实体类型和关系类型的定义，支持运行时扩展。
 * 持久化到 data/knowledge/ontology.json。
 *
 * Requirements: 1.1, 1.2, 1.5, 1.6, 1.7
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import type {
  EntityTypeDefinition,
  RelationTypeDefinition,
} from "../../shared/knowledge/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../data/knowledge");
const ONTOLOGY_FILE = path.join(DATA_DIR, "ontology.json");

// ---------------------------------------------------------------------------
// 持久化文件格式
// ---------------------------------------------------------------------------

interface OntologyData {
  entityTypes: EntityTypeDefinition[];
  relationTypes: RelationTypeDefinition[];
}

// ---------------------------------------------------------------------------
// 10 个核心实体类型 (Requirement 1.1)
// ---------------------------------------------------------------------------

function buildCoreEntityTypes(): EntityTypeDefinition[] {
  const now = new Date().toISOString();
  return [
    {
      name: "CodeModule",
      description: "代码模块，表示一个源文件或包",
      source: "core",
      extendedAttributes: ["filePath", "language", "linesOfCode", "complexity", "exports"],
      registeredAt: now,
    },
    {
      name: "API",
      description: "API 端点，表示一个 HTTP 接口",
      source: "core",
      extendedAttributes: ["endpoint", "httpMethod", "requestSchema", "responseSchema", "authRequired"],
      registeredAt: now,
    },
    {
      name: "BusinessRule",
      description: "业务规则，描述业务逻辑约束",
      source: "core",
      extendedAttributes: ["ruleCondition", "ruleAction"],
      registeredAt: now,
    },
    {
      name: "ArchitectureDecision",
      description: "架构决策记录（ADR）",
      source: "core",
      extendedAttributes: ["context", "decision", "alternatives", "consequences", "supersededBy"],
      registeredAt: now,
    },
    {
      name: "TechStack",
      description: "技术栈组件，如框架、库、工具",
      source: "core",
      extendedAttributes: ["version", "category"],
      registeredAt: now,
    },
    {
      name: "Agent",
      description: "AI Agent 实体",
      source: "core",
      extendedAttributes: ["agentType", "capabilities"],
      registeredAt: now,
    },
    {
      name: "Role",
      description: "Agent 角色定义",
      source: "core",
      extendedAttributes: ["permissions", "responsibilities"],
      registeredAt: now,
    },
    {
      name: "Mission",
      description: "任务实体，表示一次 Agent 执行任务",
      source: "core",
      extendedAttributes: ["objective", "status", "assignedAgents"],
      registeredAt: now,
    },
    {
      name: "Bug",
      description: "缺陷记录，包含根因和修复方案",
      source: "core",
      extendedAttributes: ["severity", "rootCause", "fix"],
      registeredAt: now,
    },
    {
      name: "Config",
      description: "配置项，表示系统或项目配置",
      source: "core",
      extendedAttributes: ["configType", "values"],
      registeredAt: now,
    },
  ];
}

// ---------------------------------------------------------------------------
// 11 个核心关系类型 (Requirement 1.2)
// ---------------------------------------------------------------------------

function buildCoreRelationTypes(): RelationTypeDefinition[] {
  const now = new Date().toISOString();
  return [
    {
      name: "DEPENDS_ON",
      description: "依赖关系，源实体依赖目标实体",
      source: "core",
      sourceEntityTypes: [],
      targetEntityTypes: [],
      registeredAt: now,
    },
    {
      name: "CALLS",
      description: "调用关系，源实体调用目标实体",
      source: "core",
      sourceEntityTypes: [],
      targetEntityTypes: [],
      registeredAt: now,
    },
    {
      name: "IMPLEMENTS",
      description: "实现关系，源实体实现目标实体定义的接口或规则",
      source: "core",
      sourceEntityTypes: [],
      targetEntityTypes: [],
      registeredAt: now,
    },
    {
      name: "DECIDED_BY",
      description: "决策关系，源实体由目标架构决策决定",
      source: "core",
      sourceEntityTypes: [],
      targetEntityTypes: ["ArchitectureDecision"],
      registeredAt: now,
    },
    {
      name: "SUPERSEDES",
      description: "替代关系，源实体替代目标实体",
      source: "core",
      sourceEntityTypes: ["ArchitectureDecision"],
      targetEntityTypes: ["ArchitectureDecision"],
      registeredAt: now,
    },
    {
      name: "USES",
      description: "使用关系，源实体使用目标实体",
      source: "core",
      sourceEntityTypes: [],
      targetEntityTypes: [],
      registeredAt: now,
    },
    {
      name: "CAUSED_BY",
      description: "因果关系，源实体（Bug）由目标实体引起",
      source: "core",
      sourceEntityTypes: ["Bug"],
      targetEntityTypes: [],
      registeredAt: now,
    },
    {
      name: "RESOLVED_BY",
      description: "解决关系，源实体（Bug）由目标实体解决",
      source: "core",
      sourceEntityTypes: ["Bug"],
      targetEntityTypes: [],
      registeredAt: now,
    },
    {
      name: "BELONGS_TO",
      description: "归属关系，源实体属于目标实体",
      source: "core",
      sourceEntityTypes: [],
      targetEntityTypes: [],
      registeredAt: now,
    },
    {
      name: "EXECUTED_BY",
      description: "执行关系，源实体由目标 Mission 执行产生",
      source: "core",
      sourceEntityTypes: [],
      targetEntityTypes: ["Mission"],
      registeredAt: now,
    },
    {
      name: "KNOWS_ABOUT",
      description: "认知关系，Agent 了解某个实体",
      source: "core",
      sourceEntityTypes: ["Agent"],
      targetEntityTypes: [],
      registeredAt: now,
    },
  ];
}

// ---------------------------------------------------------------------------
// OntologyRegistry 类
// ---------------------------------------------------------------------------

export class OntologyRegistry {
  private entityTypes: Map<string, EntityTypeDefinition>;
  private relationTypes: Map<string, RelationTypeDefinition>;
  private listeners: Array<() => void>;

  constructor() {
    this.entityTypes = new Map();
    this.relationTypes = new Map();
    this.listeners = [];

    // 先初始化核心类型
    for (const et of buildCoreEntityTypes()) {
      this.entityTypes.set(et.name, et);
    }
    for (const rt of buildCoreRelationTypes()) {
      this.relationTypes.set(rt.name, rt);
    }

    // 从持久化文件加载（会合并自定义类型）
    this.load();
  }

  // -------------------------------------------------------------------------
  // 查询 (Requirement 1.5)
  // -------------------------------------------------------------------------

  getEntityTypes(): EntityTypeDefinition[] {
    return Array.from(this.entityTypes.values());
  }

  getRelationTypes(): RelationTypeDefinition[] {
    return Array.from(this.relationTypes.values());
  }

  getEntityType(name: string): EntityTypeDefinition | undefined {
    return this.entityTypes.get(name);
  }

  getRelationType(name: string): RelationTypeDefinition | undefined {
    return this.relationTypes.get(name);
  }

  // -------------------------------------------------------------------------
  // 扩展 (Requirement 1.6)
  // -------------------------------------------------------------------------

  registerEntityType(
    definition: Omit<EntityTypeDefinition, "source" | "registeredAt">,
  ): void {
    const full: EntityTypeDefinition = {
      ...definition,
      source: "custom",
      registeredAt: new Date().toISOString(),
    };
    this.entityTypes.set(full.name, full);
    this.save();
    this.notifyListeners();
  }

  registerRelationType(
    definition: Omit<RelationTypeDefinition, "source" | "registeredAt">,
  ): void {
    const full: RelationTypeDefinition = {
      ...definition,
      source: "custom",
      registeredAt: new Date().toISOString(),
    };
    this.relationTypes.set(full.name, full);
    this.save();
    this.notifyListeners();
  }

  // -------------------------------------------------------------------------
  // 事件 (Requirement 1.7) — ontology.changed
  // -------------------------------------------------------------------------

  onChange(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        console.error("[OntologyRegistry] Listener error:", e);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 持久化
  // -------------------------------------------------------------------------

  load(): void {
    try {
      if (fs.existsSync(ONTOLOGY_FILE)) {
        const raw = fs.readFileSync(ONTOLOGY_FILE, "utf-8");
        const data: OntologyData = JSON.parse(raw);

        // 合并持久化的类型（自定义类型覆盖，核心类型保留内存版本）
        if (Array.isArray(data.entityTypes)) {
          for (const et of data.entityTypes) {
            if (et.source === "custom") {
              this.entityTypes.set(et.name, et);
            }
          }
        }
        if (Array.isArray(data.relationTypes)) {
          for (const rt of data.relationTypes) {
            if (rt.source === "custom") {
              this.relationTypes.set(rt.name, rt);
            }
          }
        }
      }
    } catch (e) {
      console.error("[OntologyRegistry] Failed to load ontology, using defaults:", e);
    }
  }

  save(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const data: OntologyData = {
        entityTypes: this.getEntityTypes(),
        relationTypes: this.getRelationTypes(),
      };
      fs.writeFileSync(ONTOLOGY_FILE, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
      console.error("[OntologyRegistry] Failed to save ontology:", e);
    }
  }
}
