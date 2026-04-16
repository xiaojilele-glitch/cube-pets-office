import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("phase1 workspace hardening", () => {
  const originalCwd = process.cwd();
  let tempDir = "";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cube-pets-workspace-"));
    process.chdir(tempDir);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("materializes every requested agent workspace with the expected subdirectories", async () => {
    const { ensureAgentWorkspaces, getAgentWorkspacePaths, getAgentsRootDir } =
      await import("../memory/workspace.js");

    const agentIds = ["ceo", "pixel", "scout"];
    const workspaces = ensureAgentWorkspaces(agentIds);

    expect(workspaces).toHaveLength(agentIds.length);
    expect(getAgentsRootDir()).toBe(path.join(tempDir, "data", "agents"));

    for (const agentId of agentIds) {
      const workspace = getAgentWorkspacePaths(agentId);
      expect(fs.existsSync(workspace.rootDir)).toBe(true);
      expect(fs.existsSync(workspace.sessionsDir)).toBe(true);
      expect(fs.existsSync(workspace.memoryDir)).toBe(true);
      expect(fs.existsSync(workspace.reportsDir)).toBe(true);
    }
  });

  it("rejects invalid agent identifiers before creating directories", async () => {
    const { ensureAgentWorkspace } = await import("../memory/workspace.js");

    expect(() => ensureAgentWorkspace("../scout")).toThrow(/Invalid agent ID/);
  });
});
