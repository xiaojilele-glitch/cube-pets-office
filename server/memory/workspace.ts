import fs from 'fs';
import path from 'path';

const AGENTS_ROOT = path.resolve(process.cwd(), 'data/agents');

export interface AgentWorkspacePaths {
  rootDir: string;
  sessionsDir: string;
  memoryDir: string;
  reportsDir: string;
}

export type AgentWorkspaceScope = 'root' | 'sessions' | 'memory' | 'reports';

function assertValidAgentId(agentId: string): string {
  const normalized = agentId.trim();
  if (!normalized) {
    throw new Error('Agent ID is required');
  }

  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(normalized)) {
    throw new Error(`Invalid agent ID: ${agentId}`);
  }

  return normalized;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getAgentWorkspacePaths(agentId: string): AgentWorkspacePaths {
  const normalizedAgentId = assertValidAgentId(agentId);
  const rootDir = path.join(AGENTS_ROOT, normalizedAgentId);
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

export function ensureAgentWorkspaces(agentIds: string[]): AgentWorkspacePaths[] {
  const uniqueAgentIds = Array.from(new Set(agentIds.map((agentId) => assertValidAgentId(agentId))));
  return uniqueAgentIds.map((agentId) => ensureAgentWorkspace(agentId));
}

export function getAgentWorkspaceScopeDir(
  agentId: string,
  scope: AgentWorkspaceScope = 'root'
): string {
  const paths = getAgentWorkspacePaths(agentId);

  switch (scope) {
    case 'root':
      return paths.rootDir;
    case 'sessions':
      return paths.sessionsDir;
    case 'memory':
      return paths.memoryDir;
    case 'reports':
      return paths.reportsDir;
    default:
      throw new Error(`Unsupported workspace scope: ${scope}`);
  }
}

export function getAgentsRootDir(): string {
  return AGENTS_ROOT;
}
