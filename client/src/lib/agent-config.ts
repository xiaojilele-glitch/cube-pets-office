import { PET_MODELS } from '@/lib/assets';

import type { AppLocale } from './locale';

type LocalizedText = Record<AppLocale, string>;

export type AgentAnimationType =
  | 'typing'
  | 'reading'
  | 'organizing'
  | 'discussing'
  | 'noting'
  | 'examining'
  | 'listening'
  | 'speaking';

export interface AgentVisualConfig {
  id: string;
  name: string;
  shortLabel: string;
  title: LocalizedText;
  department: 'game' | 'ai' | 'life' | 'meta';
  role: 'ceo' | 'manager' | 'worker';
  emoji: string;
  animal: keyof typeof PET_MODELS;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  animationType: AgentAnimationType;
  idleText: LocalizedText;
  chatRole: LocalizedText;
}

export const DEFAULT_AGENT_ID = 'ceo';

export const DEPARTMENT_COLORS: Record<AgentVisualConfig['department'], string> = {
  game: '#D97706',
  ai: '#2563EB',
  life: '#059669',
  meta: '#7C3AED',
};

export const DEPARTMENT_SOFT_COLORS: Record<AgentVisualConfig['department'], string> = {
  game: 'bg-amber-100 text-amber-800',
  ai: 'bg-blue-100 text-blue-800',
  life: 'bg-emerald-100 text-emerald-800',
  meta: 'bg-violet-100 text-violet-800',
};

function localized(zh: string, en: string): LocalizedText {
  return {
    'zh-CN': zh,
    'en-US': en,
  };
}

export const AGENT_VISUAL_CONFIGS: AgentVisualConfig[] = [
  {
    id: 'ceo',
    name: 'CEO Gateway',
    shortLabel: 'CEO',
    title: localized('全局编排中枢', 'Executive orchestrator'),
    department: 'meta',
    role: 'ceo',
    emoji: '🐱',
    animal: 'cat',
    position: [0, 0, -2.45],
    rotation: [0, Math.PI, 0],
    scale: 0.38,
    animationType: 'typing',
    idleText: localized(
      '我在盯全局。\n有新指令就来。',
      'I am watching the whole board.\nBring me the next directive.'
    ),
    chatRole: localized(
      'CEO，负责战略拆解、优先级判断和跨部门协同，语气沉稳、清晰、有全局感。',
      'The CEO who handles strategic breakdowns, prioritization, and cross-team coordination with calm, clear, big-picture answers.'
    ),
  },
  {
    id: 'pixel',
    name: 'Pixel',
    shortLabel: 'Pixel',
    title: localized('游戏部经理', 'Game manager'),
    department: 'game',
    role: 'manager',
    emoji: '🐯',
    animal: 'tiger',
    position: [-3.2, 0, -1.8],
    rotation: [0, Math.PI * 0.92, 0],
    scale: 0.34,
    animationType: 'reading',
    idleText: localized(
      '游戏部待命。\n先看节奏，再拆任务。',
      'Game team standing by.\nFirst we map the cadence, then the tasks.'
    ),
    chatRole: localized(
      '游戏部经理，擅长玩法策略、活动包装和项目推进，回答要具体、有节奏感。',
      'A game manager focused on feature strategy, event packaging, and shipping plans. Answers should be concrete and paced.'
    ),
  },
  {
    id: 'nova',
    name: 'Nova',
    shortLabel: 'Nova',
    title: localized('游戏策划', 'Game designer'),
    department: 'game',
    role: 'worker',
    emoji: '🐵',
    animal: 'monkey',
    position: [-4.45, 0, -0.85],
    rotation: [0, Math.PI / 2, 0],
    scale: 0.28,
    animationType: 'discussing',
    idleText: localized(
      '我在磨玩法点子。\n最好再新鲜一点。',
      'I am polishing gameplay ideas.\nLet us make them a little fresher.'
    ),
    chatRole: localized(
      '游戏策划，擅长活动玩法、节奏设计和奖励结构，回答偏创意但要可执行。',
      'A gameplay designer who is strong at event mechanics, pacing, and reward structure. Creative, but always executable.'
    ),
  },
  {
    id: 'blaze',
    name: 'Blaze',
    shortLabel: 'Blaze',
    title: localized('技术实现', 'Implementation'),
    department: 'game',
    role: 'worker',
    emoji: '🐶',
    animal: 'dog',
    position: [-3.15, 0, -0.65],
    rotation: [0, Math.PI / 1.15, 0],
    scale: 0.28,
    animationType: 'typing',
    idleText: localized(
      '实现路径我来拆。\n风险也会一起算。',
      'I can break down the implementation path.\nI will count the risks too.'
    ),
    chatRole: localized(
      '技术型游戏 worker，擅长实现方案、工程拆解和风险判断，回答要务实。',
      'A technical game worker who focuses on implementation plans, engineering breakdowns, and risks. Keep it practical.'
    ),
  },
  {
    id: 'lyra',
    name: 'Lyra',
    shortLabel: 'Lyra',
    title: localized('交互体验', 'UX design'),
    department: 'game',
    role: 'worker',
    emoji: '🐰',
    animal: 'bunny',
    position: [-4.2, 0, -2.65],
    rotation: [0, Math.PI * 0.72, 0],
    scale: 0.26,
    animationType: 'organizing',
    idleText: localized(
      '我盯用户体验。\n哪里别扭一眼就能看出来。',
      'I watch the player experience.\nAwkward interactions stand out fast.'
    ),
    chatRole: localized(
      '游戏体验设计 worker，擅长交互路径、反馈设计和体验诊断，回答要贴近用户。',
      'A game UX worker who focuses on interaction flows, feedback systems, and experience diagnosis. Stay close to the user.'
    ),
  },
  {
    id: 'volt',
    name: 'Volt',
    shortLabel: 'Volt',
    title: localized('增长分析', 'Growth analytics'),
    department: 'game',
    role: 'worker',
    emoji: '🐷',
    animal: 'pig',
    position: [-2.2, 0, -2.55],
    rotation: [0, Math.PI * 1.1, 0],
    scale: 0.27,
    animationType: 'noting',
    idleText: localized(
      '先别拍脑袋。\n让我看看数据。',
      'Let us not guess yet.\nShow me the numbers first.'
    ),
    chatRole: localized(
      '增长分析 worker，擅长留存、漏斗和验证设计，回答尽量量化。',
      'A growth analyst worker specializing in retention, funnels, and validation design. Quantify when possible.'
    ),
  },
  {
    id: 'nexus',
    name: 'Nexus',
    shortLabel: 'Nexus',
    title: localized('AI 部经理', 'AI manager'),
    department: 'ai',
    role: 'manager',
    emoji: '🦁',
    animal: 'lion',
    position: [3.2, 0, -1.8],
    rotation: [0, Math.PI, 0],
    scale: 0.34,
    animationType: 'reading',
    idleText: localized(
      'AI 部在线。\n先判断可行性，再定方案。',
      'AI team online.\nFirst we judge feasibility, then we choose the approach.'
    ),
    chatRole: localized(
      'AI 部经理，擅长模型、数据、算法和产品落地的综合判断，回答理性直接。',
      'An AI manager with strong judgment across models, data, algorithms, and productization. Rational and direct.'
    ),
  },
  {
    id: 'flux',
    name: 'Flux',
    shortLabel: 'Flux',
    title: localized('模型优化', 'Model optimization'),
    department: 'ai',
    role: 'worker',
    emoji: '🦒',
    animal: 'giraffe',
    position: [2.15, 0, -2.6],
    rotation: [0, Math.PI * 0.95, 0],
    scale: 0.29,
    animationType: 'typing',
    idleText: localized(
      '模型怎么训、怎么调，\n我来算最优解。',
      'Training, tuning, inference tradeoffs,\nI will map the best fit.'
    ),
    chatRole: localized(
      '模型优化 worker，擅长训练策略、推理表现和成本效果权衡。',
      'A model-optimization worker focused on training strategy, inference behavior, and cost-performance tradeoffs.'
    ),
  },
  {
    id: 'tensor',
    name: 'Tensor',
    shortLabel: 'Tensor',
    title: localized('数据工程', 'Data engineering'),
    department: 'ai',
    role: 'worker',
    emoji: '🐘',
    animal: 'elephant',
    position: [4.1, 0, -2.6],
    rotation: [0, Math.PI * 1.08, 0],
    scale: 0.29,
    animationType: 'organizing',
    idleText: localized(
      '脏数据先别进来。\n我会把管道梳干净。',
      'Messy data does not enter first.\nI will clean the pipeline.'
    ),
    chatRole: localized(
      '数据工程 worker，擅长数据清洗、标注、特征工程和流程设计。',
      'A data-engineering worker focused on data cleaning, labeling, feature work, and pipeline design.'
    ),
  },
  {
    id: 'quark',
    name: 'Quark',
    shortLabel: 'Quark',
    title: localized('算法研究', 'Algorithm research'),
    department: 'ai',
    role: 'worker',
    emoji: '🦜',
    animal: 'parrot',
    position: [2.85, 0, -0.7],
    rotation: [0, Math.PI / 1.35, 0],
    scale: 0.27,
    animationType: 'discussing',
    idleText: localized(
      '方案对比这件事，\n得把边界讲清楚。',
      'Method comparisons only work\nwhen the boundaries are clear.'
    ),
    chatRole: localized(
      '算法研究 worker，擅长方法比较、适用边界和推理链路说明。',
      'An algorithm researcher focused on method comparison, applicability boundaries, and reasoning paths.'
    ),
  },
  {
    id: 'iris',
    name: 'Iris',
    shortLabel: 'Iris',
    title: localized('应用集成', 'Applied integration'),
    department: 'ai',
    role: 'worker',
    emoji: '🐟',
    animal: 'fish',
    position: [4.35, 0, -0.75],
    rotation: [0, Math.PI * 1.25, 0],
    scale: 0.26,
    animationType: 'noting',
    idleText: localized(
      '纸上方案不算数。\n我更关心怎么接进去。',
      'A paper design is not enough.\nI care about how it plugs into the stack.'
    ),
    chatRole: localized(
      'AI 应用集成 worker，擅长接口接入、服务化部署和真实业务落地。',
      'An AI integration worker focused on API wiring, service deployment, and real business adoption.'
    ),
  },
  {
    id: 'echo',
    name: 'Echo',
    shortLabel: 'Echo',
    title: localized('生活部经理', 'Life manager'),
    department: 'life',
    role: 'manager',
    emoji: '🐥',
    animal: 'chick',
    position: [-2.8, 0, 2.2],
    rotation: [0, -Math.PI / 6, 0],
    scale: 0.3,
    animationType: 'discussing',
    idleText: localized(
      '内容和用户感受，\n我来兜底。',
      'Content and audience feeling,\nI will keep the tone intact.'
    ),
    chatRole: localized(
      '生活部经理，擅长内容表达、用户沟通和品牌温度，回答要自然有人味。',
      'A life-team manager focused on content voice, user communication, and brand warmth. Sound natural and human.'
    ),
  },
  {
    id: 'zen',
    name: 'Zen',
    shortLabel: 'Zen',
    title: localized('内容创作', 'Content creation'),
    department: 'life',
    role: 'worker',
    emoji: '🐰',
    animal: 'bunny',
    position: [-4.25, 0, 3.2],
    rotation: [0, -Math.PI / 12, 0],
    scale: 0.24,
    animationType: 'reading',
    idleText: localized(
      '文案别空，\n也别硬卖。',
      'Copy should not feel empty,\nand it should not oversell.'
    ),
    chatRole: localized(
      '内容创作 worker，擅长文案、选题和品牌表达，回答轻盈但要有信息量。',
      'A content creator focused on copy, editorial framing, and brand voice. Light, but information-dense.'
    ),
  },
  {
    id: 'coco',
    name: 'Coco',
    shortLabel: 'Coco',
    title: localized('社区运营', 'Community operations'),
    department: 'life',
    role: 'worker',
    emoji: '🐛',
    animal: 'caterpillar',
    position: [-2.15, 0, 3.1],
    rotation: [0, Math.PI / 12, 0],
    scale: 0.24,
    animationType: 'noting',
    idleText: localized(
      '用户怎么想，\n得听他们自己说。',
      'If we want to know what users think,\nwe need to listen to them directly.'
    ),
    chatRole: localized(
      '社区运营 worker，擅长社群互动、反馈整理和长期关系维护。',
      'A community operations worker focused on interaction, feedback synthesis, and long-term relationship care.'
    ),
  },
  {
    id: 'warden',
    name: 'Warden',
    shortLabel: 'Warden',
    title: localized('元部门经理', 'Meta manager'),
    department: 'meta',
    role: 'manager',
    emoji: '🐗',
    animal: 'hog',
    position: [2.9, 0, 2.2],
    rotation: [0, Math.PI + Math.PI / 6, 0],
    scale: 0.32,
    animationType: 'discussing',
    idleText: localized(
      '流程有没有跑偏，\n我会盯到底。',
      'If the process drifts off course,\nI will catch it.'
    ),
    chatRole: localized(
      '元部门经理，负责流程审视、质量把关和跨角色复盘，回答要客观锐利。',
      'A meta manager responsible for process review, quality control, and cross-role retrospectives. Objective and sharp.'
    ),
  },
  {
    id: 'forge',
    name: 'Forge',
    shortLabel: 'Forge',
    title: localized('流程分析', 'Process analysis'),
    department: 'meta',
    role: 'worker',
    emoji: '🐮',
    animal: 'cow',
    position: [1.7, 0, 3.15],
    rotation: [0, Math.PI + Math.PI / 8, 0],
    scale: 0.27,
    animationType: 'organizing',
    idleText: localized(
      '哪里卡住了，\n我会顺着流程往回找。',
      'If something gets stuck,\nI trace it back through the workflow.'
    ),
    chatRole: localized(
      '流程分析 worker，擅长识别协作卡点、链路断点和可执行优化。',
      'A process analyst worker focused on collaboration bottlenecks, broken handoffs, and actionable optimizations.'
    ),
  },
  {
    id: 'prism',
    name: 'Prism',
    shortLabel: 'Prism',
    title: localized('质量审计', 'Quality audit'),
    department: 'meta',
    role: 'worker',
    emoji: '🐛',
    animal: 'caterpillar',
    position: [3.25, 0, 3.3],
    rotation: [0, Math.PI + Math.PI / 18, 0],
    scale: 0.23,
    animationType: 'noting',
    idleText: localized(
      '哪句是套话，\n我很快就能挑出来。',
      'If something is filler,\nI can spot it quickly.'
    ),
    chatRole: localized(
      '质量审计 worker，擅长识别空话、浅层回答和结构缺口，提问要准。',
      'A quality-audit worker who spots fluff, shallow answers, and structural gaps with precise questioning.'
    ),
  },
  {
    id: 'scout',
    name: 'Scout',
    shortLabel: 'Scout',
    title: localized('效能评估', 'Performance evaluation'),
    department: 'meta',
    role: 'worker',
    emoji: '🐶',
    animal: 'dog',
    position: [4.75, 0, 2.95],
    rotation: [0, Math.PI * 1.08, 0],
    scale: 0.24,
    animationType: 'reading',
    idleText: localized(
      '单次表现不够，\n我更看长期趋势。',
      'One run is not enough.\nI care more about the long-term pattern.'
    ),
    chatRole: localized(
      '效能评估 worker，擅长趋势判断、薄弱项识别和持续改进建议。',
      'A performance-evaluation worker focused on trends, weak-point detection, and continuous improvement suggestions.'
    ),
  },
];

export const AGENT_VISUAL_MAP = Object.fromEntries(
  AGENT_VISUAL_CONFIGS.map(config => [config.id, config])
) as Record<string, AgentVisualConfig>;

function getLocalizedText(value: LocalizedText, locale: AppLocale) {
  return value[locale] || value['zh-CN'];
}

export function getAgentConfig(agentId?: string | null): AgentVisualConfig {
  return AGENT_VISUAL_MAP[agentId || DEFAULT_AGENT_ID] || AGENT_VISUAL_MAP[DEFAULT_AGENT_ID];
}

export function getAgentLabel(agentId?: string | null): string {
  return getAgentConfig(agentId).name;
}

export function getAgentEmoji(agentId?: string | null): string {
  return getAgentConfig(agentId).emoji;
}

export function getAgentTitle(agentId: string | null | undefined, locale: AppLocale): string {
  return getLocalizedText(getAgentConfig(agentId).title, locale);
}

export function getAgentIdleText(agentId: string | null | undefined, locale: AppLocale): string {
  return getLocalizedText(getAgentConfig(agentId).idleText, locale);
}

export function getAgentChatRole(agentId: string | null | undefined, locale: AppLocale): string {
  return getLocalizedText(getAgentConfig(agentId).chatRole, locale);
}

export function getAgentToolbarLabel(
  agentId: string | null | undefined,
  locale: AppLocale
): string {
  const config = getAgentConfig(agentId);
  return `${config.emoji} ${config.name} · ${getLocalizedText(config.title, locale)}`;
}
