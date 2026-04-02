import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { OntologyRegistry } from "../knowledge/ontology-registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../data/knowledge");
const ONTOLOGY_FILE = path.join(DATA_DIR, "ontology.json");

/** Clean up persisted ontology file between tests */
function cleanupOntologyFile(): void {
  try {
    if (fs.existsSync(ONTOLOGY_FILE)) fs.unlinkSync(ONTOLOGY_FILE);
  } catch {
    // ignore
  }
}

describe("OntologyRegistry", () => {
  beforeEach(() => {
    cleanupOntologyFile();
  });

  afterEach(() => {
    cleanupOntologyFile();
  });

  // -------------------------------------------------------------------------
  // Core entity types (Requirement 1.1)
  // -------------------------------------------------------------------------

  describe("core entity types", () => {
    it("initializes with exactly 10 core entity types", () => {
      const registry = new OntologyRegistry();
      const types = registry.getEntityTypes();
      expect(types).toHaveLength(10);
    });

    it("contains all required entity type names", () => {
      const registry = new OntologyRegistry();
      const names = registry.getEntityTypes().map((t) => t.name);
      const expected = [
        "CodeModule", "API", "BusinessRule", "ArchitectureDecision",
        "TechStack", "Agent", "Role", "Mission", "Bug", "Config",
      ];
      for (const name of expected) {
        expect(names).toContain(name);
      }
    });

    it("marks all core entity types with source 'core'", () => {
      const registry = new OntologyRegistry();
      for (const et of registry.getEntityTypes()) {
        expect(et.source).toBe("core");
      }
    });

    it("CodeModule has correct extendedAttributes", () => {
      const registry = new OntologyRegistry();
      const cm = registry.getEntityType("CodeModule");
      expect(cm).toBeDefined();
      expect(cm!.extendedAttributes).toEqual(
        ["filePath", "language", "linesOfCode", "complexity", "exports"],
      );
    });

    it("API has correct extendedAttributes", () => {
      const registry = new OntologyRegistry();
      const api = registry.getEntityType("API");
      expect(api).toBeDefined();
      expect(api!.extendedAttributes).toEqual(
        ["endpoint", "httpMethod", "requestSchema", "responseSchema", "authRequired"],
      );
    });

    it("ArchitectureDecision has correct extendedAttributes", () => {
      const registry = new OntologyRegistry();
      const ad = registry.getEntityType("ArchitectureDecision");
      expect(ad).toBeDefined();
      expect(ad!.extendedAttributes).toEqual(
        ["context", "decision", "alternatives", "consequences", "supersededBy"],
      );
    });
  });

  // -------------------------------------------------------------------------
  // Core relation types (Requirement 1.2)
  // -------------------------------------------------------------------------

  describe("core relation types", () => {
    it("initializes with exactly 11 core relation types", () => {
      const registry = new OntologyRegistry();
      const types = registry.getRelationTypes();
      expect(types).toHaveLength(11);
    });

    it("contains all required relation type names", () => {
      const registry = new OntologyRegistry();
      const names = registry.getRelationTypes().map((t) => t.name);
      const expected = [
        "DEPENDS_ON", "CALLS", "IMPLEMENTS", "DECIDED_BY", "SUPERSEDES",
        "USES", "CAUSED_BY", "RESOLVED_BY", "BELONGS_TO", "EXECUTED_BY",
        "KNOWS_ABOUT",
      ];
      for (const name of expected) {
        expect(names).toContain(name);
      }
    });

    it("marks all core relation types with source 'core'", () => {
      const registry = new OntologyRegistry();
      for (const rt of registry.getRelationTypes()) {
        expect(rt.source).toBe("core");
      }
    });
  });

  // -------------------------------------------------------------------------
  // getEntityType / getRelationType lookup
  // -------------------------------------------------------------------------

  describe("type lookup", () => {
    it("getEntityType returns the definition for a known type", () => {
      const registry = new OntologyRegistry();
      const bug = registry.getEntityType("Bug");
      expect(bug).toBeDefined();
      expect(bug!.name).toBe("Bug");
      expect(bug!.extendedAttributes).toEqual(["severity", "rootCause", "fix"]);
    });

    it("getEntityType returns undefined for unknown type", () => {
      const registry = new OntologyRegistry();
      expect(registry.getEntityType("NonExistent")).toBeUndefined();
    });

    it("getRelationType returns the definition for a known type", () => {
      const registry = new OntologyRegistry();
      const dep = registry.getRelationType("DEPENDS_ON");
      expect(dep).toBeDefined();
      expect(dep!.name).toBe("DEPENDS_ON");
    });

    it("getRelationType returns undefined for unknown type", () => {
      const registry = new OntologyRegistry();
      expect(registry.getRelationType("UNKNOWN_REL")).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // registerEntityType (Requirement 1.6)
  // -------------------------------------------------------------------------

  describe("registerEntityType", () => {
    it("adds a custom entity type with source 'custom'", () => {
      const registry = new OntologyRegistry();
      registry.registerEntityType({
        name: "CustomWidget",
        description: "A custom widget type",
        extendedAttributes: ["widgetColor", "widgetSize"],
      });

      const custom = registry.getEntityType("CustomWidget");
      expect(custom).toBeDefined();
      expect(custom!.source).toBe("custom");
      expect(custom!.extendedAttributes).toEqual(["widgetColor", "widgetSize"]);
      expect(custom!.registeredAt).toBeTruthy();
    });

    it("increases total entity type count after registration", () => {
      const registry = new OntologyRegistry();
      const before = registry.getEntityTypes().length;
      registry.registerEntityType({
        name: "NewType",
        description: "test",
        extendedAttributes: [],
      });
      expect(registry.getEntityTypes().length).toBe(before + 1);
    });

    it("getEntityTypes includes both core and custom types (Requirement 1.5)", () => {
      const registry = new OntologyRegistry();
      registry.registerEntityType({
        name: "Foo",
        description: "foo",
        extendedAttributes: [],
      });
      const types = registry.getEntityTypes();
      const sources = new Set(types.map((t) => t.source));
      expect(sources.has("core")).toBe(true);
      expect(sources.has("custom")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // registerRelationType (Requirement 1.6)
  // -------------------------------------------------------------------------

  describe("registerRelationType", () => {
    it("adds a custom relation type with source 'custom'", () => {
      const registry = new OntologyRegistry();
      registry.registerRelationType({
        name: "MENTORS",
        description: "Mentoring relationship",
        sourceEntityTypes: ["Agent"],
        targetEntityTypes: ["Agent"],
      });

      const custom = registry.getRelationType("MENTORS");
      expect(custom).toBeDefined();
      expect(custom!.source).toBe("custom");
      expect(custom!.registeredAt).toBeTruthy();
    });

    it("increases total relation type count after registration", () => {
      const registry = new OntologyRegistry();
      const before = registry.getRelationTypes().length;
      registry.registerRelationType({
        name: "LINKS_TO",
        description: "test",
        sourceEntityTypes: [],
        targetEntityTypes: [],
      });
      expect(registry.getRelationTypes().length).toBe(before + 1);
    });
  });

  // -------------------------------------------------------------------------
  // onChange event (Requirement 1.7)
  // -------------------------------------------------------------------------

  describe("onChange event", () => {
    it("fires listener when registerEntityType is called", () => {
      const registry = new OntologyRegistry();
      const listener = vi.fn();
      registry.onChange(listener);

      registry.registerEntityType({
        name: "Evt1",
        description: "test",
        extendedAttributes: [],
      });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("fires listener when registerRelationType is called", () => {
      const registry = new OntologyRegistry();
      const listener = vi.fn();
      registry.onChange(listener);

      registry.registerRelationType({
        name: "EVT_REL",
        description: "test",
        sourceEntityTypes: [],
        targetEntityTypes: [],
      });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("fires multiple listeners", () => {
      const registry = new OntologyRegistry();
      const l1 = vi.fn();
      const l2 = vi.fn();
      registry.onChange(l1);
      registry.onChange(l2);

      registry.registerEntityType({
        name: "Multi",
        description: "test",
        extendedAttributes: [],
      });

      expect(l1).toHaveBeenCalledTimes(1);
      expect(l2).toHaveBeenCalledTimes(1);
    });

    it("unsubscribe stops listener from being called", () => {
      const registry = new OntologyRegistry();
      const listener = vi.fn();
      const unsub = registry.onChange(listener);

      unsub();

      registry.registerEntityType({
        name: "AfterUnsub",
        description: "test",
        extendedAttributes: [],
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it("does not crash when a listener throws", () => {
      const registry = new OntologyRegistry();
      const badListener = vi.fn(() => { throw new Error("boom"); });
      const goodListener = vi.fn();
      registry.onChange(badListener);
      registry.onChange(goodListener);

      // Should not throw
      registry.registerEntityType({
        name: "Safe",
        description: "test",
        extendedAttributes: [],
      });

      expect(badListener).toHaveBeenCalledTimes(1);
      expect(goodListener).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  describe("persistence", () => {
    it("saves ontology to data/knowledge/ontology.json on registration", () => {
      const registry = new OntologyRegistry();
      registry.registerEntityType({
        name: "Persisted",
        description: "test",
        extendedAttributes: ["a"],
      });

      expect(fs.existsSync(ONTOLOGY_FILE)).toBe(true);
      const data = JSON.parse(fs.readFileSync(ONTOLOGY_FILE, "utf-8"));
      const names = data.entityTypes.map((t: any) => t.name);
      expect(names).toContain("Persisted");
    });

    it("loads custom types from persisted file on construction", () => {
      // First registry: register a custom type
      const r1 = new OntologyRegistry();
      r1.registerEntityType({
        name: "Reloaded",
        description: "survives reload",
        extendedAttributes: ["x"],
      });
      r1.registerRelationType({
        name: "CUSTOM_REL",
        description: "custom relation",
        sourceEntityTypes: [],
        targetEntityTypes: [],
      });

      // Second registry: should load the custom types
      const r2 = new OntologyRegistry();
      expect(r2.getEntityType("Reloaded")).toBeDefined();
      expect(r2.getEntityType("Reloaded")!.source).toBe("custom");
      expect(r2.getRelationType("CUSTOM_REL")).toBeDefined();
      expect(r2.getRelationType("CUSTOM_REL")!.source).toBe("custom");

      // Core types still present
      expect(r2.getEntityTypes().length).toBe(11); // 10 core + 1 custom
      expect(r2.getRelationTypes().length).toBe(12); // 11 core + 1 custom
    });

    it("handles missing ontology file gracefully", () => {
      // No file exists — should not throw
      const registry = new OntologyRegistry();
      expect(registry.getEntityTypes().length).toBe(10);
      expect(registry.getRelationTypes().length).toBe(11);
    });

    it("handles corrupted ontology file gracefully", () => {
      // Write garbage to the file
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(ONTOLOGY_FILE, "NOT VALID JSON!!!", "utf-8");

      // Should not throw, falls back to defaults
      const registry = new OntologyRegistry();
      expect(registry.getEntityTypes().length).toBe(10);
      expect(registry.getRelationTypes().length).toBe(11);
    });
  });
});
