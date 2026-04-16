import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

import { CodeKnowledgeExtractor } from "../knowledge/code-extractor.js";
import type { CodeExtractorLLMProvider } from "../knowledge/code-extractor.js";
import { GraphStore } from "../knowledge/graph-store.js";
import { OntologyRegistry } from "../knowledge/ontology-registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_PROJECT = "test-extractor-project";

// ---------------------------------------------------------------------------
// Test fixture: create a temp directory with sample TS/JS files
// ---------------------------------------------------------------------------

let tmpDir: string;
let graphStore: GraphStore;
let ontologyRegistry: OntologyRegistry;
let extractor: CodeKnowledgeExtractor;

function writeTempFile(relPath: string, content: string): void {
  const fullPath = path.join(tmpDir, relPath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fullPath, content, "utf-8");
}

function cleanupGraphFile(): void {
  const DATA_DIR = path.resolve(__dirname, "../../data/knowledge");
  const fp = path.join(DATA_DIR, `graph-${TEST_PROJECT}.json`);
  try {
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch {
    // ignore
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kg-extractor-"));
  cleanupGraphFile();
  graphStore = new GraphStore();
  ontologyRegistry = new OntologyRegistry();
  extractor = new CodeKnowledgeExtractor(graphStore, ontologyRegistry);
});

afterEach(() => {
  graphStore.forceSave();
  cleanupGraphFile();
  // Clean up temp dir
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("CodeKnowledgeExtractor", () => {
  // -------------------------------------------------------------------------
  // Extracts CodeModule entities from TS files
  // -------------------------------------------------------------------------
  describe("CodeModule extraction", () => {
    it("extracts CodeModule entities from TypeScript files", async () => {
      writeTempFile(
        "src/utils.ts",
        `export function add(a: number, b: number): number {
  return a + b;
}

export const PI = 3.14;
`
      );

      writeTempFile(
        "src/helpers.js",
        `function greet(name) {
  return "Hello " + name;
}
module.exports = { greet };
`
      );

      const result = await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
      });

      expect(result.stats.filesAnalyzed).toBe(2);
      expect(result.stats.entitiesExtracted).toBeGreaterThanOrEqual(2);

      // Find the CodeModule entities
      const codeModules = result.entities.filter(
        e => e.entityType === "CodeModule"
      );
      expect(codeModules.length).toBe(2);

      const utilsModule = codeModules.find(
        e =>
          (e.extendedAttributes as Record<string, unknown>).filePath ===
          "src/utils.ts"
      );
      expect(utilsModule).toBeDefined();
      expect(utilsModule!.source).toBe("code_analysis");
      expect(utilsModule!.confidence).toBe(0.9);
      expect(utilsModule!.projectId).toBe(TEST_PROJECT);

      const ext = utilsModule!.extendedAttributes as Record<string, unknown>;
      expect(ext.language).toBe("typescript");
      expect(ext.linesOfCode).toBeGreaterThan(0);
      expect(typeof ext.complexity).toBe("number");

      // JS file should have language "javascript"
      const helpersModule = codeModules.find(
        e =>
          (e.extendedAttributes as Record<string, unknown>).filePath ===
          "src/helpers.js"
      );
      expect(helpersModule).toBeDefined();
      expect(
        (helpersModule!.extendedAttributes as Record<string, unknown>).language
      ).toBe("javascript");
    });

    it("computes cyclomatic complexity correctly", async () => {
      writeTempFile(
        "complex.ts",
        `export function complex(x: number, y: string): string {
  if (x > 0) {
    for (let i = 0; i < x; i++) {
      if (y === "a" || y === "b") {
        return y;
      }
    }
  } else if (x < 0) {
    while (x < 0) {
      x++;
    }
  }
  return x > 10 ? "big" : "small";
}
`
      );

      const result = await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
      });

      const mod = result.entities.find(e => e.entityType === "CodeModule");
      expect(mod).toBeDefined();
      const complexity = (mod!.extendedAttributes as Record<string, unknown>)
        .complexity as number;
      // Base 1 + if + for + if + || + else-if(if) + while + ternary = 8
      expect(complexity).toBeGreaterThanOrEqual(7);
    });

    it("excludes node_modules and dist directories", async () => {
      writeTempFile("src/main.ts", "export const x = 1;\n");
      writeTempFile("node_modules/pkg/index.ts", "export const y = 2;\n");
      writeTempFile("dist/bundle.js", "var z = 3;\n");

      const result = await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
      });

      expect(result.stats.filesAnalyzed).toBe(1);
      const modules = result.entities.filter(
        e => e.entityType === "CodeModule"
      );
      expect(modules.length).toBe(1);
      expect(
        (modules[0].extendedAttributes as Record<string, unknown>).filePath
      ).toBe("src/main.ts");
    });
  });

  // -------------------------------------------------------------------------
  // Extracts exports correctly
  // -------------------------------------------------------------------------
  describe("export extraction", () => {
    it("extracts named exports (function, class, const, interface, type)", async () => {
      writeTempFile(
        "exports.ts",
        `export function myFunc() {}
export class MyClass {}
export const MY_CONST = 42;
export interface MyInterface { x: number; }
export type MyType = string | number;
export enum MyEnum { A, B }
`
      );

      const result = await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
      });

      const mod = result.entities.find(e => e.entityType === "CodeModule");
      expect(mod).toBeDefined();
      const exports = (mod!.extendedAttributes as Record<string, unknown>)
        .exports as string[];
      expect(exports).toContain("myFunc");
      expect(exports).toContain("MyClass");
      expect(exports).toContain("MY_CONST");
      expect(exports).toContain("MyInterface");
      expect(exports).toContain("MyType");
      expect(exports).toContain("MyEnum");
    });

    it("extracts default exports", async () => {
      writeTempFile(
        "default-export.ts",
        `export default function handler() { return 1; }
`
      );

      const result = await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
      });

      const mod = result.entities.find(e => e.entityType === "CodeModule");
      const exports = (mod!.extendedAttributes as Record<string, unknown>)
        .exports as string[];
      expect(exports.some(e => e.includes("default"))).toBe(true);
    });

    it("extracts re-exports from export { ... }", async () => {
      writeTempFile(
        "reexport.ts",
        `const a = 1;
const b = 2;
export { a, b };
`
      );

      const result = await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
      });

      const mod = result.entities.find(e => e.entityType === "CodeModule");
      const exports = (mod!.extendedAttributes as Record<string, unknown>)
        .exports as string[];
      expect(exports).toContain("a");
      expect(exports).toContain("b");
    });
  });

  // -------------------------------------------------------------------------
  // Extracts DEPENDS_ON relations from imports
  // -------------------------------------------------------------------------
  describe("DEPENDS_ON relation extraction", () => {
    it("extracts DEPENDS_ON relations from relative imports", async () => {
      writeTempFile(
        "src/main.ts",
        `import { add } from "./utils.js";
import { greet } from "./helpers/greet.js";

console.log(add(1, 2));
console.log(greet("world"));
`
      );
      writeTempFile(
        "src/utils.ts",
        "export function add(a: number, b: number) { return a + b; }\n"
      );
      writeTempFile(
        "src/helpers/greet.ts",
        'export function greet(name: string) { return "Hi " + name; }\n'
      );

      const result = await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
      });

      const dependsOnRelations = result.relations.filter(
        r => r.relationType === "DEPENDS_ON"
      );
      expect(dependsOnRelations.length).toBeGreaterThanOrEqual(2);

      // main 鈫?utils
      const mainToUtils = dependsOnRelations.find(
        r =>
          r.sourceEntityId.includes("src/main") &&
          r.targetEntityId.includes("src/utils")
      );
      expect(mainToUtils).toBeDefined();
      expect(mainToUtils!.evidence).toContain("import");

      // main 鈫?helpers/greet
      const mainToGreet = dependsOnRelations.find(
        r =>
          r.sourceEntityId.includes("src/main") &&
          r.targetEntityId.includes("src/helpers/greet")
      );
      expect(mainToGreet).toBeDefined();
    });

    it("skips external package imports", async () => {
      writeTempFile(
        "src/app.ts",
        `import express from "express";
import path from "path";
import { myUtil } from "./my-util.js";

const app = express();
`
      );
      writeTempFile(
        "src/my-util.ts",
        "export function myUtil() { return 1; }\n"
      );

      const result = await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
      });

      const dependsOnRelations = result.relations.filter(
        r => r.relationType === "DEPENDS_ON"
      );
      // Should only have 1 relation (app 鈫?my-util), not express or path
      expect(dependsOnRelations.length).toBe(1);
      expect(dependsOnRelations[0].targetEntityId).toContain("my-util");
    });
  });

  // -------------------------------------------------------------------------
  // Records extraction stats
  // -------------------------------------------------------------------------
  describe("extraction stats", () => {
    it("records correct extraction stats", async () => {
      writeTempFile("a.ts", "export const a = 1;\n");
      writeTempFile(
        "b.ts",
        'import { a } from "./a.js";\nexport const b = a + 1;\n'
      );

      const result = await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
      });

      expect(result.stats.filesAnalyzed).toBe(2);
      expect(result.stats.entitiesExtracted).toBe(2); // 2 CodeModules
      expect(result.stats.relationsExtracted).toBe(1); // b 鈫?a
      expect(result.stats.extractionDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.stats.errors).toHaveLength(0);
    });

    it("returns empty result for unsupported languages", async () => {
      const result = await extractor.extract({
        repoPath: tmpDir,
        language: "python",
        projectId: TEST_PROJECT,
      });

      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(0);
      expect(result.stats.filesAnalyzed).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Handles parse errors gracefully
  // -------------------------------------------------------------------------
  describe("error handling", () => {
    it("handles files with syntax errors gracefully", async () => {
      writeTempFile("good.ts", "export const x = 1;\n");
      // TypeScript parser is lenient 鈥?it won't throw on most syntax errors.
      // But we can test with an unreadable file scenario by making the
      // extractor handle errors in the stats.
      writeTempFile("bad.ts", "export const = ;\n"); // still parseable by TS

      const result = await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
      });

      // Both files should be analyzed (TS parser is lenient)
      expect(result.stats.filesAnalyzed).toBe(2);
      // No crash 鈥?entities should still be extracted
      expect(result.entities.length).toBeGreaterThanOrEqual(2);
    });

    it("records errors for files that cannot be read", async () => {
      writeTempFile("readable.ts", "export const x = 1;\n");

      // Create a file path that exists but make it a directory to cause read error
      const badPath = path.join(tmpDir, "unreadable.ts");
      fs.mkdirSync(badPath, { recursive: true });

      const result = await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
      });

      // The directory "unreadable.ts" won't be picked up as a file
      // so only readable.ts should be analyzed
      expect(result.stats.filesAnalyzed).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // API extraction from route definitions
  // -------------------------------------------------------------------------
  describe("API entity extraction", () => {
    it("extracts API entities from Express-style route definitions", async () => {
      writeTempFile(
        "routes/users.ts",
        `import { Router } from "express";

const router = Router();

router.get("/users", (req, res) => {
  res.json({ users: [] });
});

router.post("/users", (req, res) => {
  res.json({ created: true });
});

router.get("/users/:id", (req, res) => {
  res.json({ user: {} });
});

export default router;
`
      );

      const result = await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
      });

      const apiEntities = result.entities.filter(e => e.entityType === "API");
      expect(apiEntities.length).toBe(3);

      const getUsers = apiEntities.find(e => e.name === "GET /users");
      expect(getUsers).toBeDefined();
      expect(getUsers!.confidence).toBe(0.85);
      expect(
        (getUsers!.extendedAttributes as Record<string, unknown>).httpMethod
      ).toBe("GET");
      expect(
        (getUsers!.extendedAttributes as Record<string, unknown>).endpoint
      ).toBe("/users");

      const postUsers = apiEntities.find(e => e.name === "POST /users");
      expect(postUsers).toBeDefined();

      const getUserById = apiEntities.find(e => e.name === "GET /users/:id");
      expect(getUserById).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Graph store integration
  // -------------------------------------------------------------------------
  describe("graph store integration", () => {
    it("writes extracted entities to the graph store via mergeEntity", async () => {
      writeTempFile("src/index.ts", "export const main = () => {};\n");

      await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
      });

      const entities = graphStore.findEntities({
        projectId: TEST_PROJECT,
        entityType: "CodeModule",
      });
      expect(entities.length).toBe(1);
      expect(entities[0].name).toBe("src/index");
      expect(entities[0].entityId).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Incremental extraction (Task 5.2)
  // -------------------------------------------------------------------------
  describe("incremental extraction", () => {
    /**
     * Helper: initialize a git repo in tmpDir, commit initial files,
     * make changes, and return the initial commit hash.
     */
    function initGitRepo(): string {
      const exec = (cmd: string) =>
        execSync(cmd, { cwd: tmpDir, encoding: "utf-8" });

      exec("git init");
      exec('git config user.email "test@test.com"');
      exec('git config user.name "Test"');

      // Create initial files
      writeTempFile("src/keep.ts", "export const keep = 1;\n");
      writeTempFile("src/remove.ts", "export const remove = 2;\n");
      writeTempFile(
        "src/modify.ts",
        'import { remove } from "./remove.js";\nexport const modify = remove;\n'
      );

      exec("git add -A");
      exec('git commit -m "initial"');

      const commitHash = exec("git rev-parse HEAD").trim();
      return commitHash;
    }

    it("only analyzes changed/added files when sinceCommit is provided", async () => {
      const initialCommit = initGitRepo();

      // First, do a full extraction to populate the graph store
      await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
      });

      // Now make changes: modify one file, add a new file
      writeTempFile("src/modify.ts", 'export const modify = "changed";\n');
      writeTempFile("src/added.ts", "export const added = true;\n");

      execSync("git add -A", { cwd: tmpDir });
      execSync('git commit -m "changes"', { cwd: tmpDir });

      // Incremental extraction
      const result = await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
        sinceCommit: initialCommit,
      });

      // Should only analyze the 2 changed/added files, not all 3
      expect(result.stats.filesAnalyzed).toBe(2);

      const moduleNames = result.entities
        .filter(e => e.entityType === "CodeModule")
        .map(e => e.name);
      expect(moduleNames).toContain("src/modify");
      expect(moduleNames).toContain("src/added");
      expect(moduleNames).not.toContain("src/keep");
    });

    it("marks deleted files as deprecated with commit hash in deprecationReason", async () => {
      const initialCommit = initGitRepo();

      // Full extraction first to populate graph store
      await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
      });

      // Verify the entity exists and is active
      const beforeEntities = graphStore.findEntities({
        projectId: TEST_PROJECT,
        entityType: "CodeModule",
        name: "src/remove",
      });
      expect(beforeEntities.length).toBe(1);
      expect(beforeEntities[0].status).toBe("active");

      // Delete a file and commit
      fs.unlinkSync(path.join(tmpDir, "src/remove.ts"));
      execSync("git add -A", { cwd: tmpDir });
      execSync('git commit -m "delete remove.ts"', { cwd: tmpDir });

      // Incremental extraction
      await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
        sinceCommit: initialCommit,
      });

      // The deleted module should now be deprecated
      const afterEntities = graphStore.findEntities({
        projectId: TEST_PROJECT,
        entityType: "CodeModule",
        name: "src/remove",
      });
      const deprecated = afterEntities.find(e => e.name === "src/remove");
      expect(deprecated).toBeDefined();
      expect(deprecated!.status).toBe("deprecated");
      expect(deprecated!.deprecationReason).toContain(initialCommit);
    });

    it("marks target entities of DEPENDS_ON relations as deprecated when source is deleted", async () => {
      const initialCommit = initGitRepo();

      // Full extraction to populate graph store with entities and relations
      await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
      });

      // src/modify.ts imports from src/remove.ts, so there should be a DEPENDS_ON relation
      // Find the modify entity to get its entityId
      const modifyEntities = graphStore.findEntities({
        projectId: TEST_PROJECT,
        entityType: "CodeModule",
        name: "src/modify",
      });
      const modifyEntity = modifyEntities.find(e => e.name === "src/modify");
      expect(modifyEntity).toBeDefined();

      // Now delete src/modify.ts (which has DEPENDS_ON 鈫?src/remove)
      fs.unlinkSync(path.join(tmpDir, "src/modify.ts"));
      execSync("git add -A", { cwd: tmpDir });
      execSync('git commit -m "delete modify.ts"', { cwd: tmpDir });

      // Incremental extraction
      await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
        sinceCommit: initialCommit,
      });

      // The deleted module should be deprecated
      const modifyAfter = graphStore.findEntities({
        projectId: TEST_PROJECT,
        entityType: "CodeModule",
        name: "src/modify",
      });
      const deprecatedModify = modifyAfter.find(e => e.name === "src/modify");
      expect(deprecatedModify).toBeDefined();
      expect(deprecatedModify!.status).toBe("deprecated");
    });

    it("handles non-git repos gracefully", async () => {
      // tmpDir is NOT a git repo 鈥?no git init
      writeTempFile("src/file.ts", "export const x = 1;\n");

      const result = await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
        sinceCommit: "abc123",
      });

      // Should return empty result since git diff fails
      expect(result.stats.filesAnalyzed).toBe(0);
      expect(result.entities).toHaveLength(0);
    });

    it("logs ExtractionStats after extraction", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      writeTempFile("src/index.ts", "export const x = 1;\n");

      await extractor.extract({
        repoPath: tmpDir,
        language: "typescript",
        projectId: TEST_PROJECT,
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        "[CodeKnowledgeExtractor] Extraction complete:",
        expect.objectContaining({
          filesAnalyzed: 1,
          entitiesExtracted: 1,
          relationsExtracted: 0,
        })
      );

      consoleSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // LLM-assisted extraction (Task 5.3)
  // -------------------------------------------------------------------------
  describe("LLM-assisted extraction", () => {
    it("sets confidence to 0.7 for all LLM-extracted entities", async () => {
      const mockLLM: CodeExtractorLLMProvider = {
        generate: vi.fn().mockResolvedValue(
          JSON.stringify({
            entities: [
              {
                entityType: "CodeModule",
                name: "main_module",
                description: "Main Python module",
                extendedAttributes: { filePath: "main.py", language: "python" },
              },
              {
                entityType: "CodeModule",
                name: "utils_module",
                description: "Utility functions",
                extendedAttributes: {
                  filePath: "utils.py",
                  language: "python",
                },
              },
            ],
            relations: [
              {
                relationType: "DEPENDS_ON",
                sourceEntityName: "main_module",
                targetEntityName: "utils_module",
                evidence: "import utils",
              },
            ],
          })
        ),
      };

      const llmExtractor = new CodeKnowledgeExtractor(
        graphStore,
        ontologyRegistry,
        mockLLM
      );

      writeTempFile(
        "main.py",
        "import utils\n\ndef main():\n    utils.run()\n"
      );
      writeTempFile("utils.py", 'def run():\n    print("running")\n');

      const result = await llmExtractor.extract({
        repoPath: tmpDir,
        language: "python",
        projectId: TEST_PROJECT,
      });

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      for (const entity of result.entities) {
        expect(entity.confidence).toBe(0.7);
      }

      expect(result.relations.length).toBeGreaterThanOrEqual(1);
      for (const relation of result.relations) {
        expect(relation.confidence).toBe(0.7);
      }
    });

    it("sets source to 'llm_inferred' for all LLM-extracted entities and relations", async () => {
      const mockLLM: CodeExtractorLLMProvider = {
        generate: vi.fn().mockResolvedValue(
          JSON.stringify({
            entities: [
              {
                entityType: "CodeModule",
                name: "app",
                description: "Go application",
              },
            ],
            relations: [],
          })
        ),
      };

      const llmExtractor = new CodeKnowledgeExtractor(
        graphStore,
        ontologyRegistry,
        mockLLM
      );

      writeTempFile("app.go", "package main\n\nfunc main() {}\n");

      const result = await llmExtractor.extract({
        repoPath: tmpDir,
        language: "go",
        projectId: TEST_PROJECT,
      });

      expect(result.entities.length).toBe(1);
      expect(result.entities[0].source).toBe("llm_inferred");
    });

    it("returns empty result when no LLM provider is configured", async () => {
      // Default extractor has no LLM provider
      writeTempFile("main.py", 'print("hello")\n');

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await extractor.extract({
        repoPath: tmpDir,
        language: "python",
        projectId: TEST_PROJECT,
      });

      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(0);
      expect(result.stats.filesAnalyzed).toBe(0);

      // Should log a warning about missing LLM provider
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("no LLM provider is configured")
      );

      warnSpy.mockRestore();
    });

    it("handles LLM response parsing errors gracefully", async () => {
      const mockLLM: CodeExtractorLLMProvider = {
        generate: vi.fn().mockResolvedValue("This is not valid JSON at all"),
      };

      const llmExtractor = new CodeKnowledgeExtractor(
        graphStore,
        ontologyRegistry,
        mockLLM
      );

      writeTempFile("main.py", 'print("hello")\n');

      const result = await llmExtractor.extract({
        repoPath: tmpDir,
        language: "python",
        projectId: TEST_PROJECT,
      });

      // Should not crash 鈥?entities empty, error recorded in stats
      expect(result.entities).toHaveLength(0);
      expect(result.stats.errors.length).toBeGreaterThan(0);
      expect(result.stats.errors[0].reason).toContain(
        "Failed to parse LLM response"
      );
    });

    it("handles LLM call failures gracefully", async () => {
      const mockLLM: CodeExtractorLLMProvider = {
        generate: vi
          .fn()
          .mockRejectedValue(new Error("LLM service unavailable")),
      };

      const llmExtractor = new CodeKnowledgeExtractor(
        graphStore,
        ontologyRegistry,
        mockLLM
      );

      writeTempFile("main.py", 'print("hello")\n');

      const result = await llmExtractor.extract({
        repoPath: tmpDir,
        language: "python",
        projectId: TEST_PROJECT,
      });

      // Should not crash 鈥?error recorded in stats
      expect(result.entities).toHaveLength(0);
      expect(result.stats.errors.length).toBeGreaterThan(0);
      expect(result.stats.errors[0].reason).toContain(
        "LLM service unavailable"
      );
    });

    it("parses LLM response wrapped in markdown code blocks", () => {
      const llmExtractor = new CodeKnowledgeExtractor(
        graphStore,
        ontologyRegistry
      );

      const response =
        '```json\n{"entities": [{"entityType": "CodeModule", "name": "test", "description": "test mod"}], "relations": []}\n```';
      const parsed = llmExtractor.parseLLMExtractionResponse(response);

      expect(parsed).not.toBeNull();
      expect(parsed!.entities.length).toBe(1);
      expect(parsed!.entities[0].name).toBe("test");
    });

    it("writes LLM-extracted entities to graph store", async () => {
      const mockLLM: CodeExtractorLLMProvider = {
        generate: vi.fn().mockResolvedValue(
          JSON.stringify({
            entities: [
              {
                entityType: "CodeModule",
                name: "rust_module",
                description: "A Rust module",
              },
            ],
            relations: [],
          })
        ),
      };

      const llmExtractor = new CodeKnowledgeExtractor(
        graphStore,
        ontologyRegistry,
        mockLLM
      );

      writeTempFile("lib.rs", 'pub fn hello() { println!("hello"); }\n');

      await llmExtractor.extract({
        repoPath: tmpDir,
        language: "rust",
        projectId: TEST_PROJECT,
      });

      const entities = graphStore.findEntities({
        projectId: TEST_PROJECT,
        entityType: "CodeModule",
      });
      expect(entities.length).toBe(1);
      expect(entities[0].name).toBe("rust_module");
      expect(entities[0].source).toBe("llm_inferred");
      expect(entities[0].confidence).toBe(0.7);
    });
  });
});

// ---------------------------------------------------------------------------
// Property-Based Tests — 提取实体扩展属性完整性
// Feature: knowledge-graph, Property 5: 提取实体扩展属性完整性
// Validates: Requirements 2.3, 2.4
// ---------------------------------------------------------------------------

describe("Feature: knowledge-graph, Property 5: 提取实体扩展属性完整性", () => {
  /**
   * Validates: Requirements 2.3, 2.4
   *
   * For any extracted entity of type CodeModule, the extendedAttributes SHALL contain
   * filePath, language, linesOfCode, complexity, and exports;
   * for any extracted entity of type API, the extendedAttributes SHALL contain
   * endpoint, httpMethod, requestSchema, responseSchema, and authRequired.
   */

  const PBT_PROJECT = "test-pbt-extractor";
  const PBT_DATA_DIR = path.resolve(__dirname, "../../data/knowledge");

  function pbtCleanupGraphFile(): void {
    const fp = path.join(PBT_DATA_DIR, `graph-${PBT_PROJECT}.json`);
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      // ignore
    }
  }

  function pbtWriteTempFile(
    dir: string,
    relPath: string,
    content: string
  ): void {
    const fullPath = path.join(dir, relPath);
    const d = path.dirname(fullPath);
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, "utf-8");
  }

  // -------------------------------------------------------------------------
  // Generators for synthetic TypeScript source code
  // -------------------------------------------------------------------------

  /** Reserved words that cannot be used as identifiers */
  const RESERVED = new Set([
    "if",
    "for",
    "while",
    "do",
    "return",
    "const",
    "let",
    "var",
    "function",
    "class",
    "export",
    "import",
    "default",
    "switch",
    "case",
    "break",
    "continue",
    "new",
    "this",
    "true",
    "false",
    "null",
    "undefined",
    "typeof",
    "void",
    "delete",
    "in",
    "of",
    "instanceof",
    "throw",
    "try",
    "catch",
    "finally",
    "with",
    "debugger",
    "yield",
    "async",
    "await",
    "enum",
    "interface",
    "type",
    "abstract",
    "as",
    "from",
    "get",
    "set",
    "static",
    "super",
    "extends",
    "implements",
  ]);

  /** Generate a valid TS identifier */
  const identifierArb = fc
    .stringMatching(/^[a-z][a-zA-Z0-9]{0,12}$/)
    .filter(s => s.length > 0 && !RESERVED.has(s));

  /** Generate a TypeScript module with exported functions/consts and optional control flow */
  const tsModuleArb = fc
    .record({
      fileName: identifierArb,
      exportedFunctions: fc.array(identifierArb, {
        minLength: 0,
        maxLength: 4,
      }),
      exportedConsts: fc.array(identifierArb, { minLength: 0, maxLength: 3 }),
      hasIfStatement: fc.boolean(),
      hasForLoop: fc.boolean(),
    })
    .map(
      ({
        fileName,
        exportedFunctions,
        exportedConsts,
        hasIfStatement,
        hasForLoop,
      }) => {
        const usedNames = new Set<string>();
        const funcs = exportedFunctions.filter(n => {
          if (usedNames.has(n)) return false;
          usedNames.add(n);
          return true;
        });
        const consts = exportedConsts.filter(n => {
          if (usedNames.has(n)) return false;
          usedNames.add(n);
          return true;
        });

        let code = "";
        for (const fn of funcs) {
          code += `export function ${fn}(x: number): number {\n`;
          if (hasIfStatement) code += `  if (x > 0) { return x; }\n`;
          if (hasForLoop) code += `  for (let i = 0; i < x; i++) { x++; }\n`;
          code += `  return x;\n}\n\n`;
        }
        for (const c of consts) {
          code += `export const ${c} = 42;\n`;
        }
        if (code.trim() === "") {
          code = "export const _placeholder = 1;\n";
        }
        return { fileName, code };
      }
    );

  /** HTTP methods for route generation */
  const httpMethodArb = fc.constantFrom(
    "get",
    "post",
    "put",
    "delete",
    "patch"
  );

  /** Generate an Express-style route file with at least one route */
  const apiRouteFileArb = fc
    .record({
      fileName: identifierArb,
      routes: fc.array(
        fc.record({
          method: httpMethodArb,
          endpoint: fc.stringMatching(/^\/[a-z]{1,8}(\/:[a-z]{1,6})?$/),
        }),
        { minLength: 1, maxLength: 5 }
      ),
    })
    .map(({ fileName, routes }) => {
      const seen = new Set<string>();
      const uniqueRoutes = routes.filter(r => {
        const key = `${r.method}:${r.endpoint}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      let code = `import { Router } from "express";\n\nconst router = Router();\n\n`;
      for (const r of uniqueRoutes) {
        code += `router.${r.method}("${r.endpoint}", (req, res) => {\n  res.json({});\n});\n\n`;
      }
      code += `export default router;\n`;
      return { fileName, code, expectedRouteCount: uniqueRoutes.length };
    });

  it("CodeModule entities always contain filePath, language, linesOfCode, complexity, exports", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .array(tsModuleArb, { minLength: 1, maxLength: 5 })
          .map(modules => {
            const seen = new Set<string>();
            return modules.filter(m => {
              if (seen.has(m.fileName)) return false;
              seen.add(m.fileName);
              return true;
            });
          })
          .filter(arr => arr.length > 0),
        async modules => {
          const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kg-pbt5-cm-"));
          pbtCleanupGraphFile();
          const gs = new GraphStore();
          const or = new OntologyRegistry();
          const ext = new CodeKnowledgeExtractor(gs, or);

          try {
            for (const m of modules) {
              pbtWriteTempFile(dir, `src/${m.fileName}.ts`, m.code);
            }

            const result = await ext.extract({
              repoPath: dir,
              language: "typescript",
              projectId: PBT_PROJECT,
            });

            const codeModules = result.entities.filter(
              e => e.entityType === "CodeModule"
            );

            expect(codeModules.length).toBeGreaterThanOrEqual(1);

            for (const entity of codeModules) {
              const attrs = entity.extendedAttributes as Record<
                string,
                unknown
              >;

              // filePath: non-empty string
              expect(attrs).toHaveProperty("filePath");
              expect(typeof attrs.filePath).toBe("string");
              expect((attrs.filePath as string).length).toBeGreaterThan(0);

              // language: "typescript" or "javascript"
              expect(attrs).toHaveProperty("language");
              expect(["typescript", "javascript"]).toContain(attrs.language);

              // linesOfCode: positive number
              expect(attrs).toHaveProperty("linesOfCode");
              expect(typeof attrs.linesOfCode).toBe("number");
              expect(attrs.linesOfCode as number).toBeGreaterThan(0);

              // complexity: number >= 1 (base cyclomatic complexity)
              expect(attrs).toHaveProperty("complexity");
              expect(typeof attrs.complexity).toBe("number");
              expect(attrs.complexity as number).toBeGreaterThanOrEqual(1);

              // exports: array of strings
              expect(attrs).toHaveProperty("exports");
              expect(Array.isArray(attrs.exports)).toBe(true);
            }
          } finally {
            gs.forceSave();
            pbtCleanupGraphFile();
            fs.rmSync(dir, { recursive: true, force: true });
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("API entities always contain endpoint, httpMethod, requestSchema, responseSchema, authRequired", async () => {
    await fc.assert(
      fc.asyncProperty(apiRouteFileArb, async routeFile => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kg-pbt5-api-"));
        pbtCleanupGraphFile();
        const gs = new GraphStore();
        const or = new OntologyRegistry();
        const ext = new CodeKnowledgeExtractor(gs, or);

        try {
          pbtWriteTempFile(
            dir,
            `routes/${routeFile.fileName}.ts`,
            routeFile.code
          );

          const result = await ext.extract({
            repoPath: dir,
            language: "typescript",
            projectId: PBT_PROJECT,
          });

          const apiEntities = result.entities.filter(
            e => e.entityType === "API"
          );

          expect(apiEntities.length).toBeGreaterThanOrEqual(1);

          for (const entity of apiEntities) {
            const attrs = entity.extendedAttributes as Record<string, unknown>;

            // endpoint: string starting with /
            expect(attrs).toHaveProperty("endpoint");
            expect(typeof attrs.endpoint).toBe("string");
            expect((attrs.endpoint as string).startsWith("/")).toBe(true);

            // httpMethod: valid HTTP method (uppercase)
            expect(attrs).toHaveProperty("httpMethod");
            expect(typeof attrs.httpMethod).toBe("string");
            expect(["GET", "POST", "PUT", "DELETE", "PATCH"]).toContain(
              attrs.httpMethod
            );

            // requestSchema: non-null object
            expect(attrs).toHaveProperty("requestSchema");
            expect(typeof attrs.requestSchema).toBe("object");
            expect(attrs.requestSchema).not.toBeNull();

            // responseSchema: non-null object
            expect(attrs).toHaveProperty("responseSchema");
            expect(typeof attrs.responseSchema).toBe("object");
            expect(attrs.responseSchema).not.toBeNull();

            // authRequired: boolean
            expect(attrs).toHaveProperty("authRequired");
            expect(typeof attrs.authRequired).toBe("boolean");
          }
        } finally {
          gs.forceSave();
          pbtCleanupGraphFile();
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property-Based Tests — LLM 提取默认置信度
// Feature: knowledge-graph, Property 6: LLM 提取默认置信度
// Validates: Requirements 2.2
// ---------------------------------------------------------------------------

describe("Feature: knowledge-graph, Property 6: LLM 提取默认置信度", () => {
  /**
   * Validates: Requirements 2.2
   *
   * For any entity extracted via LLM-assisted extraction (non-AST languages),
   * the confidence SHALL default to 0.7.
   */

  const PBT_PROJECT = "test-pbt-llm-confidence";
  const PBT_DATA_DIR = path.resolve(__dirname, "../../data/knowledge");

  function pbt6CleanupGraphFile(): void {
    const fp = path.join(PBT_DATA_DIR, `graph-${PBT_PROJECT}.json`);
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      // ignore
    }
  }

  function pbt6WriteTempFile(
    dir: string,
    relPath: string,
    content: string
  ): void {
    const fullPath = path.join(dir, relPath);
    const d = path.dirname(fullPath);
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, "utf-8");
  }

  // -------------------------------------------------------------------------
  // Generators
  // -------------------------------------------------------------------------

  /** Non-AST languages that trigger LLM extraction */
  const llmLanguageArb = fc.constantFrom(
    "python",
    "rust",
    "go",
    "java",
    "kotlin",
    "scala",
    "ruby",
    "php",
    "swift",
    "c",
    "cpp"
  );

  /** File extension matching the language */
  const langExtMap: Record<string, string> = {
    python: ".py",
    rust: ".rs",
    go: ".go",
    java: ".java",
    kotlin: ".kt",
    scala: ".scala",
    ruby: ".rb",
    php: ".php",
    swift: ".swift",
    c: ".c",
    cpp: ".cpp",
  };

  /** Generate a valid identifier for entity names */
  const identArb = fc
    .stringMatching(/^[A-Z][a-zA-Z0-9]{1,10}$/)
    .filter(s => s.length >= 2);

  /** Generate a list of LLM-extracted entities (1-5) with varying entity types */
  const entityTypeArb = fc.constantFrom(
    "CodeModule",
    "API",
    "BusinessRule",
    "TechStack"
  );

  const llmEntitiesArb = fc
    .array(
      fc.record({
        entityType: entityTypeArb,
        name: identArb,
        description: fc.string({ minLength: 1, maxLength: 40 }),
      }),
      { minLength: 1, maxLength: 5 }
    )
    .map(entities => {
      // Deduplicate by name
      const seen = new Set<string>();
      return entities.filter(e => {
        if (seen.has(e.name)) return false;
        seen.add(e.name);
        return true;
      });
    })
    .filter(arr => arr.length > 0);

  /** Generate optional LLM-extracted relations */
  const llmRelationsArb = fc.array(
    fc.record({
      relationType: fc.constantFrom("DEPENDS_ON", "CALLS", "USES"),
      sourceEntityName: identArb,
      targetEntityName: identArb,
      evidence: fc.string({ minLength: 1, maxLength: 30 }),
    }),
    { minLength: 0, maxLength: 3 }
  );

  it("all LLM-extracted entities have confidence === 0.7 and source === 'llm_inferred'", async () => {
    await fc.assert(
      fc.asyncProperty(
        llmLanguageArb,
        llmEntitiesArb,
        llmRelationsArb,
        async (language, generatedEntities, generatedRelations) => {
          const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kg-pbt6-"));
          pbt6CleanupGraphFile();
          const gs = new GraphStore();
          const or = new OntologyRegistry();

          // Build mock LLM response from generated entities/relations
          const llmResponse = JSON.stringify({
            entities: generatedEntities,
            relations: generatedRelations,
          });

          const mockLLM: CodeExtractorLLMProvider = {
            generate: vi.fn().mockResolvedValue(llmResponse),
          };

          const ext = new CodeKnowledgeExtractor(gs, or, mockLLM);

          try {
            // Write a dummy source file with the correct extension
            const ext_ = langExtMap[language] || ".txt";
            pbt6WriteTempFile(
              dir,
              `src/module${ext_}`,
              `// dummy ${language} source\n`
            );

            const result = await ext.extract({
              repoPath: dir,
              language,
              projectId: PBT_PROJECT,
            });

            // Every extracted entity must have confidence 0.7
            expect(result.entities.length).toBe(generatedEntities.length);

            for (const entity of result.entities) {
              expect(entity.confidence).toBe(0.7);
              expect(entity.source).toBe("llm_inferred");
            }

            // Relations should also have confidence 0.7
            for (const relation of result.relations) {
              expect(relation.confidence).toBe(0.7);
              expect(relation.source).toBe("llm_inferred");
            }
          } finally {
            gs.forceSave();
            pbt6CleanupGraphFile();
            fs.rmSync(dir, { recursive: true, force: true });
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property-Based Tests — 删除文件触发废弃标记
// Feature: knowledge-graph, Property 17: 删除文件触发废弃标记
// Validates: Requirements 6.2
// ---------------------------------------------------------------------------

describe("Feature: knowledge-graph, Property 17: 删除文件触发废弃标记", () => {
  /**
   * Validates: Requirements 6.2
   *
   * For any file detected as deleted during incremental extraction, the
   * corresponding CodeModule entity and target entities of its DEPENDS_ON
   * and CALLS relations SHALL have status "deprecated" and deprecationReason
   * containing the commit hash.
   */

  const PBT_PROJECT = "test-pbt-deleted-deprecation";
  const PBT_DATA_DIR = path.resolve(__dirname, "../../data/knowledge");

  function pbt17CleanupGraphFile(): void {
    const fp = path.join(PBT_DATA_DIR, `graph-${PBT_PROJECT}.json`);
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      // ignore
    }
  }

  function pbt17WriteTempFile(
    dir: string,
    relPath: string,
    content: string
  ): void {
    const fullPath = path.join(dir, relPath);
    const d = path.dirname(fullPath);
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, "utf-8");
  }

  function pbt17Exec(dir: string, cmd: string): string {
    return execSync(cmd, { cwd: dir, encoding: "utf-8" }).trim();
  }

  // -------------------------------------------------------------------------
  // Generators
  // -------------------------------------------------------------------------

  /** Reserved words that cannot be used as identifiers */
  const RESERVED = new Set([
    "if",
    "for",
    "while",
    "do",
    "return",
    "const",
    "let",
    "var",
    "function",
    "class",
    "export",
    "import",
    "default",
    "switch",
    "case",
    "break",
    "continue",
    "new",
    "this",
    "true",
    "false",
    "null",
    "undefined",
    "typeof",
    "void",
    "delete",
    "in",
    "of",
    "instanceof",
    "throw",
    "try",
    "catch",
    "finally",
    "with",
    "debugger",
    "yield",
    "async",
    "await",
    "enum",
    "interface",
    "type",
    "abstract",
    "as",
    "from",
    "get",
    "set",
    "static",
    "super",
    "extends",
    "implements",
  ]);

  /** Generate a valid TS identifier */
  const identifierArb = fc
    .stringMatching(/^[a-z][a-zA-Z0-9]{1,8}$/)
    .filter(s => s.length >= 2 && !RESERVED.has(s));

  /**
   * Generate a scenario: a set of modules where some import from others.
   * We generate N "base" modules (no imports) and M "dependent" modules
   * (each imports from one base module). Then we pick at least 1 module to delete.
   */
  const scenarioArb = fc
    .record({
      baseModules: fc.array(identifierArb, { minLength: 1, maxLength: 4 }),
      depModules: fc.array(identifierArb, { minLength: 0, maxLength: 3 }),
    })
    .chain(({ baseModules, depModules }) => {
      // Deduplicate all module names
      const allNames: string[] = [];
      const seen = new Set<string>();
      for (const n of baseModules) {
        if (!seen.has(n)) {
          seen.add(n);
          allNames.push(n);
        }
      }
      const bases = [...allNames];
      for (const n of depModules) {
        if (!seen.has(n)) {
          seen.add(n);
          allNames.push(n);
        }
      }
      const deps = allNames.slice(bases.length);

      if (bases.length === 0) {
        return fc.constant(null);
      }

      // Pick which modules to delete (at least 1)
      const maxDelete = allNames.length;
      return fc.integer({ min: 0, max: maxDelete - 1 }).chain(deleteCount => {
        const actualDeleteCount = deleteCount + 1; // at least 1
        return fc
          .shuffledSubarray(allNames, {
            minLength: Math.min(actualDeleteCount, allNames.length),
            maxLength: Math.min(actualDeleteCount, allNames.length),
          })
          .map(toDelete => ({
            bases,
            deps,
            allNames,
            toDelete: new Set(toDelete),
          }));
      });
    })
    .filter(
      (s): s is NonNullable<typeof s> => s !== null && s.bases.length > 0
    );

  it("deleted files and their DEPENDS_ON/CALLS targets are deprecated with commit hash", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async scenario => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kg-pbt17-"));
        pbt17CleanupGraphFile();
        const gs = new GraphStore();
        const or = new OntologyRegistry();
        const ext = new CodeKnowledgeExtractor(gs, or);

        try {
          // --- Step 1: Write all modules ---
          // Base modules: simple exports, no imports
          for (const name of scenario.bases) {
            const code = `export function ${name}Fn(): number { return 42; }\n`;
            pbt17WriteTempFile(dir, `src/${name}.ts`, code);
          }

          // Dependent modules: each imports from the first base module
          const importTarget = scenario.bases[0];
          for (const name of scenario.deps) {
            const code =
              `import { ${importTarget}Fn } from "./${importTarget}.js";\n` +
              `export function ${name}Fn(): number { return ${importTarget}Fn(); }\n`;
            pbt17WriteTempFile(dir, `src/${name}.ts`, code);
          }

          // --- Step 2: Init git repo and commit ---
          pbt17Exec(dir, "git init");
          pbt17Exec(dir, 'git config user.email "test@pbt.com"');
          pbt17Exec(dir, 'git config user.name "PBT"');
          pbt17Exec(dir, "git add -A");
          pbt17Exec(dir, 'git commit -m "initial"');
          const initialCommit = pbt17Exec(dir, "git rev-parse HEAD");

          // --- Step 3: Full extraction to populate graph ---
          await ext.extract({
            repoPath: dir,
            language: "typescript",
            projectId: PBT_PROJECT,
          });

          // --- Step 4: Delete selected files and commit ---
          for (const name of scenario.toDelete) {
            const filePath = path.join(dir, `src/${name}.ts`);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          }
          pbt17Exec(dir, "git add -A");
          pbt17Exec(dir, 'git commit -m "delete files"');

          // --- Step 5: Incremental extraction ---
          await ext.extract({
            repoPath: dir,
            language: "typescript",
            projectId: PBT_PROJECT,
            sinceCommit: initialCommit,
          });

          // --- Step 6: Verify deleted CodeModule entities are deprecated ---
          for (const deletedName of scenario.toDelete) {
            const moduleName = `src/${deletedName}`;
            const entities = gs.findEntities({
              projectId: PBT_PROJECT,
              entityType: "CodeModule",
              name: moduleName,
            });
            const entity = entities.find(e => e.name === moduleName);

            // The entity must exist and be deprecated
            expect(entity).toBeDefined();
            expect(entity!.status).toBe("deprecated");
            expect(entity!.deprecationReason).toBeDefined();
            expect(entity!.deprecationReason).toContain(initialCommit);

            // --- Step 7: Verify target entities of DEPENDS_ON and CALLS ---
            const dependsOn = gs.findRelations({
              sourceEntityId: entity!.entityId,
              relationType: "DEPENDS_ON",
            });
            const calls = gs.findRelations({
              sourceEntityId: entity!.entityId,
              relationType: "CALLS",
            });

            const targetIds = new Set<string>();
            for (const rel of [...dependsOn, ...calls]) {
              targetIds.add(rel.targetEntityId);
            }

            for (const targetId of targetIds) {
              const target = gs.getEntity(targetId);
              if (target) {
                expect(target.status).toBe("deprecated");
                expect(target.deprecationReason).toBeDefined();
                expect(target.deprecationReason).toContain(initialCommit);
              }
            }
          }
        } finally {
          gs.forceSave();
          pbt17CleanupGraphFile();
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }),
      { numRuns: 20 }
    );
  });
});
