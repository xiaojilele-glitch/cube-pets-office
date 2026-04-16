/**
 * CodeKnowledgeExtractor — 代码知识提取器
 *
 * 通过 TypeScript Compiler API 进行 AST 静态分析，从代码仓库提取：
 * - CodeModule 实体（filePath、language、linesOfCode、complexity、exports）
 * - API 实体（从路由定义中提取 endpoint、httpMethod）
 * - DEPENDS_ON 关系（从 import 语句）
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import ts from "typescript";

import type {
  Entity,
  Relation,
  ExtractionResult,
  ExtractionStats,
  EntitySource,
} from "../../shared/knowledge/types.js";

import type { GraphStore } from "./graph-store.js";
import type { OntologyRegistry } from "./ontology-registry.js";

// ---------------------------------------------------------------------------
// LLM Provider interface (minimal, compatible with both ILLMProvider and LLMProvider)
// ---------------------------------------------------------------------------

/**
 * Minimal LLM interface for code knowledge extraction.
 * Compatible with both shared/llm/contracts.ts ILLMProvider
 * and shared/workflow-runtime.ts LLMProvider.
 */
export interface CodeExtractorLLMProvider {
  generate(prompt: string): Promise<string>;
}

/** LLM-extracted entity shape from JSON response */
interface LLMExtractedEntity {
  entityType: string;
  name: string;
  description: string;
  extendedAttributes?: Record<string, unknown>;
}

/** LLM-extracted relation shape from JSON response */
interface LLMExtractedRelation {
  relationType: string;
  sourceEntityName: string;
  targetEntityName: string;
  evidence?: string;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractionOptions {
  repoPath: string;
  language: "typescript" | "javascript" | "python" | string;
  projectId: string;
  sinceCommit?: string; // Task 5.2
}

type EntityInput = Omit<
  Entity,
  "entityId" | "createdAt" | "updatedAt" | "status"
>;
type RelationInput = Omit<Relation, "relationId" | "createdAt">;

interface ChangedFilesResult {
  changed: string[]; // Added or modified files (absolute paths)
  deleted: string[]; // Deleted files (relative paths)
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TS_EXTENSIONS = new Set([".ts", ".tsx"]);
const JS_EXTENSIONS = new Set([".js", ".jsx"]);
const ALL_EXTENSIONS = new Set([
  ...Array.from(TS_EXTENSIONS),
  ...Array.from(JS_EXTENSIONS),
]);

const EXCLUDED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  "coverage",
  "__pycache__",
]);

/** Express-style HTTP method names used in route definitions */
const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "options",
  "head",
  "all",
]);

/** Source file extensions for language-agnostic scanning (LLM extraction) */
const SOURCE_EXTENSIONS = new Set([
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".scala",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".swift",
  ".m",
  ".php",
  ".lua",
  ".r",
  ".jl",
  ".ex",
  ".exs",
  ".clj",
  ".hs",
  ".erl",
  // Also include TS/JS for completeness in scanAllFiles
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
]);

// ---------------------------------------------------------------------------
// CodeKnowledgeExtractor
// ---------------------------------------------------------------------------

export class CodeKnowledgeExtractor {
  private graphStore: GraphStore;
  private ontologyRegistry: OntologyRegistry;
  private llmProvider: CodeExtractorLLMProvider | null;

  constructor(
    graphStore: GraphStore,
    ontologyRegistry: OntologyRegistry,
    llmProvider?: CodeExtractorLLMProvider | null
  ) {
    this.graphStore = graphStore;
    this.ontologyRegistry = ontologyRegistry;
    this.llmProvider = llmProvider ?? null;
  }

  /**
   * extract — Main entry point for code knowledge extraction.
   *
   * Scans the repo, parses files, extracts entities and relations,
   * then writes them to the graph store.
   *
   * When sinceCommit is provided, only changed/added files are analyzed
   * and deleted files are marked as deprecated (Requirements 2.5, 6.2).
   */
  async extract(options: ExtractionOptions): Promise<ExtractionResult> {
    const startTime = Date.now();
    const { repoPath, language, projectId, sinceCommit } = options;

    // Only TypeScript/JavaScript AST extraction in this task
    if (language === "typescript" || language === "javascript") {
      let files: string[];

      if (sinceCommit) {
        // Incremental extraction: only changed/added files
        const changedResult = this.getChangedFiles(repoPath, sinceCommit);
        files = changedResult.changed;

        // Mark deleted files as deprecated (Requirement 6.2)
        if (changedResult.deleted.length > 0) {
          this.markDeletedAsDeprecated(
            changedResult.deleted,
            sinceCommit,
            projectId
          );
        }
      } else {
        files = this.scanFiles(repoPath);
      }

      const result = this.extractTypeScript(files, repoPath, projectId);

      // Write entities to graph store
      for (const entityInput of result.entities) {
        this.graphStore.mergeEntity({
          entityType: entityInput.entityType,
          name: entityInput.name,
          description: entityInput.description,
          source: entityInput.source,
          confidence: entityInput.confidence,
          projectId: entityInput.projectId,
          needsReview: entityInput.needsReview,
          linkedMemoryIds: entityInput.linkedMemoryIds,
          extendedAttributes: entityInput.extendedAttributes,
        });
      }

      // Write relations to graph store
      for (const relationInput of result.relations) {
        this.graphStore.createRelation(relationInput);
      }

      result.stats.extractionDurationMs = Date.now() - startTime;

      // Log ExtractionStats (Requirement 2.7)
      this.logExtractionStats(result.stats);

      return result;
    }

    // Unsupported language — use LLM-assisted extraction (Requirement 2.2)
    if (this.llmProvider) {
      let files: string[];

      if (sinceCommit) {
        const changedResult = this.getChangedFiles(repoPath, sinceCommit);
        files = changedResult.changed;
        if (changedResult.deleted.length > 0) {
          this.markDeletedAsDeprecated(
            changedResult.deleted,
            sinceCommit,
            projectId
          );
        }
      } else {
        files = this.scanAllFiles(repoPath);
      }

      const result = await this.extractWithLLM(
        files,
        language,
        repoPath,
        projectId
      );

      // Write entities to graph store
      for (const entityInput of result.entities) {
        this.graphStore.mergeEntity({
          entityType: entityInput.entityType,
          name: entityInput.name,
          description: entityInput.description,
          source: entityInput.source,
          confidence: entityInput.confidence,
          projectId: entityInput.projectId,
          needsReview: entityInput.needsReview,
          linkedMemoryIds: entityInput.linkedMemoryIds,
          extendedAttributes: entityInput.extendedAttributes,
        });
      }

      for (const relationInput of result.relations) {
        this.graphStore.createRelation(relationInput);
      }

      result.stats.extractionDurationMs = Date.now() - startTime;
      this.logExtractionStats(result.stats);
      return result;
    }

    // No LLM provider configured — return empty result with warning
    console.warn(
      `[CodeKnowledgeExtractor] Language "${language}" is not directly supported and no LLM provider is configured. Returning empty result.`
    );
    const emptyStats: ExtractionStats = {
      filesAnalyzed: 0,
      entitiesExtracted: 0,
      relationsExtracted: 0,
      extractionDurationMs: Date.now() - startTime,
      errors: [],
    };
    this.logExtractionStats(emptyStats);
    return {
      entities: [],
      relations: [],
      stats: emptyStats,
    };
  }

  // -------------------------------------------------------------------------
  // File scanning
  // -------------------------------------------------------------------------

  /**
   * Recursively scan for .ts/.tsx/.js/.jsx files, excluding common non-source dirs.
   */
  private scanFiles(repoPath: string): string[] {
    const results: string[] = [];
    this.walkDir(repoPath, repoPath, results);
    return results;
  }

  private walkDir(dir: string, rootPath: string, results: string[]): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          this.walkDir(path.join(dir, entry.name), rootPath, results);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ALL_EXTENSIONS.has(ext)) {
          results.push(path.join(dir, entry.name));
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // TypeScript / JavaScript AST extraction
  // -------------------------------------------------------------------------

  private extractTypeScript(
    files: string[],
    repoPath: string,
    projectId: string
  ): ExtractionResult {
    const entities: EntityInput[] = [];
    const relations: RelationInput[] = [];
    const errors: ExtractionStats["errors"] = [];

    // First pass: build a map of filePath → module name for resolving imports
    const fileToModuleName = new Map<string, string>();
    for (const filePath of files) {
      const relPath = path.relative(repoPath, filePath).replace(/\\/g, "/");
      const moduleName = this.filePathToModuleName(relPath);
      fileToModuleName.set(relPath, moduleName);
    }

    // Second pass: extract entities and relations from each file
    for (const filePath of files) {
      try {
        const relPath = path.relative(repoPath, filePath).replace(/\\/g, "/");
        const content = fs.readFileSync(filePath, "utf-8");
        const ext = path.extname(filePath).toLowerCase();
        const isTS = TS_EXTENSIONS.has(ext);
        const lang = isTS ? "typescript" : "javascript";

        const sourceFile = ts.createSourceFile(
          filePath,
          content,
          ts.ScriptTarget.Latest,
          true,
          ext === ".tsx"
            ? ts.ScriptKind.TSX
            : ext === ".jsx"
              ? ts.ScriptKind.JSX
              : undefined
        );

        // Extract CodeModule entity
        const linesOfCode = content.split("\n").length;
        const complexity = this.computeCyclomaticComplexity(sourceFile);
        const exports = this.extractExports(sourceFile);

        const moduleEntity: EntityInput = {
          entityType: "CodeModule",
          name: this.filePathToModuleName(relPath),
          description: `Code module: ${relPath}`,
          source: "code_analysis" as EntitySource,
          confidence: 0.9,
          projectId,
          needsReview: false,
          linkedMemoryIds: [],
          extendedAttributes: {
            filePath: relPath,
            language: lang,
            linesOfCode,
            complexity,
            exports,
          },
        };
        entities.push(moduleEntity);

        // Extract API entities from route definitions
        const apiEntities = this.extractAPIs(sourceFile, relPath, projectId);
        entities.push(...apiEntities);

        // Extract DEPENDS_ON relations from imports
        const importRelations = this.extractImportRelations(
          sourceFile,
          relPath,
          repoPath,
          projectId,
          fileToModuleName
        );
        relations.push(...importRelations);
      } catch (e) {
        const relPath = path.relative(repoPath, filePath).replace(/\\/g, "/");
        errors.push({
          filePath: relPath,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      entities,
      relations,
      stats: {
        filesAnalyzed: files.length,
        entitiesExtracted: entities.length,
        relationsExtracted: relations.length,
        extractionDurationMs: 0, // filled by caller
        errors,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Cyclomatic complexity
  // -------------------------------------------------------------------------

  /**
   * Compute cyclomatic complexity by counting decision points:
   * if, for, while, do-while, switch case, catch, &&, ||, ternary (?:)
   *
   * Base complexity = 1, each decision point adds 1.
   */
  private computeCyclomaticComplexity(sourceFile: ts.SourceFile): number {
    let complexity = 1;

    const visit = (node: ts.Node): void => {
      switch (node.kind) {
        case ts.SyntaxKind.IfStatement:
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.WhileStatement:
        case ts.SyntaxKind.DoStatement:
        case ts.SyntaxKind.CatchClause:
        case ts.SyntaxKind.ConditionalExpression: // ternary ?:
          complexity++;
          break;
        case ts.SyntaxKind.CaseClause:
          complexity++;
          break;
        case ts.SyntaxKind.BinaryExpression: {
          const binExpr = node as ts.BinaryExpression;
          if (
            binExpr.operatorToken.kind ===
              ts.SyntaxKind.AmpersandAmpersandToken ||
            binExpr.operatorToken.kind === ts.SyntaxKind.BarBarToken
          ) {
            complexity++;
          }
          break;
        }
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
    return complexity;
  }

  // -------------------------------------------------------------------------
  // Export extraction
  // -------------------------------------------------------------------------

  /**
   * Extract exported declarations from a source file.
   * Handles: export function, export class, export const/let/var,
   *          export default, export { ... }
   */
  private extractExports(sourceFile: ts.SourceFile): string[] {
    const exports: string[] = [];

    const visit = (node: ts.Node): void => {
      // Check for export modifier on declarations
      if (ts.canHaveModifiers(node)) {
        const modifiers = ts.getModifiers(node);
        const hasExport = modifiers?.some(
          m => m.kind === ts.SyntaxKind.ExportKeyword
        );
        const hasDefault = modifiers?.some(
          m => m.kind === ts.SyntaxKind.DefaultKeyword
        );

        if (hasExport) {
          if (ts.isFunctionDeclaration(node) && node.name) {
            exports.push(
              hasDefault ? `default(${node.name.text})` : node.name.text
            );
          } else if (ts.isClassDeclaration(node) && node.name) {
            exports.push(
              hasDefault ? `default(${node.name.text})` : node.name.text
            );
          } else if (ts.isVariableStatement(node)) {
            for (const decl of node.declarationList.declarations) {
              if (ts.isIdentifier(decl.name)) {
                exports.push(decl.name.text);
              }
            }
          } else if (ts.isInterfaceDeclaration(node)) {
            exports.push(node.name.text);
          } else if (ts.isTypeAliasDeclaration(node)) {
            exports.push(node.name.text);
          } else if (ts.isEnumDeclaration(node)) {
            exports.push(node.name.text);
          } else if (
            hasDefault &&
            (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
            !node.name
          ) {
            exports.push("default");
          }
        }
      }

      // export { A, B, C }
      if (ts.isExportDeclaration(node) && node.exportClause) {
        if (ts.isNamedExports(node.exportClause)) {
          for (const spec of node.exportClause.elements) {
            exports.push(spec.name.text);
          }
        }
      }

      // export default expression (not covered by modifiers check)
      if (ts.isExportAssignment(node) && !node.isExportEquals) {
        if (!exports.includes("default")) {
          exports.push("default");
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
    return Array.from(new Set(exports)); // deduplicate
  }

  // -------------------------------------------------------------------------
  // API extraction from route definitions
  // -------------------------------------------------------------------------

  /**
   * Extract API entities from Express-style route definitions.
   * Detects patterns like:
   *   router.get("/path", ...)
   *   app.post("/path", ...)
   *   router.get('/path', ...)
   *
   * Best-effort — not all routes will be detected.
   */
  private extractAPIs(
    sourceFile: ts.SourceFile,
    relPath: string,
    projectId: string
  ): EntityInput[] {
    const apis: EntityInput[] = [];

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const methodName = node.expression.name.text.toLowerCase();

        if (HTTP_METHODS.has(methodName) && node.arguments.length >= 1) {
          const firstArg = node.arguments[0];
          const endpoint = this.extractStringLiteral(firstArg);

          if (endpoint) {
            apis.push({
              entityType: "API",
              name: `${methodName.toUpperCase()} ${endpoint}`,
              description: `API endpoint: ${methodName.toUpperCase()} ${endpoint} (from ${relPath})`,
              source: "code_analysis" as EntitySource,
              confidence: 0.85,
              projectId,
              needsReview: false,
              linkedMemoryIds: [],
              extendedAttributes: {
                endpoint,
                httpMethod: methodName.toUpperCase(),
                requestSchema: {},
                responseSchema: {},
                authRequired: false,
              },
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
    return apis;
  }

  /**
   * Extract a string literal value from a node (handles both single and double quotes).
   */
  private extractStringLiteral(node: ts.Node): string | null {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Import relation extraction
  // -------------------------------------------------------------------------

  /**
   * Extract DEPENDS_ON relations from import statements.
   * Only resolves relative imports (skips external packages).
   */
  private extractImportRelations(
    sourceFile: ts.SourceFile,
    relPath: string,
    repoPath: string,
    projectId: string,
    fileToModuleName: Map<string, string>
  ): RelationInput[] {
    const relations: RelationInput[] = [];
    const currentModuleName = this.filePathToModuleName(relPath);

    const visit = (node: ts.Node): void => {
      // import ... from "..."
      if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
        const specifier = this.extractStringLiteral(node.moduleSpecifier);
        if (specifier) {
          this.processImportSpecifier(
            specifier,
            relPath,
            repoPath,
            projectId,
            currentModuleName,
            fileToModuleName,
            relations
          );
        }
      }

      // Dynamic import: import("...")
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length >= 1
      ) {
        const specifier = this.extractStringLiteral(node.arguments[0]);
        if (specifier) {
          this.processImportSpecifier(
            specifier,
            relPath,
            repoPath,
            projectId,
            currentModuleName,
            fileToModuleName,
            relations
          );
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
    return relations;
  }

  /**
   * Process a single import specifier and create a DEPENDS_ON relation
   * if it resolves to a local file.
   */
  private processImportSpecifier(
    specifier: string,
    currentRelPath: string,
    repoPath: string,
    projectId: string,
    currentModuleName: string,
    fileToModuleName: Map<string, string>,
    relations: RelationInput[]
  ): void {
    // Skip external packages (non-relative imports)
    if (!specifier.startsWith(".")) {
      return;
    }

    const currentDir = path.dirname(currentRelPath);
    // Strip .js/.ts extensions from specifier for resolution
    let cleanSpecifier = specifier.replace(/\.(js|ts|jsx|tsx)$/, "");
    const resolvedRel = path.posix.normalize(
      path.posix.join(currentDir, cleanSpecifier)
    );

    // Try to find the target module in our file map
    const targetModuleName = this.resolveImportTarget(
      resolvedRel,
      fileToModuleName
    );

    if (targetModuleName && targetModuleName !== currentModuleName) {
      // Avoid duplicate relations for the same source→target pair
      const alreadyExists = relations.some(
        r =>
          r.sourceEntityId === `${projectId}::${currentModuleName}` &&
          r.targetEntityId === `${projectId}::${targetModuleName}`
      );

      if (!alreadyExists) {
        relations.push({
          relationType: "DEPENDS_ON",
          sourceEntityId: `${projectId}::${currentModuleName}`,
          targetEntityId: `${projectId}::${targetModuleName}`,
          weight: 0.8,
          evidence: `import from "${specifier}"`,
          source: "code_analysis" as EntitySource,
          confidence: 0.9,
          needsReview: false,
        });
      }
    }
  }

  /**
   * Try to resolve a relative import path to a module name in our file map.
   * Tries multiple extensions and index files.
   */
  private resolveImportTarget(
    resolvedRel: string,
    fileToModuleName: Map<string, string>
  ): string | null {
    const entries = Array.from(fileToModuleName.entries());

    // Direct match
    for (const [filePath, moduleName] of entries) {
      const fileWithoutExt = filePath.replace(/\.(ts|tsx|js|jsx)$/, "");
      if (fileWithoutExt === resolvedRel) {
        return moduleName;
      }
    }

    // Try as directory with index file
    const indexPath = resolvedRel + "/index";
    for (const [filePath, moduleName] of entries) {
      const fileWithoutExt = filePath.replace(/\.(ts|tsx|js|jsx)$/, "");
      if (fileWithoutExt === indexPath) {
        return moduleName;
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Convert a file path to a module name.
   * e.g. "src/utils/helpers.ts" → "src/utils/helpers"
   */
  private filePathToModuleName(relPath: string): string {
    return relPath.replace(/\.(ts|tsx|js|jsx)$/, "");
  }

  // -------------------------------------------------------------------------
  // Incremental extraction (Requirements 2.5, 6.2)
  // -------------------------------------------------------------------------

  /**
   * getChangedFiles — Get list of changed files since a commit via git diff.
   *
   * Parses `git diff --name-status <sinceCommit> HEAD` output.
   * Status codes: A=added, M=modified, D=deleted, R=renamed.
   * Only includes TS/JS files.
   *
   * Returns absolute paths for changed files, relative paths for deleted files.
   */
  private getChangedFiles(
    repoPath: string,
    sinceCommit: string
  ): ChangedFilesResult {
    const result: ChangedFilesResult = { changed: [], deleted: [] };

    let output: string;
    try {
      output = execSync(`git diff --name-status ${sinceCommit} HEAD`, {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 30_000,
      }).trim();
    } catch (e) {
      console.error(
        `[CodeKnowledgeExtractor] git diff failed (repo may not be a git repo):`,
        e instanceof Error ? e.message : String(e)
      );
      return result;
    }

    if (!output) return result;

    for (const line of output.split("\n")) {
      if (!line.trim()) continue;

      // Format: "M\tpath/to/file" or "R100\told\tnew"
      const parts = line.split("\t");
      if (parts.length < 2) continue;

      const status = parts[0].charAt(0); // First char: A, M, D, R
      const filePath = status === "R" ? parts[2] : parts[1]; // Renamed: use new path
      const deletedPath = status === "D" ? parts[1] : undefined;

      if (status === "D" && deletedPath) {
        const ext = path.extname(deletedPath).toLowerCase();
        if (ALL_EXTENSIONS.has(ext)) {
          result.deleted.push(deletedPath);
        }
      } else if (filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (ALL_EXTENSIONS.has(ext)) {
          const absPath = path.resolve(repoPath, filePath);
          // Only include files that actually exist (they might have been deleted after the diff)
          if (fs.existsSync(absPath)) {
            result.changed.push(absPath);
          }
        }
      }
    }

    return result;
  }

  /**
   * markDeletedAsDeprecated — Mark entities for deleted files as deprecated.
   *
   * For each deleted file:
   * 1. Find the corresponding CodeModule entity in the graph store
   * 2. Mark it as deprecated with deprecationReason containing the commit hash
   * 3. Find DEPENDS_ON and CALLS relations where this entity is the source,
   *    and mark target entities as deprecated too
   *
   * Requirements 6.2: deprecationReason contains the triggering commit hash.
   */
  private markDeletedAsDeprecated(
    deletedFiles: string[],
    sinceCommit: string,
    projectId: string
  ): void {
    for (const relPath of deletedFiles) {
      const moduleName = this.filePathToModuleName(relPath);

      // Find the CodeModule entity by name and projectId
      const entities = this.graphStore.findEntities({
        projectId,
        entityType: "CodeModule",
        name: moduleName,
      });

      // findEntities does fuzzy match on name, so filter for exact match
      const moduleEntity = entities.find(e => e.name === moduleName);
      if (!moduleEntity) continue;

      // Mark the module entity as deprecated
      if (moduleEntity.status === "active") {
        try {
          this.graphStore.enforceStatusTransition(
            moduleEntity.entityId,
            "deprecated",
            `File deleted since commit ${sinceCommit}`,
            "code_change"
          );
          // Also set deprecationReason on the entity
          this.graphStore.updateEntity(moduleEntity.entityId, {
            deprecationReason: `File deleted since commit ${sinceCommit}`,
          });
        } catch (e) {
          console.error(
            `[CodeKnowledgeExtractor] Failed to deprecate entity ${moduleEntity.entityId}:`,
            e instanceof Error ? e.message : String(e)
          );
        }
      }

      // Find DEPENDS_ON and CALLS relations where this entity is the source
      const dependsOnRelations = this.graphStore.findRelations({
        sourceEntityId: moduleEntity.entityId,
        relationType: "DEPENDS_ON",
      });
      const callsRelations = this.graphStore.findRelations({
        sourceEntityId: moduleEntity.entityId,
        relationType: "CALLS",
      });

      // Mark target entities of those relations as deprecated
      const targetEntityIds = new Set<string>();
      for (const rel of [...dependsOnRelations, ...callsRelations]) {
        targetEntityIds.add(rel.targetEntityId);
      }

      for (const targetId of targetEntityIds) {
        const targetEntity = this.graphStore.getEntity(targetId);
        if (targetEntity && targetEntity.status === "active") {
          try {
            this.graphStore.enforceStatusTransition(
              targetId,
              "deprecated",
              `Dependent file deleted since commit ${sinceCommit}`,
              "code_change"
            );
            this.graphStore.updateEntity(targetId, {
              deprecationReason: `Dependent file deleted since commit ${sinceCommit}`,
            });
          } catch (e) {
            console.error(
              `[CodeKnowledgeExtractor] Failed to deprecate target entity ${targetId}:`,
              e instanceof Error ? e.message : String(e)
            );
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Extraction stats logging (Requirement 2.7)
  // -------------------------------------------------------------------------

  /**
   * logExtractionStats — Log extraction statistics for debugging.
   */
  private logExtractionStats(stats: ExtractionStats): void {
    console.log("[CodeKnowledgeExtractor] Extraction complete:", {
      filesAnalyzed: stats.filesAnalyzed,
      entitiesExtracted: stats.entitiesExtracted,
      relationsExtracted: stats.relationsExtracted,
      extractionDurationMs: stats.extractionDurationMs,
      errors:
        stats.errors.length > 0
          ? stats.errors.map(e => `${e.filePath}: ${e.reason}`)
          : "none",
    });
  }

  // -------------------------------------------------------------------------
  // Language-agnostic file scanner (for LLM extraction)
  // -------------------------------------------------------------------------

  /**
   * scanAllFiles — Recursively scan repo for all source files (any language).
   * Excludes common non-source directories.
   */
  private scanAllFiles(repoPath: string): string[] {
    const results: string[] = [];
    this.walkDirAll(repoPath, repoPath, results);
    return results;
  }

  private walkDirAll(dir: string, rootPath: string, results: string[]): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          this.walkDirAll(path.join(dir, entry.name), rootPath, results);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        // Include common source file extensions (skip binary/config)
        if (SOURCE_EXTENSIONS.has(ext)) {
          results.push(path.join(dir, entry.name));
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // LLM-assisted extraction (Requirement 2.2 — non-AST languages)
  // -------------------------------------------------------------------------

  /**
   * extractWithLLM — Use LLM to extract entities and relations from code
   * files in languages not directly supported by AST parsing.
   *
   * All extracted entities get confidence = 0.7 and source = "llm_inferred".
   */
  private async extractWithLLM(
    files: string[],
    language: string,
    repoPath: string,
    projectId: string
  ): Promise<ExtractionResult> {
    const entities: EntityInput[] = [];
    const relations: RelationInput[] = [];
    const errors: ExtractionStats["errors"] = [];

    if (!this.llmProvider) {
      return {
        entities,
        relations,
        stats: {
          filesAnalyzed: 0,
          entitiesExtracted: 0,
          relationsExtracted: 0,
          extractionDurationMs: 0,
          errors: [],
        },
      };
    }

    // Build ontology context for the prompt
    const entityTypes = this.ontologyRegistry.getEntityTypes();
    const relationTypes = this.ontologyRegistry.getRelationTypes();
    const ontologyContext = this.buildOntologyPromptContext(
      entityTypes,
      relationTypes
    );

    for (const filePath of files) {
      const relPath = path.relative(repoPath, filePath).replace(/\\/g, "/");
      try {
        const content = fs.readFileSync(filePath, "utf-8");

        // Skip very large files to avoid token limits
        if (content.length > 50_000) {
          errors.push({
            filePath: relPath,
            reason: "File too large for LLM extraction (>50KB)",
          });
          continue;
        }

        const prompt = this.buildExtractionPrompt(
          content,
          relPath,
          language,
          ontologyContext
        );
        const llmResponse = await this.llmProvider.generate(prompt);
        const parsed = this.parseLLMExtractionResponse(llmResponse);

        if (!parsed) {
          errors.push({
            filePath: relPath,
            reason: "Failed to parse LLM response as JSON",
          });
          continue;
        }

        // Build a name→entityName map for relation resolution
        const entityNameSet = new Set<string>();

        // Process extracted entities — all get confidence 0.7, source "llm_inferred"
        for (const rawEntity of parsed.entities) {
          if (!rawEntity.entityType || !rawEntity.name) continue;

          const entity: EntityInput = {
            entityType: rawEntity.entityType,
            name: rawEntity.name,
            description:
              rawEntity.description ||
              `${rawEntity.entityType}: ${rawEntity.name}`,
            source: "llm_inferred" as EntitySource,
            confidence: 0.7,
            projectId,
            needsReview: false,
            linkedMemoryIds: [],
            extendedAttributes: {
              filePath: relPath,
              language,
              ...(rawEntity.extendedAttributes || {}),
            },
          };
          entities.push(entity);
          entityNameSet.add(rawEntity.name);
        }

        // Process extracted relations
        for (const rawRelation of parsed.relations) {
          if (
            !rawRelation.relationType ||
            !rawRelation.sourceEntityName ||
            !rawRelation.targetEntityName
          )
            continue;

          const relation: RelationInput = {
            relationType: rawRelation.relationType,
            sourceEntityId: `${projectId}:${rawRelation.sourceEntityName}`,
            targetEntityId: `${projectId}:${rawRelation.targetEntityName}`,
            weight: 0.7,
            evidence: rawRelation.evidence || `LLM-inferred from ${relPath}`,
            source: "llm_inferred" as EntitySource,
            confidence: 0.7,
            needsReview: false,
          };
          relations.push(relation);
        }
      } catch (e) {
        errors.push({
          filePath: relPath,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      entities,
      relations,
      stats: {
        filesAnalyzed: files.length,
        entitiesExtracted: entities.length,
        relationsExtracted: relations.length,
        extractionDurationMs: 0, // filled by caller
        errors,
      },
    };
  }

  /**
   * buildOntologyPromptContext — Format ontology model for inclusion in LLM prompt.
   */
  private buildOntologyPromptContext(
    entityTypes: Array<{
      name: string;
      description: string;
      extendedAttributes: string[];
    }>,
    relationTypes: Array<{ name: string; description: string }>
  ): string {
    const entitySection = entityTypes
      .map(
        et =>
          `  - ${et.name}: ${et.description} (attributes: ${et.extendedAttributes.join(", ") || "none"})`
      )
      .join("\n");
    const relationSection = relationTypes
      .map(rt => `  - ${rt.name}: ${rt.description}`)
      .join("\n");

    return `Entity Types:\n${entitySection}\n\nRelation Types:\n${relationSection}`;
  }

  /**
   * buildExtractionPrompt — Build the LLM prompt for code knowledge extraction.
   */
  private buildExtractionPrompt(
    code: string,
    filePath: string,
    language: string,
    ontologyContext: string
  ): string {
    return `You are a code analysis assistant. Analyze the following ${language} code and extract structured knowledge entities and relations.

## Ontology Model

${ontologyContext}

## Code File: ${filePath}

\`\`\`${language}
${code}
\`\`\`

## Instructions

Extract entities (modules, classes, functions, APIs, etc.) and relations (dependencies, calls, etc.) from the code above.

Respond with ONLY a JSON object in this exact format:
{
  "entities": [
    {
      "entityType": "<one of the entity types above>",
      "name": "<entity name>",
      "description": "<brief description>",
      "extendedAttributes": { <optional key-value pairs> }
    }
  ],
  "relations": [
    {
      "relationType": "<one of the relation types above>",
      "sourceEntityName": "<source entity name>",
      "targetEntityName": "<target entity name>",
      "evidence": "<code reference or explanation>"
    }
  ]
}

Focus on the most important entities: modules, classes, functions, and their dependencies. Do not include trivial local variables.`;
  }

  /**
   * parseLLMExtractionResponse — Parse LLM JSON response, handling common issues.
   */
  parseLLMExtractionResponse(
    response: string
  ): {
    entities: LLMExtractedEntity[];
    relations: LLMExtractedRelation[];
  } | null {
    try {
      // Try to extract JSON from the response (LLM may wrap in markdown code blocks)
      let jsonStr = response.trim();

      // Strip markdown code fences if present
      const jsonBlockMatch = jsonStr.match(
        /```(?:json)?\s*\n?([\s\S]*?)\n?```/
      );
      if (jsonBlockMatch) {
        jsonStr = jsonBlockMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);

      // Validate structure
      const entities: LLMExtractedEntity[] = Array.isArray(parsed.entities)
        ? parsed.entities
        : [];
      const relations: LLMExtractedRelation[] = Array.isArray(parsed.relations)
        ? parsed.relations
        : [];

      return { entities, relations };
    } catch {
      console.warn(
        "[CodeKnowledgeExtractor] Failed to parse LLM extraction response"
      );
      return null;
    }
  }
}
