import { describe, expect, it } from 'vitest';
import {
  ConversationChunker,
  extractSpeaker,
  parseConversationTurns,
} from '../rag/chunking/conversation-chunker.js';
import type { ChunkMetadata } from '../../shared/rag/contracts.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetadata(): ChunkMetadata {
  return {
    ingestedAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    contentHash: 'test-hash',
  };
}

/** Generate a string with exactly `n` whitespace-separated tokens */
function makeTokens(n: number, prefix = 'w'): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');
}

// ---------------------------------------------------------------------------
// extractSpeaker
// ---------------------------------------------------------------------------

describe('extractSpeaker', () => {
  it('returns null for empty string', () => {
    expect(extractSpeaker('')).toBeNull();
  });

  it('returns null for whitespace-only', () => {
    expect(extractSpeaker('   ')).toBeNull();
  });

  it('detects "Speaker: message" pattern', () => {
    expect(extractSpeaker('User: Hello there')).toBe('User');
    expect(extractSpeaker('Agent: I can help')).toBe('Agent');
    expect(extractSpeaker('Alice Bob: hi')).toBe('Alice Bob');
  });

  it('detects "[Speaker] message" pattern', () => {
    expect(extractSpeaker('[User] Hello there')).toBe('User');
    expect(extractSpeaker('[System Admin] Restarting')).toBe('System Admin');
  });

  it('detects "**Speaker**: message" markdown bold pattern', () => {
    expect(extractSpeaker('**User**: Hello')).toBe('User');
    expect(extractSpeaker('**Agent Alpha**: Done')).toBe('Agent Alpha');
  });

  it('detects "Speaker (timestamp): message" pattern', () => {
    expect(extractSpeaker('User (10:30): Hello')).toBe('User');
    expect(extractSpeaker('Agent (2024-01-01 10:00): Done')).toBe('Agent');
  });

  it('returns null for non-speaker lines', () => {
    expect(extractSpeaker('This is just a regular message')).toBeNull();
    expect(extractSpeaker('  some indented text')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseConversationTurns
// ---------------------------------------------------------------------------

describe('parseConversationTurns', () => {
  it('parses simple two-speaker conversation', () => {
    const content = 'User: Hello\nAgent: Hi there\nUser: How are you?';
    const turns = parseConversationTurns(content);

    expect(turns).toHaveLength(3);
    expect(turns[0].speaker).toBe('User');
    expect(turns[1].speaker).toBe('Agent');
    expect(turns[2].speaker).toBe('User');
  });

  it('merges consecutive lines from same speaker', () => {
    const content = 'User: Hello\nThis is still me\nAgent: Got it';
    const turns = parseConversationTurns(content);

    expect(turns).toHaveLength(2);
    expect(turns[0].speaker).toBe('User');
    expect(turns[0].content).toContain('This is still me');
    expect(turns[1].speaker).toBe('Agent');
  });

  it('handles bracket speaker format', () => {
    const content = '[Alice] Hi\n[Bob] Hey\n[Alice] What\'s up?';
    const turns = parseConversationTurns(content);

    expect(turns).toHaveLength(3);
    expect(turns[0].speaker).toBe('Alice');
    expect(turns[1].speaker).toBe('Bob');
    expect(turns[2].speaker).toBe('Alice');
  });

  it('assigns "unknown" to content before any speaker', () => {
    const content = 'Some preamble text\nUser: Hello';
    const turns = parseConversationTurns(content);

    expect(turns).toHaveLength(2);
    expect(turns[0].speaker).toBe('unknown');
    expect(turns[1].speaker).toBe('User');
  });

  it('returns empty for empty content', () => {
    expect(parseConversationTurns('')).toHaveLength(0);
    expect(parseConversationTurns('   ')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ConversationChunker — basic behavior
// ---------------------------------------------------------------------------

describe('ConversationChunker', () => {
  const meta = makeMetadata();

  it('returns empty array for empty content', () => {
    const chunker = new ConversationChunker();
    expect(chunker.chunk('', meta)).toEqual([]);
    expect(chunker.chunk('   ', meta)).toEqual([]);
  });

  it('chunks a simple conversation by speaker turns', () => {
    const chunker = new ConversationChunker({ minTokens: 1, maxTokens: 1024 });
    const content = `User: ${makeTokens(20)}\nAgent: ${makeTokens(20)}\nUser: ${makeTokens(20)}`;
    const result = chunker.chunk(content, meta);

    expect(result).toHaveLength(3);
    expect(result[0].metadata.speaker).toBe('User');
    expect(result[1].metadata.speaker).toBe('Agent');
    expect(result[2].metadata.speaker).toBe('User');
  });

  it('sets turnIndex in metadata', () => {
    const chunker = new ConversationChunker({ minTokens: 1, maxTokens: 1024 });
    const content = `User: ${makeTokens(10)}\nAgent: ${makeTokens(10)}`;
    const result = chunker.chunk(content, meta);

    expect(result[0].metadata.turnIndex).toBe(0);
    expect(result[1].metadata.turnIndex).toBe(1);
  });

  it('sets sourceType to conversation', () => {
    const chunker = new ConversationChunker({ minTokens: 1, maxTokens: 1024 });
    const content = `User: ${makeTokens(10)}`;
    const result = chunker.chunk(content, meta);

    expect(result[0].sourceType).toBe('conversation');
  });

  // -----------------------------------------------------------------------
  // Merge small turns
  // -----------------------------------------------------------------------

  it('merges small turns with adjacent when below minTokens', () => {
    const chunker = new ConversationChunker({ minTokens: 30, maxTokens: 1024 });
    // Each turn has ~11 tokens (Speaker: + 10 words), below minTokens=30
    const content = `User: ${makeTokens(10)}\nAgent: ${makeTokens(10)}\nUser: ${makeTokens(10)}`;
    const result = chunker.chunk(content, meta);

    // All three turns should be merged since each is < 30 tokens
    expect(result.length).toBeLessThan(3);
  });

  // -----------------------------------------------------------------------
  // Split large turns
  // -----------------------------------------------------------------------

  it('splits turns that exceed maxTokens', () => {
    const chunker = new ConversationChunker({ minTokens: 1, maxTokens: 100 });
    const content = `User: ${makeTokens(250)}`;
    const result = chunker.chunk(content, meta);

    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(100);
    }
    // All chunks should have speaker = User
    for (const chunk of result) {
      expect(chunk.metadata.speaker).toBe('User');
    }
  });

  // -----------------------------------------------------------------------
  // Token range invariant
  // -----------------------------------------------------------------------

  it('ensures chunks are within [minTokens, maxTokens] for large conversation', () => {
    const chunker = new ConversationChunker({ minTokens: 64, maxTokens: 1024 });
    // Build a conversation with many turns, each having enough tokens
    const turns = Array.from({ length: 20 }, (_, i) => {
      const speaker = i % 2 === 0 ? 'User' : 'Agent';
      return `${speaker}: ${makeTokens(100)}`;
    });
    const content = turns.join('\n');
    const result = chunker.chunk(content, meta);

    expect(result.length).toBeGreaterThan(0);
    for (const chunk of result) {
      expect(chunk.tokenCount).toBeGreaterThanOrEqual(64);
      expect(chunk.tokenCount).toBeLessThanOrEqual(1024);
    }
  });

  // -----------------------------------------------------------------------
  // ChunkRecord structure
  // -----------------------------------------------------------------------

  it('produces valid ChunkRecord fields', () => {
    const chunker = new ConversationChunker({ minTokens: 1, maxTokens: 1024 });
    const content = `User: ${makeTokens(20)}\nAgent: ${makeTokens(20)}`;
    const result = chunker.chunk(content, meta);

    for (let i = 0; i < result.length; i++) {
      const chunk = result[i];
      expect(chunk.chunkId).toBe(`chunk:${i}`);
      expect(chunk.chunkIndex).toBe(i);
      expect(chunk.content).toBeTruthy();
      expect(chunk.tokenCount).toBeGreaterThan(0);
      expect(chunk.metadata.speaker).toBeTruthy();
      expect(chunk.metadata.turnIndex).toBeDefined();
    }
  });

  // -----------------------------------------------------------------------
  // fromConfig factory
  // -----------------------------------------------------------------------

  it('creates instance from ChunkingConfig via fromConfig', () => {
    const chunker = ConversationChunker.fromConfig({
      strategy: 'conversation_turn',
      maxTokens: 200,
      minTokens: 10,
    });
    const content = `User: ${makeTokens(50)}\nAgent: ${makeTokens(50)}`;
    const result = chunker.chunk(content, meta);

    expect(result.length).toBeGreaterThan(0);
    for (const chunk of result) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(200);
    }
  });

  it('fromConfig uses defaults when config is undefined', () => {
    const chunker = ConversationChunker.fromConfig(undefined);
    const content = `User: ${makeTokens(100)}\nAgent: ${makeTokens(100)}`;
    const result = chunker.chunk(content, meta);

    expect(result.length).toBeGreaterThan(0);
  });
});
