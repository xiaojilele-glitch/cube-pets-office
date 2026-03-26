/**
 * Orchestrates the 10-stage workflow pipeline.
 */
import { v4 as uuidv4 } from 'uuid';

import db from '../db/index.js';
import type { TaskRow } from '../db/index.js';
import type { FinalWorkflowReport } from '../memory/report-store.js';
import { reportStore } from '../memory/report-store.js';
import { sessionStore } from '../memory/session-store.js';
import { registry } from './registry.js';
import { messageBus } from './message-bus.js';
import { emitEvent } from './socket.js';

export const V3_STAGES = [
  'direction',
  'planning',
  'execution',
  'review',
  'meta_audit',
  'revision',
  'verify',
  'summary',
  'feedback',
  'evolution',
] as const;

export type Stage = typeof V3_STAGES[number];

interface CEOAnalysis {
  analysis: string;
  departments: Array<{
    id: string;
    managerId: string;
    direction: string;
  }>;
}

interface ManagerPlan {
  plan_summary: string;
  tasks: Array<{
    worker_id: string;
    description: string;
  }>;
}

interface ReviewScore {
  accuracy: number;
  completeness: number;
  actionability: number;
  format: number;
  total: number;
  feedback: string;
}

interface VerifyResult {
  items: Array<{ point: string; addressed: boolean; comment: string }>;
  unaddressed_ratio: number;
  verdict: 'pass' | 'needs_v3';
}

function bestDeliverable(task: TaskRow): string {
  return task.deliverable_v3 || task.deliverable_v2 || task.deliverable || '(无交付物)';
}

export class WorkflowEngine {
  /**
   * Start a workflow from a user directive.
   */
  async startWorkflow(directive: string): Promise<string> {
    const workflowId = uuidv4();
    console.log(`[Workflow] Starting ${workflowId}: "${directive.substring(0, 50)}..."`);

    db.createWorkflow(workflowId, directive, []);
    db.updateWorkflow(workflowId, {
      status: 'running',
      started_at: new Date().toISOString(),
    });

    this.runPipeline(workflowId, directive).catch((err) => {
      console.error('[Workflow] Pipeline error:', err);
      const wf = db.getWorkflow(workflowId);
      db.updateWorkflow(workflowId, {
        status: 'failed',
        results: {
          ...(wf?.results || {}),
          last_error: err.message,
          failed_stage: wf?.current_stage || null,
        },
      });
      emitEvent({ type: 'workflow_error', workflowId, error: err.message });
    });

    return workflowId;
  }

  /**
   * Run the full pipeline in order.
   */
  private async runPipeline(workflowId: string, directive: string): Promise<void> {
    try {
      await this.runDirection(workflowId, directive);
      await this.runPlanning(workflowId);
      await this.runExecution(workflowId);
      await this.runReview(workflowId);
      await this.runMetaAudit(workflowId);
      await this.runRevision(workflowId);
      await this.runVerify(workflowId);
      await this.runSummary(workflowId);
      await this.runFeedback(workflowId);
      await this.runEvolution(workflowId);

      db.updateWorkflow(workflowId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
      });
      try {
        this.persistFinalReport(workflowId);
      } catch (reportErr: any) {
        console.error(`[Workflow] Failed to persist final report for ${workflowId}:`, reportErr);
        const wf = db.getWorkflow(workflowId);
        db.updateWorkflow(workflowId, {
          results: {
            ...(wf?.results || {}),
            report_error: reportErr.message,
          },
        });
      }
      sessionStore.materializeWorkflowMemories(workflowId);

      emitEvent({
        type: 'workflow_complete',
        workflowId,
        summary: 'Workflow completed successfully',
      });
      console.log(`[Workflow] ${workflowId} completed`);
    } catch (err: any) {
      console.error(`[Workflow] ${workflowId} failed:`, err);
      const wf = db.getWorkflow(workflowId);
      db.updateWorkflow(workflowId, {
        status: 'failed',
        results: {
          ...(wf?.results || {}),
          last_error: err.message,
          failed_stage: wf?.current_stage || null,
        },
      });
      sessionStore.materializeWorkflowMemories(workflowId);
      emitEvent({ type: 'workflow_error', workflowId, error: err.message });
      throw err;
    }
  }

  private emitStage(workflowId: string, stage: Stage): void {
    db.updateWorkflow(workflowId, { current_stage: stage });
    emitEvent({ type: 'stage_change', workflowId, stage });
    console.log(`[Workflow] ${workflowId} -> Stage: ${stage}`);
  }

  // ============================================================
  // Stage 1: Direction
  // ============================================================
  private async runDirection(workflowId: string, directive: string): Promise<void> {
    this.emitStage(workflowId, 'direction');

    const ceo = registry.getCEO();
    if (!ceo) throw new Error('CEO agent not found');

    emitEvent({ type: 'agent_active', agentId: 'ceo', action: 'analyzing', workflowId });

    const analysis = await ceo.invokeJson<CEOAnalysis>(`请分析下面这条用户指令，并决定需要哪些部门参与。

可选部门：
- game，经理 pixel：负责游戏策划、技术实现、体验设计、数据增长
- ai，经理 nexus：负责模型、数据、算法、AI 应用落地
- life，经理 echo：负责内容、运营、社区、用户沟通

要求：
- 只选择有必要参与的部门
- 每个部门给出清晰的执行方向
- direction 必须是可以直接让经理继续拆任务的文字

用户指令：
${directive}

只输出 JSON：
{
  "analysis": "对用户需求的理解",
  "departments": [
    {
      "id": "game|ai|life",
      "managerId": "pixel|nexus|echo",
      "direction": "给该部门的明确方向"
    }
  ]
}`, undefined, { workflowId, stage: 'direction' });

    const departments = Array.isArray(analysis.departments) ? analysis.departments : [];
    const deptIds = departments.map((item) => item.id);
    db.updateWorkflow(workflowId, { departments_involved: deptIds });

    for (const dept of departments) {
      await messageBus.send('ceo', dept.managerId, dept.direction, workflowId, 'direction', {
        analysis: analysis.analysis,
      });
    }

    emitEvent({ type: 'agent_active', agentId: 'ceo', action: 'idle', workflowId });
  }

  // ============================================================
  // Stage 2: Planning
  // ============================================================
  private async runPlanning(workflowId: string): Promise<void> {
    this.emitStage(workflowId, 'planning');

    const wf = db.getWorkflow(workflowId);
    if (!wf) throw new Error('Workflow not found');

    const departments = wf.departments_involved || [];

    await Promise.all(
      departments.map(async (deptId: string) => {
        const manager = registry.getManagerByDepartment(deptId);
        if (!manager) {
          console.warn(`[Workflow] No manager for department: ${deptId}`);
          return;
        }

        emitEvent({
          type: 'agent_active',
          agentId: manager.config.id,
          action: 'planning',
          workflowId,
        });

        const inbox = await messageBus.getInbox(manager.config.id, workflowId);
        const directionMsg = inbox.find((message) => message.stage === 'direction');
        if (!directionMsg) {
          console.warn(`[Workflow] No direction found for ${manager.config.id}`);
          return;
        }

        const workers = registry.getWorkersByManager(manager.config.id);
        const workerList = workers
          .map((worker) => `- ${worker.config.id}: ${worker.config.name}`)
          .join('\n');

        const plan = await manager.invokeJson<ManagerPlan>(`你收到的部门方向如下：
${directionMsg.content}

你可调度的团队成员：
${workerList}

请把方向拆成具体任务并分配给合适的成员。

要求：
- 只给需要参与的人派任务
- worker_id 必须来自上面的成员列表
- description 必须足够具体，能直接执行

只输出 JSON：
{
  "plan_summary": "本部门执行摘要",
  "tasks": [
    {
      "worker_id": "团队成员 ID",
      "description": "具体任务说明"
    }
  ]
}`, undefined, { workflowId, stage: 'planning' });

        for (const task of plan.tasks || []) {
          const worker = workers.find((item) => item.config.id === task.worker_id);
          if (!worker) {
            console.warn(
              `[Workflow] Invalid worker ${task.worker_id} for manager ${manager.config.id}`
            );
            continue;
          }

          const taskRow = db.createTask({
            workflow_id: workflowId,
            worker_id: task.worker_id,
            manager_id: manager.config.id,
            department: manager.config.department as any,
            description: task.description,
            deliverable: null,
            deliverable_v2: null,
            deliverable_v3: null,
            score_accuracy: null,
            score_completeness: null,
            score_actionability: null,
            score_format: null,
            total_score: null,
            manager_feedback: null,
            meta_audit_feedback: null,
            verify_result: null,
            version: 1,
            status: 'assigned',
          });

          await messageBus.send(
            manager.config.id,
            task.worker_id,
            task.description,
            workflowId,
            'planning',
            { taskId: taskRow.id }
          );
        }

        emitEvent({
          type: 'agent_active',
          agentId: manager.config.id,
          action: 'idle',
          workflowId,
        });
      })
    );
  }

  // ============================================================
  // Stage 3: Execution
  // ============================================================
  private async runExecution(workflowId: string): Promise<void> {
    this.emitStage(workflowId, 'execution');

    const tasks = db.getTasksByWorkflow(workflowId);

    await Promise.all(
      tasks.map(async (task) => {
        const worker = registry.get(task.worker_id);
        if (!worker) return;

        emitEvent({
          type: 'agent_active',
          agentId: task.worker_id,
          action: 'executing',
          workflowId,
        });
        db.updateTask(task.id, { status: 'executing' });
        emitEvent({
          type: 'task_update',
          workflowId,
          taskId: task.id,
          workerId: task.worker_id,
          status: 'executing',
        });

        try {
          const deliverable = await worker.invoke(`你收到的任务是：
${task.description}

请完成这项任务，并输出一份详细、具体、可执行的交付物。

要求：
- 不要泛泛而谈
- 尽量给出结构化建议、步骤、示例或判断依据
- 输出应让经理可以直接评审`, undefined, { workflowId, stage: 'execution' });

          db.updateTask(task.id, {
            deliverable,
            status: 'submitted',
          });

          await messageBus.send(
            task.worker_id,
            task.manager_id,
            deliverable,
            workflowId,
            'execution',
            { taskId: task.id }
          );

          emitEvent({
            type: 'task_update',
            workflowId,
            taskId: task.id,
            workerId: task.worker_id,
            status: 'submitted',
          });
        } catch (err: any) {
          console.error(`[Workflow] Worker ${task.worker_id} execution failed:`, err.message);
          db.updateTask(task.id, {
            status: 'failed',
            deliverable: `Error: ${err.message}`,
          });
        }

        emitEvent({
          type: 'agent_active',
          agentId: task.worker_id,
          action: 'idle',
          workflowId,
        });
      })
    );
  }

  // ============================================================
  // Stage 4: Review
  // ============================================================
  private async runReview(workflowId: string): Promise<void> {
    this.emitStage(workflowId, 'review');

    const tasks = db.getTasksByWorkflow(workflowId);
    const tasksByManager = new Map<string, TaskRow[]>();

    for (const task of tasks) {
      if (task.status !== 'submitted') continue;
      const list = tasksByManager.get(task.manager_id) || [];
      list.push(task);
      tasksByManager.set(task.manager_id, list);
    }

    await Promise.all(
      Array.from(tasksByManager.entries()).map(async ([managerId, managerTasks]) => {
        const manager = registry.get(managerId);
        if (!manager) return;

        emitEvent({
          type: 'agent_active',
          agentId: managerId,
          action: 'reviewing',
          workflowId,
        });

        for (const task of managerTasks) {
          try {
            const score = await manager.invokeJson<ReviewScore>(`请评审下面这份交付物，并按四个维度打分，每项 0 到 5 分：
- accuracy：信息是否准确、判断是否靠谱
- completeness：是否覆盖完成任务所需的关键内容
- actionability：是否足够具体、能否直接落地
- format：结构是否清楚、表达是否有条理

任务说明：
${task.description}

交付物：
${task.deliverable}

只输出 JSON：
{
  "accuracy": 0,
  "completeness": 0,
  "actionability": 0,
  "format": 0,
  "total": 0,
  "feedback": "具体指出优点、问题和修改建议"
}`, undefined, { workflowId, stage: 'review' });

            const accuracy = Math.min(5, Math.max(0, Math.round(score.accuracy || 0)));
            const completeness = Math.min(5, Math.max(0, Math.round(score.completeness || 0)));
            const actionability = Math.min(5, Math.max(0, Math.round(score.actionability || 0)));
            const format = Math.min(5, Math.max(0, Math.round(score.format || 0)));
            const total = accuracy + completeness + actionability + format;

            db.updateTask(task.id, {
              score_accuracy: accuracy,
              score_completeness: completeness,
              score_actionability: actionability,
              score_format: format,
              total_score: total,
              manager_feedback: score.feedback || '',
              status: 'reviewed',
            });

            emitEvent({
              type: 'score_assigned',
              workflowId,
              taskId: task.id,
              workerId: task.worker_id,
              score: total,
            });

            await messageBus.send(
              managerId,
              task.worker_id,
              `评分：${total}/20\n反馈：${score.feedback}`,
              workflowId,
              'review',
              {
                taskId: task.id,
                score: { accuracy, completeness, actionability, format, total },
              }
            );
          } catch (err: any) {
            console.error(`[Workflow] Review failed for task ${task.id}:`, err.message);
            db.updateTask(task.id, {
              score_accuracy: 3,
              score_completeness: 3,
              score_actionability: 3,
              score_format: 3,
              total_score: 12,
              manager_feedback: '评审失败，系统采用默认分数。',
              status: 'reviewed',
            });
          }
        }

        emitEvent({
          type: 'agent_active',
          agentId: managerId,
          action: 'idle',
          workflowId,
        });
      })
    );
  }

  // ============================================================
  // Stage 5: Meta Audit
  // ============================================================
  private async runMetaAudit(workflowId: string): Promise<void> {
    this.emitStage(workflowId, 'meta_audit');

    const tasks = db.getTasksByWorkflow(workflowId).filter((task) => task.status === 'reviewed');
    if (tasks.length === 0) return;

    const warden = registry.get('warden');
    const prism = registry.get('prism');

    const taskSummary = tasks
      .map(
        (task) =>
          `[${task.worker_id}] 任务：${task.description}\n评分：${task.total_score}/20\n交付物摘要：${bestDeliverable(task).substring(0, 500)}`
      )
      .join('\n\n---\n\n');

    const auditResults: string[] = [];

    if (warden) {
      emitEvent({ type: 'agent_active', agentId: 'warden', action: 'auditing', workflowId });
      try {
        const wardenAudit = await warden.invoke(`请从角色边界和组织协作的角度审视下面这些交付物。

检查重点：
- 是否越权或偏离角色定位
- 是否真正回应了被分配的任务
- 是否存在明显的部门协作断层

待审内容：
${taskSummary}

请输出简洁、具体的审计意见。`, undefined, { workflowId, stage: 'meta_audit' });

        auditResults.push(`[Warden 合规审计]\n${wardenAudit}`);
      } catch (err: any) {
        auditResults.push(`[Warden] 审计失败：${err.message}`);
      }
      emitEvent({ type: 'agent_active', agentId: 'warden', action: 'idle', workflowId });
    }

    if (prism) {
      emitEvent({ type: 'agent_active', agentId: 'prism', action: 'auditing', workflowId });
      try {
        const prismAudit = await prism.invoke(`请从内容质量角度审视下面这些交付物。

检查重点：
- 是否存在套话、空话或明显注水
- 是否缺少关键数据、案例、步骤或判断依据
- 是否真正具有可执行性

待审内容：
${taskSummary}

请输出简洁、具体的质量分析意见。`, undefined, { workflowId, stage: 'meta_audit' });

        auditResults.push(`[Prism 质量分析]\n${prismAudit}`);
      } catch (err: any) {
        auditResults.push(`[Prism] 分析失败：${err.message}`);
      }
      emitEvent({ type: 'agent_active', agentId: 'prism', action: 'idle', workflowId });
    }

    const auditFeedback = auditResults.join('\n\n');
    for (const task of tasks) {
      db.updateTask(task.id, {
        meta_audit_feedback: auditFeedback,
        status: 'audited',
      });
    }
  }

  // ============================================================
  // Stage 6: Revision
  // ============================================================
  private async runRevision(workflowId: string): Promise<void> {
    this.emitStage(workflowId, 'revision');

    const tasks = db.getTasksByWorkflow(workflowId).filter((task) => task.status === 'audited');
    const needsRevision = tasks.filter((task) => (task.total_score || 0) < 16);
    const passed = tasks.filter((task) => (task.total_score || 0) >= 16);

    for (const task of passed) {
      db.updateTask(task.id, { status: 'passed' });
      emitEvent({
        type: 'task_update',
        workflowId,
        taskId: task.id,
        workerId: task.worker_id,
        status: 'passed',
      });
    }

    if (needsRevision.length === 0) {
      console.log(`[Workflow] ${workflowId}: all tasks passed review, skip revision`);
      return;
    }

    await Promise.all(
      needsRevision.map(async (task) => {
        const worker = registry.get(task.worker_id);
        if (!worker) return;

        emitEvent({
          type: 'agent_active',
          agentId: task.worker_id,
          action: 'revising',
          workflowId,
        });
        db.updateTask(task.id, { status: 'revising' });
        emitEvent({
          type: 'task_update',
          workflowId,
          taskId: task.id,
          workerId: task.worker_id,
          status: 'revising',
        });

        try {
          const combinedFeedback = [
            task.manager_feedback ? `经理反馈：${task.manager_feedback}` : '',
            task.meta_audit_feedback ? `元审计反馈：${task.meta_audit_feedback}` : '',
          ]
            .filter(Boolean)
            .join('\n\n');

          const revised = await worker.invoke(`请根据反馈修改你的上一版交付物。

原始任务：
${task.description}

你的 v1 交付物：
${task.deliverable}

当前评分：
${task.total_score}/20

收到的反馈：
${combinedFeedback}

请输出完整的 v2 版本，重点修正被指出的问题。`, undefined, { workflowId, stage: 'revision' });

          db.updateTask(task.id, {
            deliverable_v2: revised,
            version: 2,
            status: 'submitted',
          });

          await messageBus.send(
            task.worker_id,
            task.manager_id,
            revised,
            workflowId,
            'revision',
            { taskId: task.id, version: 2 }
          );

          emitEvent({
            type: 'task_update',
            workflowId,
            taskId: task.id,
            workerId: task.worker_id,
            status: 'submitted',
          });
        } catch (err: any) {
          console.error(`[Workflow] Revision failed for ${task.worker_id}:`, err.message);
          db.updateTask(task.id, { status: 'passed' });
        }

        emitEvent({
          type: 'agent_active',
          agentId: task.worker_id,
          action: 'idle',
          workflowId,
        });
      })
    );
  }

  // ============================================================
  // Stage 7: Verify
  // ============================================================
  private async runVerify(workflowId: string): Promise<void> {
    this.emitStage(workflowId, 'verify');

    const tasks = db
      .getTasksByWorkflow(workflowId)
      .filter((task) => task.status === 'submitted' && task.version === 2);

    if (tasks.length === 0) return;

    await Promise.all(
      tasks.map(async (task) => {
        const manager = registry.get(task.manager_id);
        if (!manager) {
          db.updateTask(task.id, { status: 'passed' });
          return;
        }

        emitEvent({
          type: 'agent_active',
          agentId: task.manager_id,
          action: 'verifying',
          workflowId,
        });

        try {
          const result = await manager.invokeJson<VerifyResult>(`请检查修订版交付物是否真正回应了反馈。

原始反馈：
${task.manager_feedback || '(无经理反馈)'}

修订版交付物：
${task.deliverable_v2}

只输出 JSON：
{
  "items": [
    {
      "point": "某个反馈点",
      "addressed": true,
      "comment": "说明是否已处理到位"
    }
  ],
  "unaddressed_ratio": 0.0,
  "verdict": "pass"
}`, undefined, { workflowId, stage: 'verify' });

          db.updateTask(task.id, {
            verify_result: result,
            status:
              result.verdict === 'pass' || (result.unaddressed_ratio || 0) <= 0.3
                ? 'passed'
                : 'verified',
          });

          if (
            result.verdict === 'needs_v3' &&
            (result.unaddressed_ratio || 0) > 0.3 &&
            !task.deliverable_v3
          ) {
            const worker = registry.get(task.worker_id);
            if (worker) {
              const unresolved = result.items
                .filter((item) => !item.addressed)
                .map((item) => `- ${item.point}: ${item.comment}`)
                .join('\n');

              const v3 = await worker.invoke(`你的 v2 版本仍有部分反馈没有解决，请继续修订。

未解决的反馈点：
${unresolved}

你的 v2 版本：
${task.deliverable_v2}

请输出完整的 v3 版本。`, undefined, { workflowId, stage: 'verify' });

              db.updateTask(task.id, {
                deliverable_v3: v3,
                version: 3,
                status: 'passed',
              });
            }
          } else {
            db.updateTask(task.id, { status: 'passed' });
          }
        } catch (err: any) {
          console.error(`[Workflow] Verify failed for task ${task.id}:`, err.message);
          db.updateTask(task.id, { status: 'passed' });
        }

        emitEvent({
          type: 'agent_active',
          agentId: task.manager_id,
          action: 'idle',
          workflowId,
        });
      })
    );
  }

  // ============================================================
  // Stage 8: Summary
  // ============================================================
  private async runSummary(workflowId: string): Promise<void> {
    this.emitStage(workflowId, 'summary');

    const wf = db.getWorkflow(workflowId);
    if (!wf) return;

    const departments = wf.departments_involved || [];
    const summaries: string[] = [];
    const departmentReports: Array<{
      manager_id: string;
      manager_name: string;
      department: string;
      summary: string;
      task_count: number;
      average_score: number | null;
      report_json_path: string;
      report_markdown_path: string;
    }> = [];

    await Promise.all(
      departments.map(async (deptId: string) => {
        const manager = registry.getManagerByDepartment(deptId);
        if (!manager) return;

        emitEvent({
          type: 'agent_active',
          agentId: manager.config.id,
          action: 'summarizing',
          workflowId,
        });

        const deptTasks = db
          .getTasksByWorkflow(workflowId)
          .filter((task) => task.department === deptId);

        const taskResults = deptTasks
          .map(
            (task) =>
              `Worker: ${task.worker_id}
任务：${task.description}
评分：${task.total_score}/20
交付物：
${bestDeliverable(task)}`
          )
          .join('\n\n---\n\n');

        try {
          const summary = await manager.invoke(`请向 CEO 汇总你们部门的执行结果。

部门任务结果：
${taskResults}

请写一份简洁但完整的总结，包含：
1. 本部门完成了什么
2. 最重要的成果
3. 还存在什么问题或风险
4. 后续建议`, undefined, { workflowId, stage: 'summary' });

          summaries.push(`## ${deptId} 部门（${manager.config.name}）\n\n${summary}`);

          await messageBus.send(manager.config.id, 'ceo', summary, workflowId, 'summary');

          const departmentReport = reportStore.buildDepartmentReport(
            wf,
            {
              id: manager.config.id,
              name: manager.config.name,
              department: deptId,
            },
            summary,
            deptTasks
          );
          const savedReport = reportStore.saveDepartmentReport(departmentReport);
          departmentReports.push({
            manager_id: manager.config.id,
            manager_name: manager.config.name,
            department: deptId,
            summary,
            task_count: deptTasks.length,
            average_score: departmentReport.stats.averageScore,
            report_json_path: savedReport.jsonPath,
            report_markdown_path: savedReport.markdownPath,
          });
        } catch (err: any) {
          summaries.push(`## ${deptId} 部门\n\n汇总生成失败：${err.message}`);
        }

        emitEvent({
          type: 'agent_active',
          agentId: manager.config.id,
          action: 'idle',
          workflowId,
        });
      })
    );

    db.updateWorkflow(workflowId, {
      results: {
        ...(wf.results || {}),
        summaries: summaries.join('\n\n'),
        department_reports: departmentReports,
      },
    });
  }

  // ============================================================
  // Stage 9: Feedback
  // ============================================================
  private async runFeedback(workflowId: string): Promise<void> {
    this.emitStage(workflowId, 'feedback');

    const ceo = registry.getCEO();
    if (!ceo) return;

    emitEvent({ type: 'agent_active', agentId: 'ceo', action: 'evaluating', workflowId });

    const wf = db.getWorkflow(workflowId);
    const summaryMessages = db
      .getMessagesByWorkflow(workflowId)
      .filter((message) => message.stage === 'summary' && message.to_agent === 'ceo');

    const summaryText = summaryMessages
      .map((message) => `[${message.from_agent}]\n${message.content}`)
      .join('\n\n---\n\n');

    try {
      const feedback = await ceo.invoke(`各部门已经提交总结，请给出整体复盘意见。

原始用户指令：
${wf?.directive}

部门汇总：
${summaryText}

请给出：
1. 整体判断
2. 各部门表现亮点
3. 当前短板或风险
4. 下一步行动建议`, undefined, { workflowId, stage: 'feedback' });

      const results = wf?.results || {};
      db.updateWorkflow(workflowId, {
        results: {
          ...results,
          ceo_feedback: feedback,
        },
      });

      const departments = wf?.departments_involved || [];
      for (const deptId of departments) {
        const manager = registry.getManagerByDepartment(deptId as string);
        if (manager) {
          await messageBus.send('ceo', manager.config.id, feedback, workflowId, 'feedback');
        }
      }
    } catch (err: any) {
      console.error('[Workflow] CEO feedback failed:', err.message);
    }

    emitEvent({ type: 'agent_active', agentId: 'ceo', action: 'idle', workflowId });
  }

  // ============================================================
  // Stage 10: Evolution
  // ============================================================
  private async runEvolution(workflowId: string): Promise<void> {
    this.emitStage(workflowId, 'evolution');

    const tasks = db.getTasksByWorkflow(workflowId);
    const agentScores = new Map<string, TaskRow[]>();

    for (const task of tasks) {
      if (task.total_score === null) continue;
      const list = agentScores.get(task.worker_id) || [];
      list.push(task);
      agentScores.set(task.worker_id, list);
    }

    for (const [agentId, scores] of Array.from(agentScores.entries())) {
      const dims = ['accuracy', 'completeness', 'actionability', 'format'] as const;
      const weakDims: string[] = [];

      for (const dim of dims) {
        const key = `score_${dim}` as keyof TaskRow;
        const avg =
          scores.reduce((sum: number, task: TaskRow) => sum + ((task[key] as number) || 0), 0) /
          scores.length;

        if (avg < 3) {
          weakDims.push(dim);
          db.createEvolutionLog({
            agent_id: agentId,
            workflow_id: workflowId,
            dimension: dim,
            old_score: avg,
            new_score: null,
            patch_content: `Weak in ${dim}: avg score ${avg.toFixed(1)}/5`,
            applied: 0,
          });
        }
      }

      if (weakDims.length > 0) {
        const agent = db.getAgent(agentId);
        if (agent?.soul_md) {
          const patch = `\n\n## Learned Behaviors (Auto-evolved)\n${weakDims
            .map((dim) => `- 需要继续强化 ${dim} 维度的表现`)
            .join('\n')}`;
          const newSoul = agent.soul_md + patch;
          db.updateAgentSoul(agentId, newSoul);
          registry.refresh(agentId);

          console.log(
            `[Evolution] ${agentId}: patched SOUL.md for weak dims: ${weakDims.join(', ')}`
          );
        }
      }
    }
  }

  private persistFinalReport(workflowId: string): void {
    const workflow = db.getWorkflow(workflowId);
    if (!workflow) return;

    const tasks = db.getTasksByWorkflow(workflowId);
    const messages = db.getMessagesByWorkflow(workflowId);
    const scoredTasks = tasks.filter((task) => task.total_score !== null);
    const averageScore =
      scoredTasks.length > 0
        ? scoredTasks.reduce((sum, task) => sum + (task.total_score || 0), 0) / scoredTasks.length
        : null;

    const departmentReports = Array.isArray(workflow.results?.department_reports)
      ? workflow.results.department_reports
      : [];

    const keyIssues = tasks
      .filter((task) => task.status === 'failed' || (task.total_score || 0) < 16)
      .flatMap((task) => {
        const items: string[] = [];
        if (task.total_score !== null && task.total_score < 16) {
          items.push(
            `${task.worker_id} scored ${task.total_score}/20 on task ${task.id}: ${task.description}`
          );
        }
        if (task.manager_feedback) {
          items.push(`Manager feedback for task ${task.id}: ${task.manager_feedback}`);
        }
        return items;
      })
      .slice(0, 12);

    const report: FinalWorkflowReport = {
      kind: 'final_workflow_report',
      version: 1,
      workflowId,
      generatedAt: new Date().toISOString(),
      workflow: {
        directive: workflow.directive,
        status: workflow.status,
        currentStage: workflow.current_stage,
        startedAt: workflow.started_at,
        completedAt: workflow.completed_at,
        departmentsInvolved: workflow.departments_involved || [],
      },
      stats: {
        messageCount: messages.length,
        taskCount: tasks.length,
        passedTaskCount: tasks.filter((task) => task.status === 'passed').length,
        revisedTaskCount: tasks.filter((task) => task.version > 1).length,
        averageScore,
      },
      departmentReports: departmentReports.map((item: any) => ({
        managerId: item.manager_id,
        managerName: item.manager_name,
        department: item.department,
        summary: item.summary,
        taskCount: item.task_count,
        averageScore: item.average_score,
        reportJsonPath: item.report_json_path,
        reportMarkdownPath: item.report_markdown_path,
      })),
      ceoFeedback: workflow.results?.ceo_feedback || '',
      keyIssues,
      tasks: tasks.map((task) => ({
        id: task.id,
        department: task.department,
        workerId: task.worker_id,
        managerId: task.manager_id,
        status: task.status,
        totalScore: task.total_score,
        description: task.description,
        deliverablePreview: bestDeliverable(task).substring(0, 800),
      })),
    };

    const savedReport = reportStore.saveFinalWorkflowReport(report);
    db.updateWorkflow(workflowId, {
      results: {
        ...(workflow.results || {}),
        final_report: {
          generated_at: report.generatedAt,
          json_path: savedReport.jsonPath,
          markdown_path: savedReport.markdownPath,
          overview: {
            department_count: report.departmentReports.length,
            task_count: report.stats.taskCount,
            passed_task_count: report.stats.passedTaskCount,
            average_score: report.stats.averageScore,
            message_count: report.stats.messageCount,
          },
        },
      },
    });
  }
}

export const workflowEngine = new WorkflowEngine();
