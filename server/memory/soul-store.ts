import fs from 'fs';
import path from 'path';

import db from '../db/index.js';
import { fileExistsInAgentWorkspace, resolveAgentWorkspacePath, writeAgentWorkspaceFile } from './workspace.js';

function normalizeSoulContent(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  return normalized ? `${normalized}\n` : '';
}

function dedupeStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

export class SoulStore {
  getSoulFilePath(agentId: string): string {
    return resolveAgentWorkspacePath(agentId, 'root', 'SOUL.md');
  }

  ensureSoulFile(agentId: string, fallbackSoulMd: string = ''): string {
    const soulPath = this.getSoulFilePath(agentId);
    const dbSoul = db.getAgent(agentId)?.soul_md || fallbackSoulMd || '';

    if (fs.existsSync(soulPath)) {
      const content = normalizeSoulContent(fs.readFileSync(soulPath, 'utf-8'));
      if (content && content !== (db.getAgent(agentId)?.soul_md || '')) {
        db.updateAgentSoul(agentId, content);
      }
      return content;
    }

    const content = normalizeSoulContent(dbSoul);
    writeAgentWorkspaceFile(agentId, 'root', 'SOUL.md', content);
    if (content && content !== (db.getAgent(agentId)?.soul_md || '')) {
      db.updateAgentSoul(agentId, content);
    }
    return content;
  }

  ensureAllSoulFiles(): void {
    for (const agent of db.getAgents()) {
      this.ensureSoulFile(agent.id, agent.soul_md || '');
    }
  }

  getSoulText(agentId: string, fallbackSoulMd: string = ''): string {
    return this.ensureSoulFile(agentId, fallbackSoulMd);
  }

  getSoul(agentId: string, fallbackSoulMd: string = ''): {
    soulMd: string;
    filePath: string;
    exists: boolean;
  } {
    const soulMd = this.ensureSoulFile(agentId, fallbackSoulMd);
    return {
      soulMd,
      filePath: this.getSoulFilePath(agentId),
      exists: fileExistsInAgentWorkspace(agentId, 'root', 'SOUL.md'),
    };
  }

  updateSoul(agentId: string, soulMd: string): string {
    const normalized = normalizeSoulContent(soulMd);
    writeAgentWorkspaceFile(agentId, 'root', 'SOUL.md', normalized);
    db.updateAgentSoul(agentId, normalized);
    return normalized;
  }

  appendLearnedBehaviors(agentId: string, behaviors: string[]): string {
    const additions = dedupeStrings(behaviors).map((behavior) => `- ${behavior}`);
    if (additions.length === 0) {
      return this.getSoulText(agentId);
    }

    const currentSoul = this.getSoulText(agentId);
    const existingLines = new Set(
      currentSoul
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('- '))
    );
    const newLines = additions.filter((line) => !existingLines.has(line));
    if (newLines.length === 0) {
      return currentSoul;
    }

    const learnedHeading = '## Learned Behaviors';
    let nextSoul = currentSoul.trimEnd();

    if (!nextSoul) {
      nextSoul = `${learnedHeading}\n\n${newLines.join('\n')}`;
    } else if (nextSoul.includes(learnedHeading)) {
      nextSoul = `${nextSoul}\n${newLines.join('\n')}`;
    } else {
      nextSoul = `${nextSoul}\n\n${learnedHeading}\n\n${newLines.join('\n')}`;
    }

    return this.updateSoul(agentId, nextSoul);
  }
}

export const soulStore = new SoulStore();
