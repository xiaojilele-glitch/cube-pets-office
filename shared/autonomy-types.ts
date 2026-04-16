import type { RingBuffer } from "./ring-buffer";

// ─── Agent 能力画像 ───────────────────────────────────────────

/** Agent 能力画像 */
export interface CapabilityProfile {
  agentId: string;
  skillVector: Map<string, number>; // 技能类别 → 熟练度 0.0-1.0
  loadFactor: number; // activeTasks / maxConcurrentTasks
  confidenceScore: number; // 综合置信度
  resourceQuota: ResourceQuota;
  specializationTags: string[];
  avgLatencyMs: Map<string, number>; // 技能类别 → 平均耗时 ms
  taskHistory: RingBuffer<TaskHistoryEntry>; // 最近 100 次任务
  needsReview: boolean;
  completedTaskCount: number;
  lastUpdatedAt: number;
}

export interface ResourceQuota {
  remainingTokenBudget: number;
  memoryMb: number;
  cpuPercent: number;
}

export interface TaskHistoryEntry {
  taskId: string;
  skillCategory: string;
  qualityScore: number; // 0.0-1.0
  success: boolean;
  completedAt: number;
}

// ─── 自评估 ──────────────────────────────────────────────────

/** 自评估决策 */
export type AssessmentDecision =
  | "ACCEPT"
  | "ACCEPT_WITH_CAVEAT"
  | "REQUEST_ASSIST"
  | "REJECT_AND_REFER";

export interface AssessmentResult {
  agentId: string;
  taskId: string;
  fitnessScore: number;
  decision: AssessmentDecision;
  reason: string;
  referralList: string[]; // 仅 REJECT_AND_REFER 时有值
  assessedAt: number;
  durationMs: number;
}

/** 自评估权重配置 */
export interface AssessmentWeights {
  w1_skillMatch: number; // 默认 0.4
  w2_loadFactor: number; // 默认 0.2
  w3_confidence: number; // 默认 0.25
  w4_resource: number; // 默认 0.15
}

// ─── 分配决策 ────────────────────────────────────────────────

export type AllocationStrategy =
  | "DIRECT_ASSIGN"
  | "CAVEAT_ASSIGN"
  | "TASKFORCE"
  | "FORCE_ASSIGN";

export interface AllocationDecision {
  taskId: string;
  strategy: AllocationStrategy;
  assignedAgentId: string;
  assessments: AssessmentResult[];
  reason: string;
  forceAssignReason?: string;
  timestamp: number;
}

// ─── 竞争执行 ────────────────────────────────────────────────

/** 竞争执行会话 */
export interface CompetitionSession {
  id: string;
  taskId: string;
  contestants: ContestantEntry[];
  status: "preparing" | "running" | "judging" | "completed" | "degraded";
  deadline: number;
  budgetApproved: boolean;
  degradationReason?: string;
  judgingResult?: JudgingResult;
  competitionCost?: CompetitionCost;
  startedAt: number;
  completedAt?: number;
}

export interface ContestantEntry {
  agentId: string;
  isExternal: boolean;
  result?: string;
  submittedAt?: number;
  tokenConsumed: number;
  timedOut: boolean;
}

// ─── 裁判评选 ────────────────────────────────────────────────

/** 裁判评选结果 */
export interface JudgingResult {
  scores: JudgingScore[];
  ranking: string[]; // agentId 按总分降序
  rationaleText: string;
  winnerId: string;
  mergeRequired: boolean; // Top1 与 Top2 差 < 5%
}

export interface JudgingScore {
  agentId: string;
  correctness: number; // 权重 0.35
  quality: number; // 权重 0.30
  efficiency: number; // 权重 0.20
  novelty: number; // 权重 0.15
  totalWeighted: number;
}

export interface CompetitionCost {
  totalTokens: number;
  estimatedNormalTokens: number;
  roi: number; // qualityScore / normalQualityEstimate
}

// ─── 工作组 ──────────────────────────────────────────────────

/** 工作组会话 */
export interface TaskforceSession {
  taskforceId: string;
  taskId: string;
  leadAgentId: string;
  members: TaskforceMember[];
  status: "recruiting" | "active" | "merging" | "dissolved";
  recruitmentManifest?: RecruitmentManifest;
  subTasks: SubTask[];
  createdAt: number;
  dissolvedAt?: number;
}

export interface TaskforceMember {
  agentId: string;
  role: "lead" | "worker" | "reviewer";
  joinedAt: number;
  lastHeartbeat: number;
  online: boolean;
}

export interface RecruitmentManifest {
  requiredSkills: string[];
  estimatedEffort: string;
  deadline: number;
  taskDescription: string;
}

export interface SubTask {
  id: string;
  assignedTo: string;
  description: string;
  status: "assigned" | "in_progress" | "review" | "done" | "failed";
  reviewerId?: string;
  result?: string;
}

/** Taskforce 消息类型 */
export type TaskforceMessageType =
  | "TASK_ASSIGN"
  | "PROGRESS_UPDATE"
  | "HELP_REQUEST"
  | "REVIEW_REQUEST"
  | "REVIEW_RESULT"
  | "MERGE_REQUEST";

// ─── 全局配置 ────────────────────────────────────────────────

/** 自治能力全局配置 */
export interface AutonomyConfig {
  enabled: boolean;
  assessmentWeights: AssessmentWeights;
  competition: {
    defaultContestantCount: number; // 默认 3，范围 2-5
    maxDeadlineMs: number; // 默认 300000
    budgetRatio: number; // 默认 0.3
  };
  taskforce: {
    heartbeatIntervalMs: number; // 默认 30000
    maxMissedHeartbeats: number; // 默认 3
  };
  skillDecay: {
    inactiveDays: number; // 默认 30
    decayRatePerWeek: number; // 默认 0.05
  };
}

// ─── API 数据 ────────────────────────────────────────────────

/** API 返回的 autonomy 数据 */
export interface AutonomyData {
  assessments: AssessmentResult[];
  competitions: CompetitionSession[];
  taskforces: TaskforceSession[];
}
