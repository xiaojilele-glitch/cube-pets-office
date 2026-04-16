/**
 * Agent 信誉系统 — 共享类型定义与默认配置
 *
 * 前后端共享的信誉数据结构、等级/层级枚举、信号与事件接口，
 * 以及完整的 ReputationConfig 配置接口与默认值。
 * 所有接口均支持 JSON 序列化/反序列化，可直接用于 REST API 和 Socket.IO 传输。
 *
 * @see Requirements 1.1, 1.6, 2.1, 2.5
 */

// ---------------------------------------------------------------------------
// 维度分数
// ---------------------------------------------------------------------------

/** 五维信誉子分，每个维度 0-1000 整数 */
export interface DimensionScores {
  /** 任务完成质量 0-1000 */
  qualityScore: number;
  /** 响应速度与时效性 0-1000 */
  speedScore: number;
  /** 资源消耗效率 0-1000 */
  efficiencyScore: number;
  /** 协作表现 0-1000 */
  collaborationScore: number;
  /** 可靠性与稳定性 0-1000 */
  reliabilityScore: number;
}

// ---------------------------------------------------------------------------
// 角色信誉
// ---------------------------------------------------------------------------

/** 按角色维度独立维护的信誉记录 */
export interface RoleReputationRecord {
  roleId: string;
  /** 角色维度综合分 0-1000 */
  overallScore: number;
  dimensions: DimensionScores;
  totalTasksInRole: number;
  /** totalTasksInRole < 10 时为 true */
  lowConfidence: boolean;
}

// ---------------------------------------------------------------------------
// 等级与信任层级
// ---------------------------------------------------------------------------

/** 信誉等级：S(卓越) / A(优秀) / B(合格) / C(待改进) / D(不合格) */
export type ReputationGrade = "S" | "A" | "B" | "C" | "D";

/** 信任层级：trusted / standard / probation */
export type TrustTier = "trusted" | "standard" | "probation";

// ---------------------------------------------------------------------------
// 信誉档案
// ---------------------------------------------------------------------------

/** Agent 完整信誉档案 */
export interface ReputationProfile {
  agentId: string;
  /** 综合信誉分 0-1000 整数 */
  overallScore: number;
  dimensions: DimensionScores;
  grade: ReputationGrade;
  trustTier: TrustTier;
  /** 是否为外部 Agent（通过 A2A / Guest Agent 接入） */
  isExternal: boolean;
  /** 累计完成任务数 */
  totalTasks: number;
  /** 连续高质量任务计数 */
  consecutiveHighQuality: number;
  /** 按角色维度独立维护的信誉映射 */
  roleReputation: Record<string, RoleReputationRecord>;
  /** 最后活跃时间 ISO 时间戳，未活跃过为 null */
  lastActiveAt: string | null;
  /** 创建时间 ISO 时间戳 */
  createdAt: string;
  /** 更新时间 ISO 时间戳 */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 信誉更新信号
// ---------------------------------------------------------------------------

/** 任务完成后采集的原始信号 */
export interface ReputationSignal {
  agentId: string;
  taskId: string | number;
  roleId?: string;
  /** 任务质量评分 0-100 */
  taskQualityScore: number;
  /** 实际耗时（毫秒） */
  actualDurationMs: number;
  /** 预估耗时（毫秒） */
  estimatedDurationMs: number;
  /** 实际消耗 Token 数 */
  tokenConsumed: number;
  /** Token 预算 */
  tokenBudget: number;
  /** 是否被回滚 */
  wasRolledBack: boolean;
  /** 下游失败数 */
  downstreamFailures: number;
  /** 协作评分 0-100，仅 Taskforce 场景 */
  collaborationRating?: number;
  /** 任务复杂度 */
  taskComplexity?: "low" | "medium" | "high";
  /** 信号时间戳 ISO */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// 维度变动
// ---------------------------------------------------------------------------

/** 各维度的变动值 */
export interface DimensionDeltas {
  qualityDelta: number;
  speedDelta: number;
  efficiencyDelta: number;
  collaborationDelta: number;
  reliabilityDelta: number;
}

// ---------------------------------------------------------------------------
// 信誉变更事件
// ---------------------------------------------------------------------------

/** 每次信誉变动生成的审计记录 */
export interface ReputationChangeEvent {
  id: number;
  agentId: string;
  taskId: string | number | null;
  dimensionDeltas: DimensionDeltas;
  oldOverallScore: number;
  newOverallScore: number;
  /** "task_completed" | "inactivity_decay" | "streak_bonus" | "admin_adjust" | "admin_reset" */
  reason: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// 审计日志
// ---------------------------------------------------------------------------

/** 异常检测与防刷措施的审计条目 */
export interface ReputationAuditEntry {
  id: number;
  agentId: string;
  type:
    | "anomaly"
    | "grinding"
    | "collusion"
    | "admin_adjust"
    | "admin_reset"
    | "anomaly_review";
  detail: string;
  /** 异常前的信誉快照 */
  snapshot?: ReputationProfile;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/** 信誉系统完整配置 */
export interface ReputationConfig {
  /** 综合分加权权重（之和应为 1.0） */
  weights: {
    quality: number;
    speed: number;
    efficiency: number;
    collaboration: number;
    reliability: number;
  };
  /** 指数移动平均参数 */
  ema: {
    qualityAlpha: number;
    collaborationAlpha: number;
  };
  /** 可靠性维度惩罚/恢复参数 */
  reliability: {
    rollbackPenalty: number;
    downstreamFailurePenalty: number;
    successRecovery: number;
  };
  /** 单次更新任意维度最大变动幅度 */
  maxDeltaPerUpdate: number;
  /** 内部 Agent 初始信誉分 */
  internalInitialScore: number;
  /** 外部 Agent 初始信誉分 */
  externalInitialScore: number;
  /** 不活跃衰减参数 */
  decay: {
    /** 触发衰减的不活跃天数 */
    inactivityDays: number;
    /** 衰减速率（分/周） */
    decayRate: number;
    /** 衰减下限 */
    decayFloor: number;
  };
  /** 连胜加速参数 */
  streak: {
    /** 触发连胜的连续高质量任务数 */
    threshold: number;
    /** 高质量任务的最低 taskQualityScore */
    qualityMin: number;
    /** 连胜时 alpha 乘数 */
    alphaMultiplier: number;
  };
  /** 异常检测与防刷参数 */
  anomaly: {
    /** 24 小时内异常波动阈值 */
    threshold: number;
    /** 刷分检测：低复杂度任务占比阈值 */
    grindingTaskRatio: number;
    /** 刷分检测：24 小时内最低任务数 */
    grindingTaskCount: number;
    /** 低复杂度任务信誉更新权重 */
    lowComplexityWeight: number;
    /** 互评串通检测：最低评分阈值 */
    collusionRatingMin: number;
    /** 互评串通检测：与其他成员评分最低偏差 */
    collusionDeviationMin: number;
    /** 可疑评分降权系数 */
    suspiciousWeight: number;
    /** probation 阶段正向更新阻尼系数 */
    probationDamping: number;
  };
  /** 信誉等级边界 */
  grades: {
    S: { min: number; max: number };
    A: { min: number; max: number };
    B: { min: number; max: number };
    C: { min: number; max: number };
    D: { min: number; max: number };
  };
  /** 外部 Agent 信任层级升级条件 */
  externalUpgrade: {
    /** 升级到 standard 所需最低任务数 */
    standardTaskCount: number;
    /** 升级到 standard 所需最低分数 */
    standardMinScore: number;
    /** 升级到 trusted 所需最低任务数 */
    trustedTaskCount: number;
    /** 升级到 trusted 所需最低分数 */
    trustedMinScore: number;
  };
  /** 编排器调度参数 */
  scheduling: {
    /** 信誉权重占比 */
    reputationWeight: number;
    /** 适配度权重占比 */
    fitnessWeight: number;
    /** 竞争模式最低信誉阈值 */
    competitionMinThreshold: number;
    /** Lead 角色最低综合分 */
    leadMinScore: number;
    /** Worker 角色最低综合分 */
    workerMinScore: number;
    /** Reviewer 角色最低 qualityScore */
    reviewerMinQuality: number;
  };
  /** 低置信度处理参数 */
  lowConfidence: {
    /** 低置信度任务数阈值 */
    taskThreshold: number;
    /** 低置信度衰减系数 */
    dampingFactor: number;
    /** 角色信誉权重 */
    roleWeight: number;
    /** 整体信誉权重 */
    overallWeight: number;
  };
}

// ---------------------------------------------------------------------------
// 默认配置
// ---------------------------------------------------------------------------

/** 信誉系统默认配置 */
export const DEFAULT_REPUTATION_CONFIG: ReputationConfig = {
  weights: {
    quality: 0.3,
    speed: 0.15,
    efficiency: 0.2,
    collaboration: 0.15,
    reliability: 0.2,
  },
  ema: {
    qualityAlpha: 0.15,
    collaborationAlpha: 0.2,
  },
  reliability: {
    rollbackPenalty: 30,
    downstreamFailurePenalty: 15,
    successRecovery: 5,
  },
  maxDeltaPerUpdate: 50,
  internalInitialScore: 500,
  externalInitialScore: 400,
  decay: {
    inactivityDays: 14,
    decayRate: 10,
    decayFloor: 300,
  },
  streak: {
    threshold: 10,
    qualityMin: 80,
    alphaMultiplier: 1.5,
  },
  anomaly: {
    threshold: 200,
    grindingTaskRatio: 0.8,
    grindingTaskCount: 30,
    lowComplexityWeight: 0.3,
    collusionRatingMin: 90,
    collusionDeviationMin: 20,
    suspiciousWeight: 0.5,
    probationDamping: 0.7,
  },
  grades: {
    S: { min: 900, max: 1000 },
    A: { min: 700, max: 899 },
    B: { min: 500, max: 699 },
    C: { min: 300, max: 499 },
    D: { min: 0, max: 299 },
  },
  externalUpgrade: {
    standardTaskCount: 20,
    standardMinScore: 500,
    trustedTaskCount: 50,
    trustedMinScore: 700,
  },
  scheduling: {
    reputationWeight: 0.4,
    fitnessWeight: 0.6,
    competitionMinThreshold: 300,
    leadMinScore: 600,
    workerMinScore: 300,
    reviewerMinQuality: 500,
  },
  lowConfidence: {
    taskThreshold: 10,
    dampingFactor: 0.6,
    roleWeight: 0.4,
    overallWeight: 0.6,
  },
};
