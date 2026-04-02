import { type ChangeEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  BookOpenText,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Download,
  FileText,
  History,
  Loader2,
  Monitor,
  Network,
  Paperclip,
  PanelRight,
  Search,
  Send,
  Server,
  Shield,
  Star,
  X,
  Zap,
} from 'lucide-react';

import { ExportDialog } from '@/components/ExportDialog';
import { SkillCard, type SkillCardData } from '@/components/SkillCard';
import { ReputationBadge } from '@/components/reputation/ReputationBadge';
import { ReputationRadar } from '@/components/reputation/ReputationRadar';
import { ReputationHistory } from '@/components/reputation/ReputationHistory';
import { useReputationStore } from '@/lib/reputation-store';
import { useViewportTier } from '@/hooks/useViewportTier';
import { useI18n } from '@/i18n';
import { prepareWorkflowAttachments } from '@/lib/workflow-attachments';
import { CAN_USE_ADVANCED_RUNTIME } from '@/lib/deploy-target';
import { useAppStore } from '@/lib/store';
import {
  useWorkflowStore,
  type AgentInfo,
  type AgentMemoryEntry,
  type HeartbeatReportInfo,
  type MessageInfo,
  type PanelView,
  type StageInfo,
  type TaskInfo,
  type WorkflowInputAttachment,
  type WorkflowInfo,
  type WorkflowOrganizationNode,
  type WorkflowOrganizationSnapshot,
} from '@/lib/workflow-store';
import { useRoleStore } from '@/lib/role-store';
import { getRoleColor } from '@/components/AgentRolePanel';
import {
  MAX_WORKFLOW_ATTACHMENTS,
  normalizeWorkflowAttachments,
} from '@shared/workflow-input';
import { useDemoStore } from '@/lib/demo-store';
import { useDemoMode } from '@/hooks/useDemoMode';
import { MemoryTimeline } from '@/components/demo/MemoryTimeline';
import { EvolutionScoreCard } from '@/components/demo/EvolutionScoreCard';
import { SessionHistoryTab } from '@/components/SessionHistoryTab';

const wfBadge: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  completed_with_errors: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
};

const taskBadge: Record<string, string> = {
  assigned: 'bg-slate-100 text-slate-700',
  executing: 'bg-blue-100 text-blue-700',
  submitted: 'bg-violet-100 text-violet-700',
  reviewed: 'bg-emerald-100 text-emerald-700',
  audited: 'bg-amber-100 text-amber-700',
  revising: 'bg-orange-100 text-orange-700',
  verified: 'bg-teal-100 text-teal-700',
  passed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
};

const hbBadge: Record<string, string> = {
  idle: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-700',
  running: 'bg-cyan-100 text-cyan-700',
  error: 'bg-red-100 text-red-700',
};

function t(locale: string, zh: string, en: string) {
  return locale === 'zh-CN' ? zh : en;
}

function formatAttachmentSize(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${size} B`;
}

function getAttachmentStatusLabel(
  locale: string,
  attachment: WorkflowInputAttachment
) {
  if (attachment.excerptStatus === 'metadata_only') {
    return t(locale, '仅导入元数据', 'Metadata only');
  }

  if (attachment.excerptStatus === 'truncated') {
    return t(locale, '全文已导入，预览已截断', 'Full content imported, preview truncated');
  }

  return t(locale, '全文已导入', 'Full content imported');
}

function useFmt() {
  const locale = useAppStore(state => state.locale);
  const { copy } = useI18n();
  return (value: string | null | undefined) =>
    value
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
      : copy.common.unavailable;
}

function getDynamicStageLabel(locale: string, stageId: string, fallback: string) {
  const labels: Record<string, { zh: string; en: string }> = {
    direction: { zh: '任务解构', en: 'Task Framing' },
    planning: { zh: '组织生成', en: 'Org Assembly' },
    execution: { zh: '并行执行', en: 'Parallel Run' },
    review: { zh: '主管复核', en: 'Manager Review' },
    meta_audit: { zh: '质量审视', en: 'Quality Audit' },
    revision: { zh: '修订回合', en: 'Revision Loop' },
    verify: { zh: '结果确认', en: 'Verification' },
    summary: { zh: '部门汇总', en: 'Department Summary' },
    feedback: { zh: '总负责人总结', en: 'Lead Feedback' },
    evolution: { zh: '经验沉淀', en: 'Knowledge Update' },
  };

  const next = labels[stageId];
  if (!next) return fallback;
  return locale === 'zh-CN' ? next.zh : next.en;
}

function getDirectiveNarrative(locale: string) {
  return {
    sectionDescription:
      locale === 'zh-CN'
        ? '输入一个目标后，系统会先分析任务需要哪些角色，再临时组建组织、装配 skills 和 MCP，然后分工执行。'
        : 'After you enter a goal, the system first decides which roles are needed, then assembles a temporary organization with skills and MCP before execution.',
    modeNote:
      locale === 'zh-CN'
        ? '右侧面板现在展示的是“按需组队”逻辑：先判断要不要新建部门，再决定每个节点该带什么能力和工具。'
        : 'This panel now reflects an on-demand teaming flow: it first decides whether to create new departments, then assigns the right capabilities and tools to each node.',
    stepsTitle: locale === 'zh-CN' ? '动态组队工作流' : 'Dynamic Teaming Flow',
    steps:
      locale === 'zh-CN'
        ? [
            ['1. 解析问题', '先识别任务类型、复杂度、风险和需要覆盖的专业面。'],
            ['2. 生成组织', '按这次任务临时创建 CEO / manager / worker 结构，而不是套固定编制。'],
            ['3. 装配能力', '给每个节点挂上合适的 skills、MCP、模型和并发策略。'],
            ['4. 下发方向', '总负责人把任务拆成各部门目标和边界。'],
            ['5. 并行执行', '可并行的角色同时开工，只在关键依赖处串联。'],
            ['6. 主管复核', 'manager 汇总 worker 结果，检查完整性和可执行性。'],
            ['7. 质量审视', '对边界越界、证据不足、格式偏差做统一审视。'],
            ['8. 修订确认', '需要返工的节点进入修订回合，直到达到可交付标准。'],
            ['9. 汇总交付', '部门先汇总，再由总负责人产出最终结论和建议。'],
            ['10. 沉淀复用', '把这次组织和经验写入记忆，方便后续任务复用。'],
          ]
        : [
            ['1. Parse the ask', 'Identify task type, complexity, risk, and the expertise that is actually needed.'],
            ['2. Assemble the org', 'Create a temporary CEO / manager / worker structure for this task instead of reusing fixed staffing.'],
            ['3. Attach capabilities', 'Bind the right skills, MCP tools, model choices, and concurrency settings to each node.'],
            ['4. Set direction', 'The lead turns the ask into department goals and explicit boundaries.'],
            ['5. Run in parallel', 'Independent roles work simultaneously and only serialize on real dependencies.'],
            ['6. Manager review', 'Managers consolidate worker output and check completeness and actionability.'],
            ['7. Audit quality', 'Review boundary drift, weak evidence, and output quality across the org.'],
            ['8. Revise and confirm', 'Nodes that need rework go through another pass until they are deliverable.'],
            ['9. Deliver the result', 'Departments summarize first, then the lead produces the final answer and recommendation.'],
            ['10. Reuse the learning', 'Store the organization pattern and lessons so later workflows can build on them.'],
          ],
  };
}

function getFrontendWorkflowBanner(locale: string, canUseAdvanced: boolean) {
  if (locale === 'zh-CN') {
    return canUseAdvanced
      ? '当前是浏览器预演视图：你可以先看系统如何理解任务、准备动态组织和展示链路，切到高级模式后才会真正创建临时团队并执行。'
      : '当前部署是静态预览版：保留了动态组队的界面表达和流程视图，但不会连接服务端执行真实工作流。';
  }

  return canUseAdvanced
    ? 'You are in the browser preview layer: it shows how the system interprets the task and prepares a dynamic org, but the real temporary team is only created in Advanced Mode.'
    : 'This deployment is a static preview: it keeps the dynamic teaming UI and flow visuals, but does not connect to the server to run a real workflow.';
}

function Section({ title, description }: { title: string; description?: string }) {
  return (
    <div className="border-b border-[#F0E8E0] px-4 py-3">
      <h3 className="text-sm font-bold text-[#3A2A1A]">{title}</h3>
      {description ? <p className="mt-0.5 text-[10px] leading-5 text-[#8B7355]">{description}</p> : null}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <Network className="mb-3 h-10 w-10 text-[#C4B5A0]" />
      <p className="text-sm font-medium text-[#5A4A3A]">{title}</p>
      <p className="mt-1 text-[10px] text-[#8B7355]">{description}</p>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-white/85 px-2 py-0.5 text-[8px] font-medium text-[#6B5A4A]">
      {children}
    </span>
  );
}

function StageBar({ stages, current }: { stages: StageInfo[]; current: string | null }) {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const idx = stages.findIndex(stage => stage.id === current);
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {stages.map((stage, i) => {
        const active = stage.id === current;
        const done = idx >= 0 && i < idx;
        const fallbackLabel = copy.workflow.stages[stage.id as keyof typeof copy.workflow.stages] || stage.label;
        const label = getDynamicStageLabel(locale, stage.id, fallbackLabel);
        return (
          <div
            key={stage.id}
            className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${
              done ? 'bg-emerald-100 text-emerald-700' : active ? 'bg-blue-100 text-blue-700' : 'bg-[#F5EFE8] text-[#8B7355]'
            }`}
          >
            {label}
          </div>
        );
      })}
    </div>
  );
}

function getOrganization(
  workflow: WorkflowInfo | null | undefined
): WorkflowOrganizationSnapshot | null {
  const organization = workflow?.results?.organization;
  if (!organization || typeof organization !== 'object') return null;
  return Array.isArray((organization as WorkflowOrganizationSnapshot).nodes)
    ? (organization as WorkflowOrganizationSnapshot)
    : null;
}

function getNodeMap(organization: WorkflowOrganizationSnapshot | null) {
  return new Map(organization?.nodes.map(node => [node.agentId, node]) || []);
}

function getNodeName(
  agentId: string,
  nodeMap: Map<string, WorkflowOrganizationNode>,
  fallback?: string
) {
  return nodeMap.get(agentId)?.name || fallback || agentId;
}

function agentStatusLabel(
  copy: ReturnType<typeof useI18n>['copy'],
  status: string | null | undefined
) {
  if (!status) return copy.workflow.statuses.agent.idle;
  return (
    copy.workflow.statuses.agent[
      status as keyof typeof copy.workflow.statuses.agent
    ] || status
  );
}

function taskStatusIcon(status: string) {
  switch (status) {
    case 'assigned':
      return <Clock className="h-3.5 w-3.5 text-slate-500" />;
    case 'executing':
    case 'revising':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
    case 'submitted':
    case 'passed':
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case 'reviewed':
      return <Star className="h-3.5 w-3.5 text-amber-500" />;
    case 'audited':
      return <Shield className="h-3.5 w-3.5 text-orange-500" />;
    case 'failed':
      return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-slate-400" />;
  }
}

type RoleProgressStatus = 'blocked' | 'active' | 'review' | 'done' | 'idle';

function summarizeText(value: string | null | undefined, fallback: string, maxLength = 72) {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trimEnd()}...` : normalized;
}

function getTaskPrimaryText(task: TaskInfo) {
  return task.deliverable_v3 || task.deliverable_v2 || task.deliverable || '';
}

function getTaskDetailBlocks(task: TaskInfo) {
  const blocks: Array<{ key: string; label: string; content: string | null }> = [
    { key: 'deliverable', label: 'Deliverable', content: getTaskPrimaryText(task) },
    { key: 'manager_feedback', label: 'Manager feedback', content: task.manager_feedback },
    { key: 'meta_audit_feedback', label: 'Audit feedback', content: task.meta_audit_feedback },
  ];

  return blocks.filter(block => block.content && block.content.trim().length > 0);
}

function getTaskRank(status: string) {
  const rank: Record<string, number> = {
    executing: 0,
    revising: 0,
    submitted: 1,
    reviewed: 2,
    audited: 2,
    assigned: 3,
    verified: 4,
    passed: 4,
    failed: 5,
  };

  return rank[status] ?? 6;
}

function getRoleSummaryStatus(tasks: TaskInfo[]): RoleProgressStatus {
  const statuses = tasks.map(task => task.status);

  if (statuses.some(status => status === 'failed' || status === 'revising')) {
    return 'blocked';
  }
  if (statuses.some(status => status === 'executing')) {
    return 'active';
  }
  if (statuses.some(status => status === 'submitted' || status === 'reviewed' || status === 'audited')) {
    return 'review';
  }
  if (statuses.every(status => status === 'verified' || status === 'passed')) {
    return 'done';
  }

  return 'idle';
}

function getRoleStatusLabel(locale: string, status: RoleProgressStatus) {
  switch (status) {
    case 'blocked':
      return t(locale, '返工 / 阻塞', 'Blocked / revising');
    case 'active':
      return t(locale, '执行中', 'In progress');
    case 'review':
      return t(locale, '等待评审', 'Awaiting review');
    case 'done':
      return t(locale, '已完成', 'Completed');
    default:
      return t(locale, '待命', 'Idle');
  }
}

function getRoleStatusClass(status: RoleProgressStatus) {
  switch (status) {
    case 'blocked':
      return 'bg-amber-100 text-amber-800';
    case 'active':
      return 'bg-blue-100 text-blue-700';
    case 'review':
      return 'bg-violet-100 text-violet-700';
    case 'done':
      return 'bg-emerald-100 text-emerald-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function getTaskCompletedCount(tasks: TaskInfo[]) {
  return tasks.filter(task => task.status === 'verified' || task.status === 'passed').length;
}

function getLatestRoleTimestamp(messages: MessageInfo[], roleId: string) {
  const related = messages
    .filter(message => message.from_agent === roleId || message.to_agent === roleId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return related[0]?.created_at || null;
}

function getLatestRoleMessages(messages: MessageInfo[], roleId: string, limit = 3) {
  return messages
    .filter(message => message.from_agent === roleId || message.to_agent === roleId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);
}

function getMemoryTypeLabel(
  copy: ReturnType<typeof useI18n>['copy'],
  type: AgentMemoryEntry['type']
) {
  return (
    copy.workflow.statuses.memoryType[
      type as keyof typeof copy.workflow.statuses.memoryType
    ] || type
  );
}

function DirectiveView() {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const setRuntimeMode = useAppStore(state => state.setRuntimeMode);
  const { submitDirective, isSubmitting } = useWorkflowStore();
  const [directive, setDirective] = useState('');
  const [attachments, setAttachments] = useState<WorkflowInputAttachment[]>([]);
  const [isPreparingFiles, setIsPreparingFiles] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isFrontend = runtimeMode === 'frontend';
  const canUpgrade = isFrontend && CAN_USE_ADVANCED_RUNTIME;
  const narrative = useMemo(() => getDirectiveNarrative(locale), [locale]);

  const handleSubmit = async () => {
    if (!directive.trim() || isSubmitting || isPreparingFiles) return;
    if (canUpgrade) {
      await setRuntimeMode('advanced');
      return;
    }
    await submitDirective({ directive: directive.trim(), attachments });
    setDirective('');
    setAttachments([]);
    setAttachmentError(null);
  };

  const handlePickFiles = () => {
    fileInputRef.current?.click();
  };

  const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(event.target.files || []);
    event.target.value = '';
    if (fileList.length === 0) return;

    setAttachmentError(null);
    setIsPreparingFiles(true);

    try {
      const prepared = await prepareWorkflowAttachments(fileList);
      let overflowed = false;
      setAttachments(prev => {
        const seen = new Set(prev.map(item => `${item.name}:${item.size}:${item.mimeType}`));
        const next = [...prev];
        for (const item of prepared) {
          const key = `${item.name}:${item.size}:${item.mimeType}`;
          if (seen.has(key)) continue;
          if (next.length >= MAX_WORKFLOW_ATTACHMENTS) {
            overflowed = true;
            break;
          }
          next.push(item);
          seen.add(key);
        }
        return next;
      });

      if (overflowed) {
        setAttachmentError(
          t(
            locale,
            `最多附带 ${MAX_WORKFLOW_ATTACHMENTS} 个文件，其余文件已忽略。`,
            `You can attach up to ${MAX_WORKFLOW_ATTACHMENTS} files. Extra files were ignored.`
          )
        );
      }
    } catch (error) {
      console.error('[WorkflowPanel] Failed to prepare attachments:', error);
      setAttachmentError(
        t(
          locale,
          '文件读取失败，请重试或换成 txt / md / json / csv 等文本格式。',
          'Failed to read the selected files. Try again or use a text-based format such as txt, md, json, or csv.'
        )
      );
    } finally {
      setIsPreparingFiles(false);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(item => item.id !== id));
  };

  return (
    <div className="flex h-full flex-col">
      <Section title={copy.workflow.directive.title} description={narrative.sectionDescription} />
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isFrontend ? (
          <div className="mb-4 rounded-2xl border border-[#E8DDD0] bg-gradient-to-br from-[#FFF7EC] to-[#F7EDE2] p-3 text-[11px] leading-5 text-[#6B5A4A]">
            <p className="font-bold text-[#3A2A1A]">
              {CAN_USE_ADVANCED_RUNTIME ? copy.workflow.directive.frontendTitle : copy.workflow.directive.pagesTitle}
            </p>
            <p className="mt-1">
              {CAN_USE_ADVANCED_RUNTIME ? copy.workflow.directive.frontendDescription : copy.workflow.directive.pagesDescription}
            </p>
            <p className="mt-2 rounded-xl bg-white/55 px-3 py-2 text-[10px] leading-5 text-[#7A624B]">
              {narrative.modeNote}
            </p>
          </div>
        ) : null}

        <p className="mb-2 text-[11px] font-semibold text-[#8B7355]">{copy.workflow.directive.examplesTitle}</p>
        <div className="space-y-2">
          {copy.workflow.directive.examples.map(example => (
            <button key={example} onClick={() => setDirective(example)} className="w-full rounded-xl bg-[#F8F4F0] px-3 py-2 text-left text-xs text-[#5A4A3A] hover:bg-[#F0E8E0]">
              {example}
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-[#E8DDD0] bg-gradient-to-br from-[#F8F4F0] to-[#F0E8E0] p-3">
          <p className="mb-2 text-[11px] font-bold text-[#3A2A1A]">{narrative.stepsTitle}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {narrative.steps.map(([step, desc]) => (
              <div key={step} className="rounded-xl bg-white/60 px-3 py-2 text-[11px] text-[#5A4A3A]">
                <p className="font-semibold text-[#D4845A]">{step}</p>
                <p className="mt-1">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-[#F0E8E0] p-4">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={event => {
            void handleFilesSelected(event);
          }}
        />

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold text-[#8B7355]">
              {t(locale, '补充参考文件', 'Add reference files')}
            </p>
            <p className="text-[10px] leading-5 text-[#B08F72]">
              {t(
                locale,
                '支持文字指令 + 附件一起提交。txt / md / json / PDF / Word / Excel / 图片都会尽量提取摘要，图片会尝试 OCR。',
                'You can submit text instructions together with attachments. txt / md / json / PDF / Word / Excel / images are parsed when possible, and images attempt OCR.'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={handlePickFiles}
            disabled={isPreparingFiles || attachments.length >= MAX_WORKFLOW_ATTACHMENTS}
            className="inline-flex items-center gap-2 rounded-xl border border-[#E8DDD0] bg-[#F8F4F0] px-3 py-2 text-xs font-semibold text-[#6B5A4A] transition-colors hover:bg-[#F0E8E0] disabled:opacity-40"
          >
            {isPreparingFiles ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
            <span>{t(locale, '添加文件', 'Add files')}</span>
          </button>
        </div>

        {attachments.length > 0 ? (
          <div className="mb-3 space-y-2 rounded-2xl border border-[#E8DDD0] bg-[#F8F4F0] p-3">
            {attachments.map(attachment => (
              <div key={attachment.id} className="rounded-xl bg-white/90 px-3 py-2 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-[#3A2A1A]">{attachment.name}</p>
                    <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-[#8B7355]">
                      <span>{formatAttachmentSize(attachment.size)}</span>
                      <span>{attachment.mimeType || 'application/octet-stream'}</span>
                      <span>
                        {attachment.excerptStatus === 'metadata_only'
                          ? t(locale, '仅元数据', 'Metadata only')
                          : attachment.excerptStatus === 'truncated'
                            ? t(locale, '已截断摘要', 'Excerpt truncated')
                            : t(locale, '已提取摘要', 'Excerpt parsed')}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    className="rounded-lg p-1 text-[#A58971] transition-colors hover:bg-[#F4E8DE] hover:text-[#6B5A4A]"
                    title={t(locale, '移除附件', 'Remove attachment')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[10px] leading-5 text-[#7A624B]">
                  {attachment.excerpt}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {attachmentError ? (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-5 text-amber-700">
            {attachmentError}
          </div>
        ) : null}

        <textarea
          value={directive}
          onChange={e => setDirective(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder={copy.workflow.directive.placeholder}
          rows={3}
          className="w-full resize-none rounded-xl border border-[#F0E8E0] bg-[#F8F4F0] px-3 py-2 text-sm text-[#3A2A1A] placeholder:text-[#C4B5A0] focus:border-[#D4845A]/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#D4845A]/20"
        />
        <button onClick={() => void handleSubmit()} disabled={!directive.trim() || isSubmitting || isPreparingFiles} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#D4845A] to-[#E4946A] px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-40">
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : canUpgrade ? <Server className="h-4 w-4" /> : isFrontend ? <Monitor className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          <span>{isSubmitting ? copy.workflow.directive.submitting : canUpgrade ? copy.workflow.directive.switchCta : isFrontend ? copy.workflow.directive.previewCta : copy.workflow.directive.submit}</span>
        </button>
      </div>
    </div>
  );
}

function OrgView() {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const {
    agents,
    agentStatuses,
    currentWorkflow,
    setActiveView,
    setSelectedMemoryAgent,
  } = useWorkflowStore();
  const fmt = useFmt();
  const organization = getOrganization(currentWorkflow);
  const openMemory = (id: string) => {
    setSelectedMemoryAgent(id);
    setActiveView('memory');
  };

  if (organization) {
    const rootNode =
      organization.nodes.find(node => node.id === organization.rootNodeId) || null;

    return (
      <div className="flex h-full flex-col">
        <Section title={copy.workflow.org.title} description={copy.workflow.org.description} />
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-4 rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-slate-50 p-4">
            <div className="flex flex-wrap gap-2">
              <Pill>{organization.source}</Pill>
              <Pill>{organization.taskProfile}</Pill>
              <Pill>{fmt(organization.generatedAt)}</Pill>
              <Pill>{organization.nodes.length} {t(locale, '节点', 'nodes')}</Pill>
              <Pill>{organization.departments.length} {t(locale, '部门', 'departments')}</Pill>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-indigo-900">{organization.reasoning}</p>
            {currentWorkflow?.results?.organization_debug?.logPath ? (
              <p className="mt-2 break-all text-[10px] text-indigo-700">
                {t(locale, '回放日志', 'Replay log')}: {currentWorkflow.results.organization_debug.logPath}
              </p>
            ) : null}
          </div>

          {rootNode ? (
            <button
              onClick={() => openMemory(rootNode.agentId)}
              className="mb-4 w-full rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4 text-left"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-amber-900">{rootNode.name}</span>
                <Pill>{rootNode.title}</Pill>
                <Pill>{agentStatusLabel(copy, agentStatuses[rootNode.agentId] || 'idle')}</Pill>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-amber-800">{rootNode.responsibility}</p>
            </button>
          ) : null}

          <div className="space-y-3">
            {organization.departments.map(department => {
              const manager =
                organization.nodes.find(node => node.id === department.managerNodeId) || null;
              const workers = organization.nodes.filter(
                node => node.parentId === department.managerNodeId
              );

              return (
                <div key={department.id} className="rounded-2xl border border-[#E8DDD0] bg-white/78 p-3">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-[#3A2A1A]">{department.label}</span>
                    <Pill>{department.strategy}</Pill>
                    <Pill>{t(locale, '并发', 'concurrency')} {department.maxConcurrency}</Pill>
                  </div>

                  {manager ? (
                    <button
                      onClick={() => openMemory(manager.agentId)}
                      className="w-full rounded-xl bg-[#F8F4F0] p-3 text-left hover:bg-[#F0E8E0]"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-[#3A2A1A]">{manager.name}</span>
                        <Pill>{manager.title}</Pill>
                        <Pill>{manager.execution.strategy}</Pill>
                      </div>
                      <p className="mt-2 text-[10px] leading-5 text-[#6B5A4A]">{manager.responsibility}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {manager.skills.map(skill => (
                          <Pill key={skill.id}>{t(locale, '技能', 'Skill')}: {skill.name}</Pill>
                        ))}
                        {manager.mcp.map(binding => (
                          <Pill key={binding.id}>MCP: {binding.name}</Pill>
                        ))}
                      </div>
                    </button>
                  ) : null}

                  <div className="mt-3 space-y-2">
                    {workers.map(worker => (
                      <button
                        key={worker.id}
                        onClick={() => openMemory(worker.agentId)}
                        className="w-full rounded-xl border border-[#E8DDD0] bg-white p-3 text-left hover:bg-[#F8F4F0]"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[12px] font-semibold text-[#3A2A1A]">{worker.name}</span>
                          <Pill>{worker.title}</Pill>
                          <Pill>{worker.execution.mode}</Pill>
                        </div>
                        <p className="mt-1 text-[10px] leading-5 text-[#6B5A4A]">{worker.responsibility}</p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {worker.skills.map(skill => (
                            <Pill key={skill.id}>{t(locale, '技能', 'Skill')}: {skill.name}</Pill>
                          ))}
                          {worker.mcp.map(binding => (
                            <Pill key={binding.id}>MCP: {binding.name}</Pill>
                          ))}
                        </div>
                        {worker.skills.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {worker.skills.map(skill => (
                              <SkillCard
                                key={skill.id}
                                skill={{
                                  id: skill.id,
                                  name: skill.name,
                                  summary: skill.summary || '',
                                  prompt: skill.prompt,
                                } as SkillCardData}
                              />
                            ))}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const ceo = agents.find(a => a.role === 'ceo');
  const managers = agents.filter(a => a.role === 'manager');

  return (
    <div className="flex h-full flex-col">
      <Section title={copy.workflow.org.title} description={copy.workflow.org.description} />
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {ceo ? (
          <button onClick={() => openMemory(ceo.id)} className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-3 py-3 text-left">
            <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-amber-800">{ceo.name}</p>
              <p className="text-[10px] text-amber-700">{agentStatusLabel(copy, agentStatuses[ceo.id] || 'idle')}</p>
            </div>
          </button>
        ) : null}

        <div className="space-y-3">
          {managers.map(manager => {
            const dept = copy.workflow.departments[manager.department as keyof typeof copy.workflow.departments] || manager.department;
            const workers = agents.filter(agent => agent.managerId === manager.id && agent.role === 'worker');
            return (
              <div key={manager.id} className="rounded-2xl border border-[#E8DDD0] bg-white/72 p-3">
                <button onClick={() => openMemory(manager.id)} className="flex w-full items-center gap-3 rounded-xl bg-[#F8F4F0] px-3 py-2 text-left hover:bg-[#F0E8E0]">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-[11px] font-bold text-[#8B7355]">{dept.slice(0, 2).toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-[#3A2A1A]">{dept}</p>
                    <p className="truncate text-[10px] text-[#8B7355]">{manager.name}</p>
                  </div>
                  <span className="text-[10px] text-[#8B7355]">{copy.workflow.org.viewMemory}</span>
                </button>
                <div className="mt-2 space-y-2">
                  {workers.map(worker => (
                    <button key={worker.id} onClick={() => openMemory(worker.id)} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-[#F8F4F0]">
                      <div className="h-2 w-2 rounded-full bg-[#D4845A]" />
                      <span className="flex-1 truncate text-[11px] text-[#5A4A3A]">{worker.name}</span>
                      <span className="text-[10px] text-[#B0A090]">{agentStatusLabel(copy, agentStatuses[worker.id] || 'idle')}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProgressViewLegacy() {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const fmt = useFmt();
  const { currentWorkflow, tasks, messages, stages, downloadWorkflowReport, downloadDepartmentReport } = useWorkflowStore();
  const organization = getOrganization(currentWorkflow);
  const attachments = useMemo(
    () => normalizeWorkflowAttachments(currentWorkflow?.results?.input?.attachments),
    [currentWorkflow]
  );
  const nodeMap = useMemo(() => getNodeMap(organization), [organization]);
  const grouped = Object.entries(
    tasks.reduce<Record<string, TaskInfo[]>>((acc, task) => {
      (acc[task.department] ||= []).push(task);
      return acc;
    }, {})
  );
  const [exportOpen, setExportOpen] = useState(false);
  const canExport = currentWorkflow?.status === 'completed' || currentWorkflow?.status === 'completed_with_errors';

  if (!currentWorkflow) {
    return <EmptyState title={copy.workflow.progress.emptyTitle} description={copy.workflow.progress.emptyDescription} />;
  }

  return (
    <div className="flex h-full flex-col">
      <Section title={copy.workflow.progress.overview} />
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <div className="rounded-2xl border border-[#E8DDD0] bg-white/80 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[#3A2A1A]">{currentWorkflow.directive}</p>
              <p className="mt-2 text-[11px] text-[#8B7355]">{copy.workflow.progress.startedAt}: {fmt(currentWorkflow.started_at || currentWorkflow.created_at)}</p>
              <p className="mt-1 text-[11px] text-[#8B7355]">{copy.workflow.progress.currentStage}: {getDynamicStageLabel(locale, currentWorkflow.current_stage || 'direction', copy.workflow.stages[(currentWorkflow.current_stage || 'direction') as keyof typeof copy.workflow.stages] || currentWorkflow.current_stage || copy.common.unavailable)}</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-[10px] font-semibold ${wfBadge[currentWorkflow.status] || wfBadge.pending}`}>
              {copy.workflow.statuses.workflow[currentWorkflow.status as keyof typeof copy.workflow.statuses.workflow] || currentWorkflow.status}
            </span>
          </div>
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold text-[#8B7355]">{copy.workflow.progress.stageProgress}</p>
            <StageBar stages={stages} current={currentWorkflow.current_stage} />
          </div>
          {attachments.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-[#E8DDD0] bg-[#F8F4F0] p-3">
              <p className="text-[11px] font-semibold text-[#8B7355]">
                {t(locale, '参考文件', 'Reference files')} · {attachments.length}
              </p>
              <div className="mt-2 space-y-2">
                {attachments.map(attachment => (
                  <div key={attachment.id} className="rounded-xl bg-white/85 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold text-[#3A2A1A]">{attachment.name}</p>
                      <div className="flex flex-wrap gap-2 text-[9px] text-[#8B7355]">
                        <Pill>{formatAttachmentSize(attachment.size)}</Pill>
                        <Pill>{getAttachmentStatusLabel(locale, attachment)}</Pill>
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[10px] leading-5 text-[#7A624B]">{attachment.excerpt}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {organization ? (
            <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50/80 p-3">
              <div className="flex flex-wrap gap-2">
                <Pill>{organization.source}</Pill>
                <Pill>{organization.taskProfile}</Pill>
                <Pill>{organization.nodes.length} {t(locale, '节点', 'nodes')}</Pill>
                <Pill>{organization.departments.length} {t(locale, '部门', 'departments')}</Pill>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-indigo-900">{organization.reasoning}</p>
            </div>
          ) : null}
          {currentWorkflow.status === 'failed' ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-[11px] text-red-700">
              {currentWorkflow.results?.last_error || copy.common.unavailable}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => void downloadWorkflowReport(currentWorkflow.id, 'json')} className="inline-flex items-center gap-1 rounded-xl bg-[#F0E8E0] px-3 py-2 text-xs font-semibold text-[#5B4837]"><Download className="h-3.5 w-3.5" />{copy.workflow.progress.workflowReport} · {copy.common.json}</button>
            <button onClick={() => void downloadWorkflowReport(currentWorkflow.id, 'md')} className="inline-flex items-center gap-1 rounded-xl bg-[#F0E8E0] px-3 py-2 text-xs font-semibold text-[#5B4837]"><Download className="h-3.5 w-3.5" />{copy.workflow.progress.workflowReport} · {copy.common.markdown}</button>
            {canExport ? (
              <button onClick={() => setExportOpen(true)} className="inline-flex items-center gap-1 rounded-xl bg-[#F0E8E0] px-3 py-2 text-xs font-semibold text-[#5B4837]"><Download className="h-3.5 w-3.5" />{t(locale, '导出到其他框架', 'Export to Other Frameworks')}</button>
            ) : null}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold text-[#8B7355]">{copy.workflow.progress.tasks}</p>
          {grouped.length === 0 ? <div className="rounded-2xl bg-[#F8F4F0] px-4 py-6 text-center text-[11px] text-[#8B7355]">{copy.workflow.progress.noTasks}</div> : <div className="space-y-3">{grouped.map(([department, items]) => <div key={department} className="rounded-2xl border border-[#E8DDD0] bg-white/78 p-3"><div className="mb-2 flex items-center justify-between gap-3"><h4 className="text-sm font-semibold text-[#3A2A1A]">{copy.workflow.departments[department as keyof typeof copy.workflow.departments] || department}</h4>{items[0]?.manager_id ? <button onClick={() => void downloadDepartmentReport(currentWorkflow.id, items[0].manager_id, 'md')} className="inline-flex items-center gap-1 rounded-lg bg-[#F0E8E0] px-2.5 py-1 text-[10px] font-semibold text-[#5B4837]"><Download className="h-3 w-3" />{copy.workflow.progress.departmentReport}</button> : null}</div><div className="space-y-2">{items.map(task => <div key={task.id} className="rounded-xl bg-[#F8F4F0] p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><div className="flex items-center gap-2">{taskStatusIcon(task.status)}<p className="flex-1 text-[12px] font-medium text-[#3A2A1A]">{task.description}</p></div><p className="mt-1 text-[10px] text-[#8B7355]">{t(locale, '执行者', 'Worker')}: {getNodeName(task.worker_id, nodeMap)}</p></div><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${taskBadge[task.status] || taskBadge.assigned}`}>{copy.workflow.statuses.task[task.status as keyof typeof copy.workflow.statuses.task] || task.status}</span></div>{task.deliverable_v3 || task.deliverable_v2 || task.deliverable ? <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-[#5A4A3A]">{task.deliverable_v3 || task.deliverable_v2 || task.deliverable}</p> : null}{task.total_score !== null ? <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[#8B7355]"><Pill>{copy.workflow.progress.score}: {task.total_score}/20</Pill><Pill>{t(locale, '版本', 'Version')} {task.version}</Pill></div> : null}</div>)}</div></div>)}</div>}
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold text-[#8B7355]">{copy.workflow.progress.messageFlow}</p>
          {messages.length === 0 ? <div className="rounded-2xl bg-[#F8F4F0] px-4 py-6 text-center text-[11px] text-[#8B7355]">{copy.workflow.progress.noMessages}</div> : <div className="space-y-2">{messages.slice(-10).map(message => <div key={message.id} className="rounded-xl border border-[#E8DDD0] bg-white/78 p-3"><div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#8B7355]"><span>{getNodeName(message.from_agent, nodeMap)} → {getNodeName(message.to_agent, nodeMap)}</span><span>{fmt(message.created_at)}</span></div><p className="mt-1 text-[10px] text-[#B0A090]">{getDynamicStageLabel(locale, message.stage, copy.workflow.stages[message.stage as keyof typeof copy.workflow.stages] || message.stage)}</p><p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-[#5A4A3A]">{message.content}</p></div>)}</div>}
        </div>
      </div>
      {canExport ? <ExportDialog open={exportOpen} onOpenChange={setExportOpen} workflowId={currentWorkflow.id} /> : null}
    </div>
  );
}

function RoleSwitchTimeline() {
  const locale = useAppStore(state => state.locale);
  const agentRoles = useRoleStore(state => state.agentRoles);
  const fmt = useFmt();

  const allSwitches = Array.from(agentRoles.entries()).flatMap(([agentId, info]) =>
    info.roleHistory.map(entry => ({ agentId, ...entry }))
  ).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 20);

  if (allSwitches.length === 0) return null;

  return (
    <div className="rounded-2xl border border-[#E8DDD0] bg-white/82 p-3">
      <div className="mb-3 flex items-center gap-2">
        <Shield className="h-4 w-4 text-[#B08F72]" />
        <div>
          <p className="text-sm font-semibold text-[#3A2A1A]">{t(locale, '角色切换时间轴', 'Role Switch Timeline')}</p>
          <p className="text-[10px] leading-5 text-[#8B7355]">
            {t(locale, '各 Agent 的角色切换事件，不同角色用不同颜色标注。', 'Role switch events per agent, color-coded by role.')}
          </p>
        </div>
      </div>
      <div className="space-y-1.5">
        {allSwitches.map((entry, i) => (
          <div key={`${entry.agentId}-${entry.timestamp}-${i}`} className="flex items-center gap-2 rounded-lg bg-[#F8F4F0] px-3 py-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: getRoleColor(entry.toRole) }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1 text-[11px]">
                <span className="font-semibold text-[#3A2A1A]">{entry.agentId}</span>
                <span className="text-[#8B7355]">:</span>
                <span
                  className="rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white"
                  style={{ backgroundColor: getRoleColor(entry.fromRole) }}
                >
                  {entry.fromRole || t(locale, '无', '—')}
                </span>
                <span className="text-[#B08F72]">→</span>
                <span
                  className="rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white"
                  style={{ backgroundColor: getRoleColor(entry.toRole) }}
                >
                  {entry.toRole || t(locale, '无', '—')}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-2 text-[9px] text-[#8B7355]">
                {entry.missionName ? <span>{entry.missionName}</span> : null}
                <span>{fmt(entry.timestamp)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgressView() {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const fmt = useFmt();
  const { currentWorkflow, tasks, messages, stages, downloadWorkflowReport, downloadDepartmentReport } = useWorkflowStore();
  const [expandedRoleKeys, setExpandedRoleKeys] = useState<string[]>([]);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [isContextOpen, setIsContextOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const organization = getOrganization(currentWorkflow);
  const canExport = currentWorkflow?.status === 'completed' || currentWorkflow?.status === 'completed_with_errors';
  const attachments = useMemo(
    () => normalizeWorkflowAttachments(currentWorkflow?.results?.input?.attachments),
    [currentWorkflow]
  );
  const nodeMap = useMemo(() => getNodeMap(organization), [organization]);

  useEffect(() => {
    setExpandedRoleKeys([]);
    setShowAllEvents(false);
    setIsContextOpen(false);
  }, [currentWorkflow?.id]);

  const progressState = useMemo(() => {
    const groupedByDepartment = Object.entries(
      tasks.reduce<Record<string, TaskInfo[]>>((acc, task) => {
        (acc[task.department] ||= []).push(task);
        return acc;
      }, {})
    );

    const departmentSummaries = groupedByDepartment
      .map(([department, items]) => {
        const managerId = items[0]?.manager_id || '';

        const buildRoleSummary = (
          roleId: string,
          roleKind: 'manager' | 'worker',
          roleTasks: TaskInfo[]
        ) => {
          const sortedTasks = [...roleTasks].sort(
            (a, b) => getTaskRank(a.status) - getTaskRank(b.status) || a.id - b.id
          );
          const focusTask = sortedTasks[0];
          const summarySource =
            getTaskPrimaryText(focusTask) ||
            focusTask.manager_feedback ||
            focusTask.meta_audit_feedback;

          return {
            key: `${roleKind}:${roleId}`,
            id: roleId,
            roleKind,
            name: getNodeName(roleId, nodeMap, roleId),
            status: getRoleSummaryStatus(sortedTasks),
            currentTask: summarizeText(
              focusTask?.description,
              t(locale, '等待分配任务', 'Waiting for assignment'),
              52
            ),
            summary: summarizeText(
              summarySource,
              t(locale, '暂无结果摘要', 'No summary yet'),
              78
            ),
            updatedAt:
              getLatestRoleTimestamp(messages, roleId) ||
              currentWorkflow?.started_at ||
              currentWorkflow?.created_at ||
              null,
            tasks: sortedTasks,
            messages: getLatestRoleMessages(messages, roleId, 3),
          };
        };

        const workerSummaries = Object.entries(
          items.reduce<Record<string, TaskInfo[]>>((acc, task) => {
            (acc[task.worker_id] ||= []).push(task);
            return acc;
          }, {})
        )
          .map(([workerId, workerTasks]) => buildRoleSummary(workerId, 'worker', workerTasks))
          .sort((a, b) => getTaskRank(a.tasks[0]?.status || '') - getTaskRank(b.tasks[0]?.status || ''));

        const managerSummary = managerId
          ? buildRoleSummary(managerId, 'manager', items)
          : null;

        return {
          department,
          managerId,
          completedTasks: getTaskCompletedCount(items),
          totalTasks: items.length,
          roles: managerSummary ? [managerSummary, ...workerSummaries] : workerSummaries,
        };
      })
      .sort((a, b) => {
        const aPriority = a.roles.some(role => role.status === 'blocked')
          ? 0
          : a.roles.some(role => role.status === 'active')
            ? 1
            : 2;
        const bPriority = b.roles.some(role => role.status === 'blocked')
          ? 0
          : b.roles.some(role => role.status === 'active')
            ? 1
            : 2;

        return aPriority - bPriority || a.department.localeCompare(b.department, locale);
      });

    const roleSummaries = departmentSummaries.flatMap(item => item.roles);

    return {
      departmentSummaries,
      roleSummaries,
      completedTasks: getTaskCompletedCount(tasks),
      blockedRoles: roleSummaries.filter(role => role.status === 'blocked'),
      activeRoles: roleSummaries.filter(role => role.status === 'active'),
      reviewRoles: roleSummaries.filter(role => role.status === 'review'),
      queuedTasks: tasks.filter(task => task.status === 'assigned').length,
      keyEvents: [...messages].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    };
  }, [currentWorkflow?.created_at, currentWorkflow?.started_at, locale, messages, nodeMap, tasks]);

  if (!currentWorkflow) {
    return <EmptyState title={copy.workflow.progress.emptyTitle} description={copy.workflow.progress.emptyDescription} />;
  }

  const currentStageLabel = getDynamicStageLabel(
    locale,
    currentWorkflow.current_stage || 'direction',
    copy.workflow.stages[(currentWorkflow.current_stage || 'direction') as keyof typeof copy.workflow.stages] ||
      currentWorkflow.current_stage ||
      copy.common.unavailable
  );
  const activeRoleNames =
    progressState.activeRoles.length > 0
      ? progressState.activeRoles.slice(0, 2).map(role => role.name).join(' / ')
      : t(locale, '当前无活跃角色', 'No active roles right now');
  const blockerSummary =
    progressState.blockedRoles.length > 0
      ? t(
          locale,
          `${progressState.blockedRoles.length} 个角色返工或阻塞`,
          `${progressState.blockedRoles.length} roles are blocked or revising`
        )
      : progressState.reviewRoles.length > 0
        ? t(
            locale,
            `${progressState.reviewRoles.length} 个角色等待评审`,
            `${progressState.reviewRoles.length} roles are awaiting review`
          )
        : progressState.queuedTasks > 0
          ? t(
              locale,
              `${progressState.queuedTasks} 个任务排队中`,
              `${progressState.queuedTasks} tasks are queued`
            )
          : t(locale, '当前无明显阻塞', 'No obvious blockers');
  const visibleEvents = showAllEvents
    ? progressState.keyEvents.slice(0, 10)
    : progressState.keyEvents.slice(0, 3);

  const toggleRole = (key: string) => {
    setExpandedRoleKeys(prev =>
      prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key]
    );
  };

  return (
    <div className="flex h-full flex-col">
      <Section
        title={copy.workflow.progress.overview}
        description={t(
          locale,
          '默认先看总进度，再看角色摘要；完整交付、反馈和消息都收进展开层。',
          'Start with the overall progress, then scan role summaries. Full details only open on demand.'
        )}
      />
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <div className="rounded-2xl border border-[#E8DDD0] bg-white/85 p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#B08F72]">
                {t(locale, '当前执行', 'Current run')}
              </p>
              <p className="mt-1 text-sm font-semibold leading-6 text-[#3A2A1A]">
                {summarizeText(currentWorkflow.directive, copy.common.unavailable, 120)}
              </p>
              <p className="mt-2 text-[11px] text-[#8B7355]">
                {copy.workflow.progress.startedAt}: {fmt(currentWorkflow.started_at || currentWorkflow.created_at)}
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-[10px] font-semibold ${wfBadge[currentWorkflow.status] || wfBadge.pending}`}>
              {copy.workflow.statuses.workflow[currentWorkflow.status as keyof typeof copy.workflow.statuses.workflow] || currentWorkflow.status}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-[#EEE1D3] bg-[#FFFCF8] p-3">
              <div className="flex items-center gap-2 text-[#8B7355]">
                <BarChart3 className="h-3.5 w-3.5" />
                <p className="text-[10px] font-semibold">{t(locale, '当前阶段', 'Current stage')}</p>
              </div>
              <p className="mt-2 text-[13px] font-semibold text-[#3A2A1A]">{currentStageLabel}</p>
            </div>
            <div className="rounded-2xl border border-[#EEE1D3] bg-[#FFFCF8] p-3">
              <div className="flex items-center gap-2 text-[#8B7355]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <p className="text-[10px] font-semibold">{t(locale, '总体进度', 'Overall progress')}</p>
              </div>
              <p className="mt-2 text-[13px] font-semibold text-[#3A2A1A]">
                {progressState.completedTasks} / {tasks.length || 0} {t(locale, '任务完成', 'tasks completed')}
              </p>
            </div>
            <div className="rounded-2xl border border-[#EEE1D3] bg-[#FFFCF8] p-3">
              <div className="flex items-center gap-2 text-[#8B7355]">
                <Zap className="h-3.5 w-3.5" />
                <p className="text-[10px] font-semibold">{t(locale, '当前活跃角色', 'Active roles')}</p>
              </div>
              <p className="mt-2 text-[13px] font-semibold text-[#3A2A1A]">{progressState.activeRoles.length}</p>
              <p className="mt-1 text-[10px] leading-5 text-[#8B7355]">{activeRoleNames}</p>
            </div>
            <div className="rounded-2xl border border-[#EEE1D3] bg-[#FFFCF8] p-3">
              <div className="flex items-center gap-2 text-[#8B7355]">
                <AlertTriangle className="h-3.5 w-3.5" />
                <p className="text-[10px] font-semibold">{t(locale, '阻塞与等待', 'Blockers')}</p>
              </div>
              <p className="mt-2 text-[13px] font-semibold text-[#3A2A1A]">{progressState.blockedRoles.length}</p>
              <p className="mt-1 text-[10px] leading-5 text-[#8B7355]">{blockerSummary}</p>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-[#8B7355]">{copy.workflow.progress.stageProgress}</p>
              <span className="text-[10px] text-[#B08F72]">
                {progressState.roleSummaries.length} {t(locale, '个角色摘要', 'role summaries')}
              </span>
            </div>
            <StageBar stages={stages} current={currentWorkflow.current_stage} />
          </div>

          {currentWorkflow.status === 'failed' ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-[11px] text-red-700">
              {currentWorkflow.results?.last_error || copy.common.unavailable}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => void downloadWorkflowReport(currentWorkflow.id, 'json')} className="inline-flex items-center gap-1 rounded-xl bg-[#F0E8E0] px-3 py-2 text-xs font-semibold text-[#5B4837]"><Download className="h-3.5 w-3.5" />{copy.workflow.progress.workflowReport} · {copy.common.json}</button>
            <button onClick={() => void downloadWorkflowReport(currentWorkflow.id, 'md')} className="inline-flex items-center gap-1 rounded-xl bg-[#F0E8E0] px-3 py-2 text-xs font-semibold text-[#5B4837]"><Download className="h-3.5 w-3.5" />{copy.workflow.progress.workflowReport} · {copy.common.markdown}</button>
            {canExport ? (
              <button onClick={() => setExportOpen(true)} className="inline-flex items-center gap-1 rounded-xl bg-[#F0E8E0] px-3 py-2 text-xs font-semibold text-[#5B4837]"><Download className="h-3.5 w-3.5" />{t(locale, '导出到其他框架', 'Export to Other Frameworks')}</button>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl border border-[#E8DDD0] bg-white/82 p-3">
          <div className="mb-3">
            <p className="text-sm font-semibold text-[#3A2A1A]">{t(locale, '角色执行摘要', 'Role execution summary')}</p>
            <p className="text-[10px] leading-5 text-[#8B7355]">
              {t(
                locale,
                '每个角色默认只显示一行摘要，点开后再看完整交付、反馈和相关事件。',
                'Each role stays compact by default. Open one to inspect the full deliverable, feedback, and related events.'
              )}
            </p>
          </div>

          {progressState.departmentSummaries.length === 0 ? (
            <div className="rounded-2xl bg-[#F8F4F0] px-4 py-6 text-center text-[11px] text-[#8B7355]">
              {copy.workflow.progress.noTasks}
            </div>
          ) : (
            <div className="space-y-3">
              {progressState.departmentSummaries.map(group => (
                <div key={group.department} className="rounded-2xl border border-[#EEE1D3] bg-[#FFFCF8] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#3A2A1A]">
                        {copy.workflow.departments[group.department as keyof typeof copy.workflow.departments] || group.department}
                      </p>
                      <p className="text-[10px] text-[#8B7355]">
                        {group.completedTasks} / {group.totalTasks} {t(locale, '任务完成', 'tasks completed')}
                      </p>
                    </div>
                    {group.managerId ? (
                      <button onClick={() => void downloadDepartmentReport(currentWorkflow.id, group.managerId, 'md')} className="inline-flex items-center gap-1 rounded-lg bg-[#F0E8E0] px-2.5 py-1 text-[10px] font-semibold text-[#5B4837]"><Download className="h-3 w-3" />{copy.workflow.progress.departmentReport}</button>
                    ) : null}
                  </div>

                  <div className="mt-3 space-y-2">
                    {group.roles.map(role => {
                      const isExpanded = expandedRoleKeys.includes(role.key);
                      return (
                        <div key={role.key} className="rounded-xl border border-[#E8DDD0] bg-white/90">
                          <button
                            type="button"
                            onClick={() => toggleRole(role.key)}
                            className="flex w-full items-start gap-3 px-3 py-3 text-left"
                          >
                            <div className="mt-0.5">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-[#B08F72]" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-[#B08F72]" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-[12px] font-semibold text-[#3A2A1A]">{role.name}</p>
                                <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${getRoleStatusClass(role.status)}`}>
                                  {getRoleStatusLabel(locale, role.status)}
                                </span>
                                <Pill>{role.roleKind === 'manager' ? t(locale, '经理', 'Manager') : t(locale, '执行者', 'Worker')}</Pill>
                              </div>
                              <p className="mt-1 text-[11px] font-medium text-[#5A4A3A]">{role.currentTask}</p>
                              <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-[#8B7355]">
                                <span>{t(locale, '最近更新', 'Latest update')}: {fmt(role.updatedAt)}</span>
                                <span>{role.tasks.length} {t(locale, '项任务', 'tasks')}</span>
                              </div>
                              <p className="mt-1 text-[10px] leading-5 text-[#8B7355]">{role.summary}</p>
                            </div>
                          </button>

                          {isExpanded ? (
                            <div className="border-t border-[#F0E8E0] bg-[#FFFCF8] px-3 py-3">
                              <div className="space-y-3">
                                {role.tasks.map(task => {
                                  const blocks = getTaskDetailBlocks(task);
                                  return (
                                    <div key={task.id} className="rounded-xl border border-[#EEE1D3] bg-white px-3 py-3">
                                      <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-center gap-2">
                                            {taskStatusIcon(task.status)}
                                            <p className="text-[12px] font-semibold text-[#3A2A1A]">{task.description}</p>
                                          </div>
                                          <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-[#8B7355]">
                                            <span>{t(locale, '执行者', 'Worker')}: {getNodeName(task.worker_id, nodeMap)}</span>
                                            <span>{t(locale, '版本', 'Version')} {task.version}</span>
                                            {task.total_score !== null ? <span>{copy.workflow.progress.score}: {task.total_score}/20</span> : null}
                                          </div>
                                        </div>
                                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${taskBadge[task.status] || taskBadge.assigned}`}>
                                          {copy.workflow.statuses.task[task.status as keyof typeof copy.workflow.statuses.task] || task.status}
                                        </span>
                                      </div>

                                      {blocks.length > 0 ? (
                                        <div className="mt-3 space-y-2">
                                          {blocks.map(block => (
                                            <div key={block.key} className="rounded-lg bg-[#F8F4F0] px-3 py-2">
                                              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#B08F72]">
                                                {block.key === 'deliverable'
                                                  ? t(locale, '交付内容', 'Deliverable')
                                                  : block.key === 'manager_feedback'
                                                    ? t(locale, '经理反馈', 'Manager feedback')
                                                    : t(locale, '审计反馈', 'Audit feedback')}
                                              </p>
                                              <p className="mt-1 whitespace-pre-wrap text-[10px] leading-5 text-[#5A4A3A]">
                                                {block.content}
                                              </p>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <p className="mt-3 text-[10px] text-[#8B7355]">
                                          {t(locale, '当前还没有可展开的详细内容。', 'There is no detailed content to expand yet.')}
                                        </p>
                                      )}
                                    </div>
                                  );
                                })}

                                {role.messages.length > 0 ? (
                                  <div className="rounded-xl border border-[#EEE1D3] bg-white px-3 py-3">
                                    <p className="text-[11px] font-semibold text-[#3A2A1A]">
                                      {t(locale, '相关事件', 'Related events')}
                                    </p>
                                    <div className="mt-2 space-y-2">
                                      {role.messages.map(message => (
                                        <div key={message.id} className="rounded-lg bg-[#F8F4F0] px-3 py-2">
                                          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#8B7355]">
                                            <span>{getNodeName(message.from_agent, nodeMap)} → {getNodeName(message.to_agent, nodeMap)}</span>
                                            <span>{fmt(message.created_at)}</span>
                                          </div>
                                          <p className="mt-1 text-[10px] leading-5 text-[#5A4A3A]">
                                            {summarizeText(message.content, copy.common.unavailable, 180)}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[#E8DDD0] bg-white/82 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-[#B08F72]" />
              <div>
                <p className="text-sm font-semibold text-[#3A2A1A]">{t(locale, '关键事件', 'Key events')}</p>
                <p className="text-[10px] leading-5 text-[#8B7355]">
                  {t(locale, '默认只显示最近 3 条，避免消息流把进度信息淹没。', 'Only the most recent events are shown by default so progress stays readable.')}
                </p>
              </div>
            </div>
            {progressState.keyEvents.length > 3 ? (
              <button
                type="button"
                onClick={() => setShowAllEvents(prev => !prev)}
                className="rounded-lg bg-[#F0E8E0] px-2.5 py-1 text-[10px] font-semibold text-[#5B4837]"
              >
                {showAllEvents ? t(locale, '收起', 'Show less') : t(locale, '查看全部事件', 'View all events')}
              </button>
            ) : null}
          </div>

          {visibleEvents.length === 0 ? (
            <div className="rounded-2xl bg-[#F8F4F0] px-4 py-6 text-center text-[11px] text-[#8B7355]">
              {copy.workflow.progress.noMessages}
            </div>
          ) : (
            <div className="space-y-2">
              {visibleEvents.map(message => (
                <div key={message.id} className="rounded-xl border border-[#EEE1D3] bg-[#FFFCF8] px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#8B7355]">
                    <span>{getNodeName(message.from_agent, nodeMap)} → {getNodeName(message.to_agent, nodeMap)}</span>
                    <span>{fmt(message.created_at)}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-[#B08F72]">
                    {getDynamicStageLabel(
                      locale,
                      message.stage,
                      copy.workflow.stages[message.stage as keyof typeof copy.workflow.stages] || message.stage
                    )}
                  </p>
                  <p className="mt-2 text-[11px] leading-5 text-[#5A4A3A]">
                    {summarizeText(message.content, copy.common.unavailable, 180)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <RoleSwitchTimeline />

        <div className="rounded-2xl border border-[#E8DDD0] bg-white/82 p-3">
          <button
            type="button"
            onClick={() => setIsContextOpen(prev => !prev)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <div className="flex items-center gap-2">
              <PanelRight className="h-4 w-4 text-[#B08F72]" />
              <div>
                <p className="text-sm font-semibold text-[#3A2A1A]">{t(locale, '输入与上下文', 'Input and context')}</p>
                <p className="text-[10px] leading-5 text-[#8B7355]">
                  {t(locale, '附件和组织推理保留，但默认折叠，避免跟执行进度抢层级。', 'Attachments and organization context stay available, but collapsed by default.')}
                </p>
              </div>
            </div>
            {isContextOpen ? <ChevronDown className="h-4 w-4 text-[#B08F72]" /> : <ChevronRight className="h-4 w-4 text-[#B08F72]" />}
          </button>

          {isContextOpen ? (
            <div className="mt-3 space-y-3">
              <div className="rounded-xl border border-[#EEE1D3] bg-[#FFFCF8] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-[#3A2A1A]">{t(locale, '输入附件', 'Input attachments')}</p>
                  <Pill>{attachments.length}</Pill>
                </div>
                {attachments.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {attachments.map(attachment => (
                      <div key={attachment.id} className="rounded-lg bg-white px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[11px] font-medium text-[#3A2A1A]">{attachment.name}</p>
                          <div className="flex flex-wrap gap-2 text-[9px] text-[#8B7355]">
                            <Pill>{formatAttachmentSize(attachment.size)}</Pill>
                            <Pill>{getAttachmentStatusLabel(locale, attachment)}</Pill>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[10px] text-[#8B7355]">{t(locale, '当前没有输入附件。', 'There are no input attachments for this workflow.')}</p>
                )}
              </div>

              <div className="rounded-xl border border-indigo-200 bg-indigo-50/80 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-indigo-900">{t(locale, '组织摘要', 'Organization summary')}</p>
                  {organization ? <Pill>{organization.departments.length} {t(locale, '部门', 'departments')}</Pill> : null}
                </div>
                {organization ? (
                  <>
                    <p className="mt-2 text-[11px] leading-5 text-indigo-900">
                      {t(locale, '当前组织', 'Current org')}: {organization.departments.length} {t(locale, '部门', 'departments')} / {organization.nodes.length} {t(locale, '节点', 'nodes')} / {organization.taskProfile}
                    </p>
                    <p className="mt-2 text-[10px] leading-5 text-indigo-800">
                      {summarizeText(organization.reasoning, copy.common.unavailable, 180)}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-[10px] text-indigo-800">{t(locale, '当前还没有组织生成结果。', 'No organization summary is available yet.')}</p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {canExport ? <ExportDialog open={exportOpen} onOpenChange={setExportOpen} workflowId={currentWorkflow.id} /> : null}
    </div>
  );
}

function ReviewView() {
  const { copy } = useI18n();
  const { tasks } = useWorkflowStore();
  return (
    <div className="flex h-full flex-col">
      <Section title={copy.workflow.review.title} description={copy.workflow.review.description} />
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tasks.length === 0 ? <div className="rounded-2xl bg-[#F8F4F0] px-4 py-8 text-center text-[11px] text-[#8B7355]">{copy.workflow.review.empty}</div> : <div className="space-y-3">{tasks.map(task => <div key={task.id} className="rounded-2xl border border-[#E8DDD0] bg-white/78 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-[#3A2A1A]">{task.description}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${taskBadge[task.status] || taskBadge.assigned}`}>{copy.workflow.statuses.task[task.status as keyof typeof copy.workflow.statuses.task] || task.status}</span></div>{task.deliverable_v3 || task.deliverable_v2 || task.deliverable ? <div className="mt-3 rounded-xl bg-[#F8F4F0] p-3"><p className="mb-1 text-[10px] font-semibold text-[#8B7355]">{copy.workflow.review.deliverable}</p><p className="whitespace-pre-wrap text-[11px] leading-5 text-[#5A4A3A]">{task.deliverable_v3 || task.deliverable_v2 || task.deliverable}</p></div> : null}{task.manager_feedback ? <div className="mt-3 rounded-xl bg-emerald-50 p-3"><p className="mb-1 text-[10px] font-semibold text-emerald-700">{copy.workflow.review.feedback}</p><p className="whitespace-pre-wrap text-[11px] leading-5 text-[#375B46]">{task.manager_feedback}</p></div> : null}{task.meta_audit_feedback ? <div className="mt-3 rounded-xl bg-amber-50 p-3"><p className="mb-1 text-[10px] font-semibold text-amber-700">{copy.workflow.review.audit}</p><p className="whitespace-pre-wrap text-[11px] leading-5 text-[#6B5635]">{task.meta_audit_feedback}</p></div> : null}</div>)}</div>}
      </div>
    </div>
  );
}

function MemoryView() {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const fmt = useFmt();
  const isDemoActive = useDemoStore(s => s.isActive);
  const { agents, currentWorkflow, currentWorkflowId, selectedMemoryAgentId, setSelectedMemoryAgent, agentMemoryRecent, agentMemorySearchResults, memoryQuery, isMemoryLoading, setMemoryQuery, fetchAgentRecentMemory, searchAgentMemory } = useWorkflowStore();
  const [draft, setDraft] = useState(memoryQuery);
  const organization = getOrganization(currentWorkflow);
  const nodeMap = useMemo(() => getNodeMap(organization), [organization]);
  const organizationIds = useMemo(
    () => new Set(organization?.nodes.map(node => node.agentId) || []),
    [organization]
  );
  const availableAgents = useMemo(() => {
    const list = organization ? agents.filter(agent => organizationIds.has(agent.id)) : agents;
    const rank: Record<AgentInfo['role'], number> = { ceo: 0, manager: 1, worker: 2 };
    return [...list].sort(
      (a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name, locale)
    );
  }, [agents, locale, organization, organizationIds]);
  const selectedAgent =
    availableAgents.find(agent => agent.id === selectedMemoryAgentId) ||
    (organization?.rootAgentId
      ? availableAgents.find(agent => agent.id === organization.rootAgentId)
      : null) ||
    availableAgents[0] ||
    null;

  useEffect(() => setDraft(memoryQuery), [memoryQuery]);
  useEffect(() => {
    if (!selectedMemoryAgentId && selectedAgent) {
      setSelectedMemoryAgent(selectedAgent.id);
    }
  }, [selectedAgent, selectedMemoryAgentId, setSelectedMemoryAgent]);
  useEffect(() => {
    if (selectedAgent) void fetchAgentRecentMemory(selectedAgent.id, currentWorkflowId, 10);
  }, [currentWorkflowId, fetchAgentRecentMemory, selectedAgent]);

  const doSearch = async () => {
    if (!selectedAgent || !draft.trim()) return;
    const query = draft.trim();
    setMemoryQuery(query);
    await searchAgentMemory(selectedAgent.id, query, 6);
  };

  return (
    <div className="flex h-full flex-col">
      <Section title={copy.workflow.memory.title} description={copy.workflow.memory.description} />
      {isDemoActive && <MemoryTimeline />}
      <div className="border-b border-[#F0E8E0] px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {availableAgents.map(agent => (
            <button
              key={agent.id}
              onClick={() => setSelectedMemoryAgent(agent.id)}
              className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
                selectedAgent?.id === agent.id
                  ? 'bg-[#D4845A] text-white'
                  : 'bg-[#F8F4F0] text-[#6B5A4A]'
              }`}
            >
              {agent.name}
            </button>
          ))}
        </div>
        {selectedAgent ? (
          <div className="mt-2 rounded-xl bg-[#F8F4F0] px-3 py-2 text-[10px] text-[#6B5A4A]">
            {selectedAgent.name} / {nodeMap.get(selectedAgent.id)?.title || selectedAgent.role} / {nodeMap.get(selectedAgent.id)?.departmentLabel || selectedAgent.department}
            {(() => {
              const profile = useReputationStore.getState().profiles[selectedAgent.id];
              return profile ? (
                <span className="ml-2"><ReputationBadge grade={profile.grade} trustTier={profile.trustTier} size="sm" /></span>
              ) : null;
            })()}
          </div>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {selectedAgent ? (
          <div className="mb-4 space-y-3">
            {(() => {
              const profile = useReputationStore.getState().profiles[selectedAgent.id];
              if (!profile) return null;
              return (
                <>
                  <div className="flex justify-center">
                    <ReputationRadar dimensions={profile.dimensions} size={160} />
                  </div>
                  <ReputationHistory agentId={selectedAgent.id} />
                </>
              );
            })()}
          </div>
        ) : null}
        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between">
            <h4 className="text-[11px] font-bold text-[#8B7355]">{copy.workflow.memory.recent}</h4>
            {isMemoryLoading ? <span className="flex items-center gap-1 text-[10px] text-[#B0A090]"><Loader2 className="h-3 w-3 animate-spin" />{copy.common.loading}</span> : null}
          </div>
          {!selectedAgent ? <div className="rounded-2xl bg-[#F8F4F0] px-3 py-4 text-center text-[11px] text-[#8B7355]">{copy.workflow.memory.emptySelected}</div> : agentMemoryRecent.length === 0 ? <div className="rounded-2xl bg-[#F8F4F0] px-3 py-4 text-center text-[11px] text-[#8B7355]">{copy.workflow.memory.emptyRecent}</div> : <div className="space-y-2">{agentMemoryRecent.slice().reverse().map((entry, index) => <div key={`${entry.timestamp}-${index}`} className="rounded-xl border border-[#E8DDD0] bg-white/80 p-3"><div className="mb-1 flex items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-1.5"><span className="rounded-full bg-[#F0E8E0] px-2 py-0.5 text-[8px] text-[#6B5A4A]">{getMemoryTypeLabel(copy, entry.type)}</span>{entry.direction ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[8px] text-blue-700">{copy.workflow.directions[entry.direction as keyof typeof copy.workflow.directions] || entry.direction}</span> : null}{entry.stage ? <Pill>{entry.stage}</Pill> : null}</div><span className="text-[8px] text-[#B0A090]">{fmt(entry.timestamp)}</span></div><p className="whitespace-pre-wrap text-[10px] leading-5 text-[#5D4C3B]">{entry.preview || entry.content}</p></div>)}</div>}
        </div>

        <div>
          <h4 className="mb-1.5 text-[11px] font-bold text-[#8B7355]">{copy.workflow.memory.search}</h4>
          <div className="mb-3 flex items-center gap-2">
            <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void doSearch(); } }} placeholder={copy.workflow.memory.searchPlaceholder} className="flex-1 rounded-xl border border-[#E8DDD0] bg-[#FFFCF8] px-3 py-2 text-sm text-[#3A2A1A] placeholder:text-[#B8A897] focus:border-[#2D5F4A]/40 focus:outline-none focus:ring-2 focus:ring-[#2D5F4A]/15" />
            <button onClick={() => void doSearch()} disabled={!selectedAgent || !draft.trim()} className="inline-flex h-10 items-center justify-center rounded-xl bg-[#2D5F4A] px-3 text-sm font-semibold text-white disabled:opacity-40">{copy.common.search}</button>
          </div>
          {agentMemorySearchResults.length === 0 ? <div className="rounded-2xl bg-[#F8F4F0] px-3 py-4 text-center text-[11px] text-[#8B7355]">{copy.workflow.memory.emptySearch}</div> : <div className="space-y-2">{agentMemorySearchResults.map(item => <div key={`${item.workflowId}-${item.createdAt}`} className="rounded-xl border border-[#E8DDD0] bg-white/80 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] font-semibold text-[#3A2A1A]">{item.directive}</p><span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${wfBadge[item.status] || wfBadge.pending}`}>{copy.workflow.statuses.workflow[item.status as keyof typeof copy.workflow.statuses.workflow] || item.status}</span></div><p className="mt-1 text-[9px] text-[#8B7355]">{fmt(item.createdAt)}</p><p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-[#5A4A3A]">{item.summary}</p></div>)}</div>}
        </div>
      </div>
    </div>
  );
}

function ReportCard({ item }: { item: HeartbeatReportInfo }) {
  const { copy } = useI18n();
  const fmt = useFmt();
  const downloadHeartbeatReport = useWorkflowStore(state => state.downloadHeartbeatReport);
  return (
    <div className="rounded-xl border border-[#E8DDD0] bg-white/80 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-[#3A2A1A]">{item.title}</p>
          <p className="mt-0.5 text-[9px] text-[#8B7355]">{item.agentName} · {item.department} · {fmt(item.generatedAt)}</p>
        </div>
        <span className="rounded-full bg-[#F0E8E0] px-2 py-0.5 text-[8px] font-medium text-[#6B5A4A]">{copy.workflow.reports.triggers[item.trigger as keyof typeof copy.workflow.reports.triggers] || item.trigger}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[10px] leading-5 text-[#5D4C3B]">{item.summaryPreview}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button onClick={() => void downloadHeartbeatReport(item.agentId, item.reportId, 'json')} className="inline-flex items-center gap-1 rounded-lg bg-[#F0E8E0] px-2.5 py-1 text-[9px] font-medium text-[#5B4837]"><Download className="h-3 w-3" />{copy.common.json}</button>
        <button onClick={() => void downloadHeartbeatReport(item.agentId, item.reportId, 'md')} className="inline-flex items-center gap-1 rounded-lg bg-[#F0E8E0] px-2.5 py-1 text-[9px] font-medium text-[#5B4837]"><Download className="h-3 w-3" />{copy.common.markdown}</button>
      </div>
    </div>
  );
}

function ReportsView() {
  const { copy } = useI18n();
  const fmt = useFmt();
  const { heartbeatStatuses, heartbeatReports, fetchHeartbeatStatuses, fetchHeartbeatReports, runHeartbeat, runningHeartbeatAgentId, isHeartbeatLoading } = useWorkflowStore();
  useEffect(() => { void fetchHeartbeatStatuses(); void fetchHeartbeatReports(undefined, 12); }, [fetchHeartbeatReports, fetchHeartbeatStatuses]);
  const enabled = heartbeatStatuses.filter(item => item.enabled).length;
  const running = heartbeatStatuses.filter(item => item.state === 'running').length;
  return (
    <div className="flex h-full flex-col">
      <Section title={copy.workflow.reports.title} description={copy.workflow.reports.description} />
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-3 grid grid-cols-3 gap-2"><div className="rounded-xl border border-[#E8DDD0] bg-[#F8F4F0] px-3 py-2"><p className="text-[9px] text-[#8B7355]">{copy.workflow.reports.enabled}</p><p className="mt-1 text-sm font-bold text-[#3A2A1A]">{enabled}</p></div><div className="rounded-xl border border-[#E8DDD0] bg-[#F8F4F0] px-3 py-2"><p className="text-[9px] text-[#8B7355]">{copy.workflow.reports.running}</p><p className="mt-1 text-sm font-bold text-[#3A2A1A]">{running}</p></div><div className="rounded-xl border border-[#E8DDD0] bg-[#F8F4F0] px-3 py-2"><p className="text-[9px] text-[#8B7355]">{copy.workflow.reports.latest}</p><p className="mt-1 text-[10px] font-semibold text-[#3A2A1A]">{fmt(heartbeatReports[0]?.generatedAt || null)}</p></div></div>
        <div className="mb-4"><div className="mb-1.5 flex items-center justify-between"><h4 className="text-[11px] font-bold text-[#8B7355]">{copy.workflow.reports.statusList}</h4>{isHeartbeatLoading ? <span className="flex items-center gap-1 text-[10px] text-[#B0A090]"><Loader2 className="h-3 w-3 animate-spin" />{copy.common.loading}</span> : null}</div>{heartbeatStatuses.length === 0 ? <div className="rounded-2xl bg-[#F8F4F0] px-3 py-4 text-center text-[11px] text-[#8B7355]">{copy.workflow.reports.emptyStatuses}</div> : <div className="space-y-2">{heartbeatStatuses.map(item => <div key={item.agentId} className="rounded-xl border border-[#E8DDD0] bg-white/80 p-3 shadow-sm"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="flex items-center gap-2"><p className="text-[11px] font-semibold text-[#3A2A1A]">{item.agentName}</p><span className={`rounded-full px-2 py-0.5 text-[8px] font-medium ${hbBadge[item.state] || hbBadge.idle}`}>{copy.workflow.statuses.heartbeat[item.state as keyof typeof copy.workflow.statuses.heartbeat] || item.state}</span></div><p className="mt-0.5 text-[9px] text-[#8B7355]">{item.department} · {item.intervalMinutes} min · {item.reportCount}</p></div><button onClick={() => void runHeartbeat(item.agentId)} disabled={!item.enabled || runningHeartbeatAgentId === item.agentId} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-cyan-100 px-2.5 py-1.5 text-[9px] font-medium text-cyan-700 disabled:opacity-50">{runningHeartbeatAgentId === item.agentId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}{runningHeartbeatAgentId === item.agentId ? copy.workflow.reports.runningNow : copy.workflow.reports.triggerNow}</button></div><div className="mt-2 rounded-lg bg-[#F8F4F0] px-2.5 py-2 text-[9px] text-[#6B5A4A]"><p>{copy.workflow.reports.focus}: {item.focus}</p><p className="mt-1">{copy.workflow.reports.keywords}: {item.keywords.length > 0 ? item.keywords.join(' / ') : copy.common.unavailable}</p><p className="mt-1">{copy.workflow.reports.lastSuccess}: {fmt(item.lastSuccessAt)}</p><p className="mt-1">{copy.workflow.reports.nextRun}: {fmt(item.nextRunAt)}</p>{item.lastReportTitle ? <p className="mt-1">{copy.workflow.reports.lastReport}: {item.lastReportTitle}</p> : null}{item.lastError ? <p className="mt-1 text-red-600">{copy.workflow.reports.error}: {item.lastError}</p> : null}</div></div>)}</div>}</div>
        <div><h4 className="mb-1.5 text-[11px] font-bold text-[#8B7355]">{copy.workflow.reports.reportsList}</h4>{heartbeatReports.length === 0 ? <div className="rounded-2xl bg-[#F8F4F0] px-3 py-4 text-center text-[11px] text-[#8B7355]">{copy.workflow.reports.emptyReports}</div> : <div className="space-y-2">{heartbeatReports.map(item => <ReportCard key={`${item.agentId}-${item.reportId}`} item={item} />)}</div>}</div>
      </div>
    </div>
  );
}

function HistoryView() {
  const { copy } = useI18n();
  const fmt = useFmt();
  const { workflows, setCurrentWorkflow, setActiveView, fetchWorkflows } = useWorkflowStore();
  useEffect(() => { void fetchWorkflows(); }, [fetchWorkflows]);
  return (
    <div className="flex h-full flex-col">
      <Section title={copy.workflow.history.title} />
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {workflows.length === 0 ? <div className="py-8 text-center text-xs text-[#8B7355]">{copy.workflow.history.empty}</div> : workflows.map(workflow => <button key={workflow.id} onClick={() => { setCurrentWorkflow(workflow.id); setActiveView('workflow'); }} className="w-full rounded-xl border border-[#E8DDD0] bg-[#F8F4F0] p-3 text-left hover:bg-[#F0E8E0]"><div className="mb-1 flex items-center justify-between gap-2"><span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${wfBadge[workflow.status] || wfBadge.pending}`}>{copy.workflow.statuses.workflow[workflow.status as keyof typeof copy.workflow.statuses.workflow] || workflow.status}</span><span className="text-[9px] text-[#B0A090]">{fmt(workflow.created_at)}</span></div><p className="line-clamp-2 text-xs text-[#3A2A1A]">{workflow.directive}</p></button>)}
      </div>
    </div>
  );
}

function DemoEvolutionOverlay() {
  const isDemoActive = useDemoStore(s => s.isActive);
  const currentStage = useDemoStore(s => s.currentStage);
  if (!isDemoActive || currentStage !== 'evolution') return null;
  return <EvolutionScoreCard />;
}

function DemoControls() {
  const isDemoActive = useDemoStore(s => s.isActive);
  const playbackState = useDemoStore(s => s.playbackState);
  const { pauseDemo, resumeDemo, stopDemo } = useDemoMode();

  if (!isDemoActive) return null;

  return (
    <div className="flex items-center gap-2 border-b border-[#7CB9E8]/30 bg-[#E8F4FD] px-4 py-2">
      <span className="text-[10px] font-semibold text-[#2E86C1]">🎬 Demo</span>
      <span className="rounded-full bg-[#7CB9E8]/20 px-2 py-0.5 text-[9px] font-medium text-[#2E86C1]">{playbackState}</span>
      <div className="flex-1" />
      {playbackState === 'playing' ? (
        <button onClick={pauseDemo} className="rounded-lg bg-white/80 px-2.5 py-1 text-[10px] font-medium text-[#2E86C1] shadow-sm hover:bg-white">⏸ Pause</button>
      ) : playbackState === 'paused' ? (
        <button onClick={resumeDemo} className="rounded-lg bg-white/80 px-2.5 py-1 text-[10px] font-medium text-[#2E86C1] shadow-sm hover:bg-white">▶ Resume</button>
      ) : null}
      <button onClick={stopDemo} className="rounded-lg bg-white/80 px-2.5 py-1 text-[10px] font-medium text-red-500 shadow-sm hover:bg-white">⏹ Stop</button>
    </div>
  );
}

export function WorkflowPanel() {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const { isMobile, isTablet } = useViewportTier();
  const { isWorkflowPanelOpen, toggleWorkflowPanel, activeView, setActiveView, initSocket, fetchAgents, fetchStages, fetchWorkflows, fetchHeartbeatStatuses, fetchHeartbeatReports, connected } = useWorkflowStore();

  useEffect(() => {
    void initSocket();
    void fetchAgents();
    void fetchStages();
    void fetchWorkflows();
    void fetchHeartbeatStatuses();
    void fetchHeartbeatReports(undefined, 12);
  }, [fetchAgents, fetchHeartbeatReports, fetchHeartbeatStatuses, fetchStages, fetchWorkflows, initSocket, runtimeMode]);

  if (!isWorkflowPanelOpen) return null;

  const shellClass = isMobile ? 'left-2 right-2 bottom-[calc(env(safe-area-inset-bottom)+8px)] top-[calc(env(safe-area-inset-top)+108px)] rounded-[30px]' : isTablet ? 'bottom-5 right-5 h-[min(74svh,620px)] w-[420px] rounded-3xl' : 'bottom-6 right-6 h-[620px] w-[440px] rounded-3xl';
  const tabs: Array<{ id: PanelView; icon: typeof Zap; label: string }> = [
    { id: 'directive', icon: Zap, label: copy.workflow.tabs.directive },
    { id: 'org', icon: Network, label: copy.workflow.tabs.org },
    { id: 'workflow', icon: BarChart3, label: copy.workflow.tabs.workflow },
    { id: 'review', icon: Star, label: copy.workflow.tabs.review },
    { id: 'memory', icon: BookOpenText, label: copy.workflow.tabs.memory },
    { id: 'reports', icon: Search, label: copy.workflow.tabs.reports },
    { id: 'history', icon: History, label: copy.workflow.tabs.history },
    { id: 'sessions', icon: Database, label: copy.workflow.tabs.sessions },
  ];

  return (
    <div className={`fixed z-[71] flex flex-col border border-white/60 bg-white/92 shadow-[0_12px_48px_rgba(0,0,0,0.15)] backdrop-blur-2xl animate-in slide-in-from-bottom-4 fade-in duration-300 ${shellClass}`} style={{ pointerEvents: 'auto' }}>
      <div className="flex items-center justify-between border-b border-[#F0E8E0] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#D4845A] to-[#E4946A] shadow-sm"><Brain className="h-4 w-4 text-white" /></div>
          <div>
            <h3 className="text-sm font-bold text-[#3A2A1A]">{copy.workflow.title}</h3>
            <div className="flex items-center gap-1.5"><div className={`h-1.5 w-1.5 rounded-full ${runtimeMode === 'frontend' ? 'bg-amber-400' : connected ? 'bg-emerald-500' : 'bg-red-400'}`} /><span className="text-[9px] text-[#8B7355]">{connected ? copy.workflow.connected : copy.workflow.disconnected}</span></div>
          </div>
        </div>
        <button onClick={toggleWorkflowPanel} className="rounded-xl p-2 hover:bg-[#F0E8E0]" title={copy.common.close}><X className="h-4 w-4 text-[#8B7355]" /></button>
      </div>
      <div className="border-b border-[#F0E8E0] px-3 py-2"><div className="flex gap-1 overflow-x-auto pb-1">{tabs.map(({ id, icon: Icon, label }) => <button key={id} onClick={() => setActiveView(id)} className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-medium ${activeView === id ? 'bg-[#D4845A] text-white shadow-sm' : 'text-[#8B7355] hover:bg-[#F0E8E0]'}`}><Icon className="h-3 w-3" />{label}</button>)}</div></div>
      {runtimeMode === 'frontend' ? <div className="border-b border-[#F0E8E0] bg-[#FFF7EC] px-4 py-2.5"><p className="text-[10px] leading-5 text-[#6B5A4A]">{getFrontendWorkflowBanner(locale, CAN_USE_ADVANCED_RUNTIME)}</p></div> : null}
      <DemoControls />
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeView === 'directive' ? <DirectiveView /> : null}
        {activeView === 'org' ? <OrgView /> : null}
        {activeView === 'workflow' ? <ProgressView /> : null}
        {activeView === 'review' ? <ReviewView /> : null}
        {activeView === 'memory' ? <MemoryView /> : null}
        {activeView === 'reports' ? <ReportsView /> : null}
        {activeView === 'history' ? <HistoryView /> : null}
        {activeView === 'sessions' ? <SessionHistoryTab /> : null}
      </div>
      <DemoEvolutionOverlay />
    </div>
  );
}

