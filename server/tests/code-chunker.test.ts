import { describe, expect, it } from "vitest";
import {
  CodeChunker,
  detectLanguage,
  extractImports,
  splitIntoBlocks,
} from "../rag/chunking/code-chunker.js";
import type { ChunkMetadata } from "../../shared/rag/contracts.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetadata(overrides?: Partial<ChunkMetadata>): ChunkMetadata {
  return {
    ingestedAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    contentHash: "test-hash",
    ...overrides,
  };
}

/** Generate a string with exactly `n` whitespace-separated tokens */
function makeTokens(n: number, prefix = "w"): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");
}

// ---------------------------------------------------------------------------
// detectLanguage
// ---------------------------------------------------------------------------

describe("detectLanguage", () => {
  it("detects Python from def + import", () => {
    const code = `import os\n\ndef hello(name: str) -> str:\n    return f"hi {name}"`;
    expect(detectLanguage(code)).toBe("python");
  });

  it("detects Python from shebang", () => {
    expect(detectLanguage('#!/usr/bin/env python3\nprint("hi")')).toBe(
      "python"
    );
  });

  it("detects TypeScript from interface", () => {
    expect(detectLanguage("interface Foo {\n  bar: string;\n}")).toBe(
      "typescript"
    );
  });

  it("detects TypeScript from type alias", () => {
    expect(detectLanguage("type ID = string | number;")).toBe("typescript");
  });

  it("detects JavaScript from import/export", () => {
    expect(
      detectLanguage('import { foo } from "./bar";\nconsole.log(foo);')
    ).toBe("javascript");
  });

  it("detects Java from package declaration", () => {
    expect(detectLanguage("package com.example;\n\npublic class Main {}")).toBe(
      "java"
    );
  });

  it("returns unknown for unrecognizable content", () => {
    expect(detectLanguage("hello world")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// extractImports
// ---------------------------------------------------------------------------

describe("extractImports", () => {
  it("extracts JS/TS imports", () => {
    const code = `import { foo } from './bar';\nimport type { Baz } from './baz';\n\nconst x = 1;`;
    const imports = extractImports(code);
    expect(imports).toContain("import { foo } from './bar';");
    expect(imports).toContain("import type { Baz } from './baz';");
    expect(imports).toHaveLength(2);
  });

  it("extracts Python imports", () => {
    const code = `from os import path\nimport sys\n\ndef main(): pass`;
    const imports = extractImports(code);
    expect(imports).toContain("from os import path");
    expect(imports).toContain("import sys");
  });

  it("extracts Rust use statements", () => {
    const code = `use std::io;\nuse crate::utils;\n\nfn main() {}`;
    const imports = extractImports(code);
    expect(imports).toContain("use std::io;");
    expect(imports).toContain("use crate::utils;");
  });

  it("returns empty array for no imports", () => {
    expect(extractImports("const x = 1;\nconst y = 2;")).toEqual([]);
  });

  it("deduplicates identical imports", () => {
    const code = `import foo\nimport foo`;
    const imports = extractImports(code);
    expect(imports).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// splitIntoBlocks
// ---------------------------------------------------------------------------

describe("splitIntoBlocks", () => {
  it("groups consecutive import lines into one block", () => {
    const code = `import a from 'a';\nimport b from 'b';\n\nconst x = 1;`;
    const blocks = splitIntoBlocks(code);
    const importBlocks = blocks.filter(b => b.type === "import");
    expect(importBlocks).toHaveLength(1);
    expect(importBlocks[0].content).toContain("import a from 'a';");
    expect(importBlocks[0].content).toContain("import b from 'b';");
  });

  it("creates function blocks for declarations", () => {
    const code = `function hello() {\n  return 1;\n}\n\nfunction world() {\n  return 2;\n}`;
    const blocks = splitIntoBlocks(code);
    const funcBlocks = blocks.filter(b => b.type === "function");
    expect(funcBlocks.length).toBeGreaterThanOrEqual(2);
    expect(funcBlocks[0].signature).toContain("function hello()");
  });

  it("handles class declarations", () => {
    const code = `class Foo {\n  bar() {}\n}`;
    const blocks = splitIntoBlocks(code);
    const classBlocks = blocks.filter(b => b.type === "function");
    expect(classBlocks.length).toBeGreaterThanOrEqual(1);
    expect(classBlocks[0].signature).toContain("class Foo");
  });

  it("handles Python def blocks", () => {
    const code = `def greet(name):\n    print(name)\n\ndef farewell():\n    print("bye")`;
    const blocks = splitIntoBlocks(code);
    const funcBlocks = blocks.filter(b => b.type === "function");
    expect(funcBlocks.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// CodeChunker — basic behavior
// ---------------------------------------------------------------------------

describe("CodeChunker", () => {
  const meta = makeMetadata();

  it("returns empty array for empty content", () => {
    const chunker = new CodeChunker();
    expect(chunker.chunk("", meta)).toEqual([]);
    expect(chunker.chunk("   ", meta)).toEqual([]);
  });

  it("produces chunks with codeLanguage metadata", () => {
    const code =
      `import { foo } from './bar';\n\nfunction hello() {\n  return foo();\n}\n\n` +
      makeTokens(100);
    const chunker = new CodeChunker({ minTokens: 1, maxTokens: 1024 });
    const result = chunker.chunk(code, meta);

    expect(result.length).toBeGreaterThanOrEqual(1);
    for (const chunk of result) {
      expect(chunk.metadata.codeLanguage).toBeTruthy();
    }
  });

  it("extracts functionSignature for function chunks", () => {
    // Build a function with enough tokens to stand alone
    const body = makeTokens(80);
    const code = `function processData(input) {\n  ${body}\n}`;
    const chunker = new CodeChunker({ minTokens: 1, maxTokens: 1024 });
    const result = chunker.chunk(code, meta);

    expect(result.length).toBeGreaterThanOrEqual(1);
    // At least one chunk should have a function signature
    const withSig = result.filter(r => r.metadata.functionSignature);
    expect(withSig.length).toBeGreaterThanOrEqual(1);
    expect(withSig[0].metadata.functionSignature).toContain(
      "function processData"
    );
  });

  it("extracts imports metadata", () => {
    const code =
      `import { a } from './a';\nimport { b } from './b';\n\nconst x = 1;\n` +
      makeTokens(80);
    const chunker = new CodeChunker({ minTokens: 1, maxTokens: 1024 });
    const result = chunker.chunk(code, meta);

    expect(result.length).toBeGreaterThanOrEqual(1);
    // At least one chunk should have imports
    const withImports = result.filter(
      r => r.metadata.imports && r.metadata.imports.length > 0
    );
    expect(withImports.length).toBeGreaterThanOrEqual(1);
  });

  it("uses codeLanguage from metadata if provided", () => {
    const code = `function foo() { return 1; }\n` + makeTokens(80);
    const metaWithLang = makeMetadata({ codeLanguage: "ruby" });
    const chunker = new CodeChunker({ minTokens: 1, maxTokens: 1024 });
    const result = chunker.chunk(code, metaWithLang);

    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].metadata.codeLanguage).toBe("ruby");
  });

  // -----------------------------------------------------------------------
  // Token range invariant [minTokens, maxTokens]
  // -----------------------------------------------------------------------

  it("ensures all chunks are within [minTokens, maxTokens] for large input", () => {
    // Build a large code file with multiple functions
    const funcs = Array.from(
      { length: 20 },
      (_, i) => `function func${i}() {\n  ${makeTokens(80)}\n}`
    ).join("\n\n");
    const code = `import { x } from './x';\n\n${funcs}`;

    const chunker = new CodeChunker({ minTokens: 64, maxTokens: 1024 });
    const result = chunker.chunk(code, meta);

    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(1024);
      expect(chunk.tokenCount).toBeGreaterThanOrEqual(64);
    }
  });

  it("handles single small function by merging to meet minTokens", () => {
    // A tiny function that's below minTokens — should still produce output
    const code = `function tiny() { return 1; }`;
    const chunker = new CodeChunker({ minTokens: 64, maxTokens: 1024 });
    const result = chunker.chunk(code, meta);

    // Content is below minTokens but it's all we have, so it should still be returned
    // (can't merge with nothing)
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("splits very large functions that exceed maxTokens", () => {
    const bigBody = makeTokens(2000);
    const code = `function bigFunc() {\n  ${bigBody}\n}`;
    const chunker = new CodeChunker({ minTokens: 64, maxTokens: 512 });
    const result = chunker.chunk(code, meta);

    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(512);
    }
  });

  // -----------------------------------------------------------------------
  // ChunkRecord structure
  // -----------------------------------------------------------------------

  it("produces valid ChunkRecord fields", () => {
    const code = `import os\n\ndef hello():\n    pass\n\n` + makeTokens(100);
    const chunker = new CodeChunker({ minTokens: 1, maxTokens: 1024 });
    const result = chunker.chunk(code, meta);

    for (let i = 0; i < result.length; i++) {
      const chunk = result[i];
      expect(chunk.chunkId).toBe(`chunk:${i}`);
      expect(chunk.chunkIndex).toBe(i);
      expect(chunk.sourceType).toBe("code_snippet");
      expect(chunk.content).toBeTruthy();
      expect(chunk.tokenCount).toBeGreaterThan(0);
      expect(chunk.metadata.codeLanguage).toBeTruthy();
    }
  });

  // -----------------------------------------------------------------------
  // fromConfig factory
  // -----------------------------------------------------------------------

  it("creates instance from ChunkingConfig via fromConfig", () => {
    const chunker = CodeChunker.fromConfig({
      strategy: "syntax_aware",
      maxTokens: 200,
      minTokens: 10,
    });
    const code = Array.from(
      { length: 10 },
      (_, i) => `function f${i}() {\n  ${makeTokens(30)}\n}`
    ).join("\n\n");
    const result = chunker.chunk(code, meta);

    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(200);
    }
  });

  it("fromConfig uses defaults when config is undefined", () => {
    const chunker = CodeChunker.fromConfig(undefined);
    const code = `function test() { ${makeTokens(100)} }`;
    const result = chunker.chunk(code, meta);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Multi-language support
  // -----------------------------------------------------------------------

  it("handles TypeScript code with interfaces and classes", () => {
    const code = [
      `import type { Foo } from './foo';`,
      ``,
      `interface Bar {`,
      `  name: string;`,
      `  value: number;`,
      `}`,
      ``,
      `export class MyClass {`,
      `  constructor(private data: Bar) {}`,
      `  `,
      `  process(): Foo {`,
      `    return { result: this.data.name };`,
      `  }`,
      `}`,
      ``,
      makeTokens(80),
    ].join("\n");

    const chunker = new CodeChunker({ minTokens: 1, maxTokens: 1024 });
    const result = chunker.chunk(code, meta);

    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].metadata.codeLanguage).toBe("typescript");
  });

  it("handles Go code", () => {
    const code = [
      `package main`,
      ``,
      `func main() {`,
      `    fmt.Println("hello")`,
      `}`,
      ``,
      `func helper(x int) int {`,
      `    return x * 2`,
      `}`,
      ``,
      makeTokens(80),
    ].join("\n");

    const chunker = new CodeChunker({ minTokens: 1, maxTokens: 1024 });
    const result = chunker.chunk(code, meta);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
