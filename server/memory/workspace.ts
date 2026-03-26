import fs from 'fs';
import path from 'path';

const AGENTS_ROOT = path.resolve(process.cwd(), 'data/agents');
const SAFE_SEGMENT_PATTERN = /^[a-zA-Z0-9._-]+$/;

export interface AgentWorkspacePaths {
  rootDir: string;
  sessionsDir: string;
  memoryDir: string;
  reportsDir: string;
}

export type AgentWorkspaceSection = 'root' | 'sessions' | 'memory' | 'reports';

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function assertSafeSegment(value: string, label: string): void {
  if (!value || !SAFE_SEGMENT_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function assertSafeRelativePath(relativePath: string): void {
  if (!relativePath) return;

  const normalized = relativePath.replace(/\\/g, '/');
  if (path.posix.isAbsolute(normalized)) {
    throw new Error(`Absolute paths are not allowed in agent workspace: ${relativePath}`);
  }

  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      throw new Error(`Path traversal is not allowed in agent workspace: ${relativePath}`);
    }
    assertSafeSegment(segment, 'workspace path segment');
  }
}

export function getAgentWorkspacePaths(agentId: string): AgentWorkspacePaths {
  assertSafeSegment(agentId, 'agent id');
  const rootDir = path.join(AGENTS_ROOT, agentId);
  return {
    rootDir,
    sessionsDir: path.join(rootDir, 'sessions'),
    memoryDir: path.join(rootDir, 'memory'),
    reportsDir: path.join(rootDir, 'reports'),
  };
}

export function ensureAgentWorkspace(agentId: string): AgentWorkspacePaths {
  const paths = getAgentWorkspacePaths(agentId);
  ensureDir(AGENTS_ROOT);
  ensureDir(paths.rootDir);
  ensureDir(paths.sessionsDir);
  ensureDir(paths.memoryDir);
  ensureDir(paths.reportsDir);
  return paths;
}

function getSectionDir(paths: AgentWorkspacePaths, section: AgentWorkspaceSection): string {
  switch (section) {
    case 'sessions':
      return paths.sessionsDir;
    case 'memory':
      return paths.memoryDir;
    case 'reports':
      return paths.reportsDir;
    case 'root':
    default:
      return paths.rootDir;
  }
}

export function resolveAgentWorkspacePath(
  agentId: string,
  section: AgentWorkspaceSection,
  relativePath: string = ''
): string {
  const paths = ensureAgentWorkspace(agentId);
  assertSafeRelativePath(relativePath);

  const baseDir = getSectionDir(paths, section);
  const resolved = path.resolve(baseDir, relativePath || '.');
  const normalizedBase = `${path.resolve(baseDir)}${path.sep}`;
  const normalizedResolved = path.resolve(resolved);

  if (normalizedResolved !== path.resolve(baseDir) && !normalizedResolved.startsWith(normalizedBase)) {
    throw new Error(`Resolved path escapes agent workspace: ${relativePath}`);
  }

  return normalizedResolved;
}

export function writeAgentWorkspaceFile(
  agentId: string,
  section: AgentWorkspaceSection,
  relativePath: string,
  content: string
): string {
  const filePath = resolveAgentWorkspacePath(agentId, section, relativePath);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

export function appendAgentWorkspaceFile(
  agentId: string,
  section: AgentWorkspaceSection,
  relativePath: string,
  content: string
): string {
  const filePath = resolveAgentWorkspacePath(agentId, section, relativePath);
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, content, 'utf-8');
  return filePath;
}

export function readAgentWorkspaceFile(
  agentId: string,
  section: AgentWorkspaceSection,
  relativePath: string
): string | null {
  const filePath = resolveAgentWorkspacePath(agentId, section, relativePath);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

export function fileExistsInAgentWorkspace(
  agentId: string,
  section: AgentWorkspaceSection,
  relativePath: string
): boolean {
  const filePath = resolveAgentWorkspacePath(agentId, section, relativePath);
  return fs.existsSync(filePath);
}

export function ensureAllAgentWorkspaces(agentIds: string[]): void {
  ensureDir(AGENTS_ROOT);
  for (const agentId of agentIds) {
    ensureAgentWorkspace(agentId);
  }
}
