import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('phase1 workspace access guard', () => {
  const originalCwd = process.cwd();
  let tempDir = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cube-pets-access-guard-'));
    process.chdir(tempDir);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes and reads files only inside the requested workspace scope', async () => {
    const { readAgentWorkspaceFile, writeAgentWorkspaceFile, resolveAgentWorkspacePath } =
      await import('../core/access-guard.js');

    const resolvedPath = writeAgentWorkspaceFile(
      'scout',
      '2026-03/report.md',
      '# report',
      'reports'
    );

    expect(resolvedPath).toBe(
      path.join(tempDir, 'data', 'agents', 'scout', 'reports', '2026-03', 'report.md')
    );
    expect(readAgentWorkspaceFile('scout', '2026-03/report.md', 'reports')).toBe('# report');
    expect(resolveAgentWorkspacePath('scout', '2026-03/report.md', 'reports')).toBe(resolvedPath);
  });

  it('blocks absolute and traversal paths', async () => {
    const { resolveAgentWorkspacePath } = await import('../core/access-guard.js');

    expect(() => resolveAgentWorkspacePath('scout', '../outside.txt')).toThrow(/escapes/);
    expect(() => resolveAgentWorkspacePath('scout', '/temp/outside.txt')).toThrow(/Absolute/);
  });
});
