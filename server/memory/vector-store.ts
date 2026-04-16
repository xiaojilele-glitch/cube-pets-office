import {
  agentWorkspaceFileExists,
  readAgentWorkspaceFile,
  writeAgentWorkspaceFile,
} from "../core/access-guard.js";

export interface VectorizedMemorySummary {
  workflowId: string;
  createdAt: string;
  directive: string;
  status: string;
  role: string;
  stage: string | null;
  summary: string;
  keywords: string[];
}

interface VectorRecord {
  id: string;
  workflowId: string;
  createdAt: string;
  text: string;
  vector: number[];
  summary: VectorizedMemorySummary;
}

interface VectorIndexFile {
  version: 1;
  dimension: number;
  records: VectorRecord[];
}

export interface VectorSearchHit {
  summary: VectorizedMemorySummary;
  score: number;
}

const VECTOR_DIMENSION = 96;

function tokenize(text: string): string[] {
  return (
    text.toLowerCase().match(/[\u4e00-\u9fff]{1,8}|[a-z0-9_]+/g) || []
  ).filter(token => token.length >= 2);
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0)
  );
  if (magnitude === 0) return vector;
  return vector.map(value => value / magnitude);
}

function embedText(
  text: string,
  dimension: number = VECTOR_DIMENSION
): number[] {
  const vector = new Array<number>(dimension).fill(0);
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  for (const [token, count] of Array.from(counts.entries())) {
    const hash = hashToken(token);
    const index = hash % dimension;
    const sign = hash % 2 === 0 ? 1 : -1;
    vector[index] += count * sign;
  }

  return normalizeVector(vector);
}

function cosineSimilarity(left: number[], right: number[]): number {
  let score = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

function buildRecordId(workflowId: string): string {
  return `${workflowId}::summary`;
}

function buildVectorText(summary: VectorizedMemorySummary): string {
  return [
    summary.directive,
    summary.summary,
    summary.role,
    summary.status,
    summary.stage || "",
    summary.keywords.join(" "),
  ]
    .filter(Boolean)
    .join("\n");
}

export class VectorStore {
  private getIndexFile(agentId: string): string {
    return "vectors.json";
  }

  private readIndex(agentId: string): VectorIndexFile {
    if (
      !agentWorkspaceFileExists(agentId, this.getIndexFile(agentId), "memory")
    ) {
      return { version: 1, dimension: VECTOR_DIMENSION, records: [] };
    }

    try {
      const content = readAgentWorkspaceFile(
        agentId,
        this.getIndexFile(agentId),
        "memory"
      );
      if (!content) {
        return { version: 1, dimension: VECTOR_DIMENSION, records: [] };
      }

      const parsed = JSON.parse(content) as VectorIndexFile;
      return {
        version: 1,
        dimension: parsed.dimension || VECTOR_DIMENSION,
        records: Array.isArray(parsed.records) ? parsed.records : [],
      };
    } catch {
      return { version: 1, dimension: VECTOR_DIMENSION, records: [] };
    }
  }

  private writeIndex(agentId: string, index: VectorIndexFile): void {
    writeAgentWorkspaceFile(
      agentId,
      this.getIndexFile(agentId),
      JSON.stringify(index, null, 2),
      "memory"
    );
  }

  upsertMemorySummary(agentId: string, summary: VectorizedMemorySummary): void {
    const index = this.readIndex(agentId);
    const text = buildVectorText(summary);
    const record: VectorRecord = {
      id: buildRecordId(summary.workflowId),
      workflowId: summary.workflowId,
      createdAt: summary.createdAt,
      text,
      vector: embedText(text, index.dimension),
      summary,
    };

    const records = index.records.filter(item => item.id !== record.id);
    records.push(record);
    records.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt)
    );
    this.writeIndex(agentId, { ...index, records });
  }

  searchMemorySummaries(
    agentId: string,
    query: string,
    topK: number = 5
  ): VectorSearchHit[] {
    const normalizedQuery = query.trim();
    const index = this.readIndex(agentId);
    if (!normalizedQuery) {
      return index.records
        .slice(-topK)
        .reverse()
        .map(record => ({ summary: record.summary, score: 0 }));
    }

    const queryVector = embedText(normalizedQuery, index.dimension);
    return index.records
      .map(record => ({
        summary: record.summary,
        score: cosineSimilarity(queryVector, record.vector),
      }))
      .filter(item => item.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.summary.createdAt.localeCompare(left.summary.createdAt)
      )
      .slice(0, topK);
  }
}

export const vectorStore = new VectorStore();
