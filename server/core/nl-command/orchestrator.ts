/**
 * NL Command Orchestrator
 *
 * Wires the complete NL Command Center flow:
 *   command submit → analyze → clarify → decompose → plan generate → approve → execute → monitor
 *
 * Manages StrategicCommand lifecycle state machine and delegates to sub-services.
 *
 * @see Requirements: All
 */

import { randomUUID } from "node:crypto";

import type {
  AdjustmentChange,
  AdjustmentImpact,
  ClarificationAnswer,
  ClarificationDialog,
  CommandAnalysis,
  CommandConstraint,
  CommandPriority,
  CommandStatus,
  CommandTimeframe,
  FinalizedCommand,
  MissionDecomposition,
  NLExecutionPlan,
  PlanAdjustment,
  PlanApprovalRequest,
  StrategicCommand,
  TaskDecomposition,
} from "../../../shared/nl-command/contracts.js";
import type { DashboardResponse } from "../../../shared/nl-command/api.js";

import type { CommandAnalyzer } from "./command-analyzer.js";
import type { ClarificationDialogManager } from "./clarification-dialog.js";
import type { MissionDecomposer } from "./mission-decomposer.js";
import type { TaskDecomposer } from "./task-decomposer.js";
import type { ExecutionPlanGenerator } from "./execution-plan-generator.js";
import type { PlanApproval } from "./plan-approval.js";
import type { PlanAdjustmentManager } from "./plan-adjustment.js";
import type { AlertEngine } from "./alert-engine.js";
import type { DecisionSupportEngine } from "./decision-support.js";
import type { CommentManager } from "./comment-manager.js";
import type { ReportGenerator } from "./report-generator.js";
import type { TemplateManager } from "./template-manager.js";
import type { AuditTrail } from "./audit-trail.js";
import type { PermissionGuard } from "./permission-guard.js";
import type { NLCommandSocketEmitter } from "./socket-emitter.js";

// ─── Options ───

export interface NLCommandOrchestratorOptions {
  commandAnalyzer: CommandAnalyzer;
  clarificationDialogManager: ClarificationDialogManager;
  missionDecomposer: MissionDecomposer;
  taskDecomposer: TaskDecomposer;
  executionPlanGenerator: ExecutionPlanGenerator;
  planApproval: PlanApproval;
  planAdjustmentManager: PlanAdjustmentManager;
  alertEngine: AlertEngine;
  decisionSupportEngine: DecisionSupportEngine;
  commentManager: CommentManager;
  reportGenerator: ReportGenerator;
  templateManager: TemplateManager;
  auditTrail: AuditTrail;
  permissionGuard: PermissionGuard;
  socketEmitter?: NLCommandSocketEmitter;
}

// ─── Filter type for listCommands ───

export interface CommandFilter {
  status?: CommandStatus;
  priority?: CommandPriority;
  userId?: string;
}

// ─── Orchestrator ───

export class NLCommandOrchestrator {
  // Sub-services
  private readonly commandAnalyzer: CommandAnalyzer;
  private readonly clarificationDialogManager: ClarificationDialogManager;
  private readonly missionDecomposer: MissionDecomposer;
  private readonly taskDecomposer: TaskDecomposer;
  private readonly executionPlanGenerator: ExecutionPlanGenerator;
  private readonly planApproval: PlanApproval;
  private readonly planAdjustmentManager: PlanAdjustmentManager;
  private readonly auditTrail: AuditTrail;
  private readonly socketEmitter?: NLCommandSocketEmitter;

  // Delegated sub-services (public pass-through)
  readonly alertEngine: AlertEngine;
  readonly decisionSupportEngine: DecisionSupportEngine;
  readonly commentManager: CommentManager;
  readonly reportGenerator: ReportGenerator;
  readonly templateManager: TemplateManager;
  readonly permissionGuard: PermissionGuard;

  // In-memory stores
  private readonly commands = new Map<string, StrategicCommand>();
  private readonly analyses = new Map<string, CommandAnalysis>();
  private readonly dialogs = new Map<string, ClarificationDialog>();
  private readonly finalized = new Map<string, FinalizedCommand>();
  private readonly decompositions = new Map<string, MissionDecomposition>();
  private readonly taskDecompositions = new Map<string, TaskDecomposition[]>();
  private readonly plans = new Map<string, NLExecutionPlan>();
  /** commandId → planId mapping */
  private readonly commandPlanMap = new Map<string, string>();

  constructor(options: NLCommandOrchestratorOptions) {
    this.commandAnalyzer = options.commandAnalyzer;
    this.clarificationDialogManager = options.clarificationDialogManager;
    this.missionDecomposer = options.missionDecomposer;
    this.taskDecomposer = options.taskDecomposer;
    this.executionPlanGenerator = options.executionPlanGenerator;
    this.planApproval = options.planApproval;
    this.planAdjustmentManager = options.planAdjustmentManager;
    this.auditTrail = options.auditTrail;
    this.socketEmitter = options.socketEmitter;

    this.alertEngine = options.alertEngine;
    this.decisionSupportEngine = options.decisionSupportEngine;
    this.commentManager = options.commentManager;
    this.reportGenerator = options.reportGenerator;
    this.templateManager = options.templateManager;
    this.permissionGuard = options.permissionGuard;
  }

  // ─── Command Lifecycle ───

  /**
   * Submit a new strategic command.
   *
   * State: draft → analyzing → clarifying | finalized
   */
  async submitCommand(
    text: string,
    userId: string,
    priority?: CommandPriority,
    constraints?: CommandConstraint[],
    objectives?: string[],
    timeframe?: CommandTimeframe
  ): Promise<{
    command: StrategicCommand;
    analysis: CommandAnalysis;
    needsClarification: boolean;
  }> {
    // Create command in draft state
    const command: StrategicCommand = {
      commandId: randomUUID(),
      commandText: text,
      userId,
      timestamp: Date.now(),
      status: "draft",
      constraints: constraints ?? [],
      objectives: objectives ?? [],
      priority: priority ?? "medium",
      timeframe,
    };

    this.commands.set(command.commandId, command);

    // Transition: draft → analyzing
    this.transitionStatus(command, "analyzing");

    // Record audit
    await this.auditTrail.record({
      entryId: randomUUID(),
      operationType: "command_created",
      operator: userId,
      content: `Strategic command submitted: "${text}"`,
      timestamp: Date.now(),
      result: "success",
      entityId: command.commandId,
      entityType: "command",
    });

    this.socketEmitter?.emitCommandCreated(command);

    // Analyze
    const analysis = await this.commandAnalyzer.analyze(command);
    this.analyses.set(command.commandId, analysis);
    command.parsedIntent = analysis.intent;

    this.socketEmitter?.emitCommandAnalysis(command.commandId, analysis);

    if (analysis.needsClarification) {
      // Transition: analyzing → clarifying
      this.transitionStatus(command, "clarifying");

      const questions =
        await this.commandAnalyzer.generateClarificationQuestions(
          command,
          analysis
        );
      const dialog = await this.clarificationDialogManager.createDialog(
        command.commandId,
        questions
      );
      this.dialogs.set(command.commandId, dialog);

      this.socketEmitter?.emitClarificationQuestion(
        command.commandId,
        questions
      );

      return { command, analysis, needsClarification: true };
    }

    // No clarification needed → finalize directly
    // Transition: analyzing → finalized
    this.transitionStatus(command, "finalized");

    const finalizedCmd = await this.commandAnalyzer.finalize(command, analysis);
    this.finalized.set(command.commandId, finalizedCmd);

    return { command, analysis, needsClarification: false };
  }

  /**
   * Submit a clarification answer.
   *
   * State: clarifying → finalized (when dialog complete)
   */
  async submitClarification(
    commandId: string,
    answer: ClarificationAnswer
  ): Promise<{
    dialog: ClarificationDialog;
    updatedAnalysis: CommandAnalysis;
    isComplete: boolean;
    finalized?: FinalizedCommand;
  }> {
    const command = this.commands.get(commandId);
    if (!command) throw new Error(`Command not found: ${commandId}`);

    const dialog = this.dialogs.get(commandId);
    if (!dialog) throw new Error(`No active dialog for command: ${commandId}`);

    const analysis = this.analyses.get(commandId);
    if (!analysis) throw new Error(`No analysis for command: ${commandId}`);

    // Add answer to dialog
    const updatedDialog = await this.clarificationDialogManager.addAnswer(
      dialog.dialogId,
      answer
    );
    this.dialogs.set(commandId, updatedDialog);

    // Update analysis with the answer
    const updatedAnalysis = await this.commandAnalyzer.updateAnalysis(
      command,
      analysis,
      answer
    );
    this.analyses.set(commandId, updatedAnalysis);

    const isComplete = updatedDialog.status === "completed";

    if (isComplete) {
      // Transition: clarifying → finalized
      this.transitionStatus(command, "finalized");

      const finalizedCmd = await this.commandAnalyzer.finalize(
        command,
        updatedAnalysis
      );
      this.finalized.set(commandId, finalizedCmd);

      return {
        dialog: updatedDialog,
        updatedAnalysis,
        isComplete: true,
        finalized: finalizedCmd,
      };
    }

    return { dialog: updatedDialog, updatedAnalysis, isComplete: false };
  }

  /**
   * Get a command and its associated data.
   */
  async getCommand(commandId: string): Promise<{
    command: StrategicCommand;
    analysis?: CommandAnalysis;
    finalized?: FinalizedCommand;
    decomposition?: MissionDecomposition;
    plan?: NLExecutionPlan;
  }> {
    const command = this.commands.get(commandId);
    if (!command) throw new Error(`Command not found: ${commandId}`);

    const planId = this.commandPlanMap.get(commandId);

    return {
      command,
      analysis: this.analyses.get(commandId),
      finalized: this.finalized.get(commandId),
      decomposition: this.decompositions.get(commandId),
      plan: planId ? this.plans.get(planId) : undefined,
    };
  }

  /**
   * List commands with optional filtering.
   */
  listCommands(filter?: CommandFilter): StrategicCommand[] {
    let result = Array.from(this.commands.values());

    if (filter?.status) {
      result = result.filter(c => c.status === filter.status);
    }
    if (filter?.priority) {
      result = result.filter(c => c.priority === filter.priority);
    }
    if (filter?.userId) {
      result = result.filter(c => c.userId === filter.userId);
    }

    // Sort by timestamp descending (newest first)
    result.sort((a, b) => b.timestamp - a.timestamp);
    return result;
  }

  // ─── Decomposition & Planning ───

  /**
   * Decompose a finalized command into missions and tasks, then generate an execution plan.
   *
   * State: finalized → decomposing → planning → approving
   */
  async decomposeAndPlan(commandId: string): Promise<{
    decomposition: MissionDecomposition;
    taskDecompositions: TaskDecomposition[];
    plan: NLExecutionPlan;
  }> {
    const command = this.commands.get(commandId);
    if (!command) throw new Error(`Command not found: ${commandId}`);

    const finalizedCmd = this.finalized.get(commandId);
    if (!finalizedCmd) throw new Error(`Command not finalized: ${commandId}`);

    // Transition: finalized → decomposing
    this.transitionStatus(command, "decomposing");

    // Mission decomposition
    const decomposition = await this.missionDecomposer.decompose(finalizedCmd);
    this.decompositions.set(commandId, decomposition);

    // Task decomposition for each mission
    const taskDecomps: TaskDecomposition[] = [];
    for (const mission of decomposition.missions) {
      const taskDecomp = await this.taskDecomposer.decompose(
        mission,
        decomposition
      );
      taskDecomps.push(taskDecomp);
    }
    this.taskDecompositions.set(commandId, taskDecomps);

    this.socketEmitter?.emitDecompositionComplete(commandId, decomposition);

    // Transition: decomposing → planning
    this.transitionStatus(command, "planning");

    // Generate execution plan
    const plan = await this.executionPlanGenerator.generate(
      finalizedCmd,
      decomposition,
      taskDecomps
    );
    this.plans.set(plan.planId, plan);
    this.commandPlanMap.set(commandId, plan.planId);

    this.socketEmitter?.emitPlanGenerated(commandId, plan);

    // Transition: planning → approving
    this.transitionStatus(command, "approving");

    return { decomposition, taskDecompositions: taskDecomps, plan };
  }

  // ─── Approval ───

  /**
   * Create an approval request for a plan.
   */
  async createApproval(
    planId: string,
    approvers?: string[]
  ): Promise<PlanApprovalRequest> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);

    return this.planApproval.createApprovalRequest(plan, approvers);
  }

  /**
   * Submit an approval decision.
   *
   * State: approving → executing (when fully approved)
   */
  async submitApproval(
    requestId: string,
    approverId: string,
    decision: "approved" | "rejected" | "revision_requested",
    comments?: string
  ): Promise<PlanApprovalRequest> {
    const request = await this.planApproval.submitApproval(
      requestId,
      approverId,
      decision,
      comments
    );

    if (request.status === "approved") {
      const plan = this.plans.get(request.planId);
      if (plan) {
        plan.status = "approved";

        // Find the command for this plan and transition to executing
        const entries = Array.from(this.commandPlanMap.entries());
        for (const [cmdId, pId] of entries) {
          if (pId === request.planId) {
            const cmd = this.commands.get(cmdId);
            if (cmd) {
              this.transitionStatus(cmd, "executing");
            }
            break;
          }
        }

        this.socketEmitter?.emitPlanApproved(
          request.planId,
          request.approvals.map(a => a.approverId)
        );
      }
    }

    return request;
  }

  // ─── Plan Management ───

  /**
   * Get a plan by ID.
   */
  getPlan(planId: string): NLExecutionPlan | undefined {
    return this.plans.get(planId);
  }

  /**
   * Adjust a plan with proposed changes.
   */
  async adjustPlan(
    planId: string,
    reason: string,
    changes: AdjustmentChange[]
  ): Promise<{ adjustment: PlanAdjustment; updatedPlan: NLExecutionPlan }> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);

    const impact: AdjustmentImpact = {
      timelineImpact: "To be assessed",
      costImpact: "To be assessed",
      riskImpact: "To be assessed",
    };

    // Propose adjustment (no approval required for orchestrator-driven adjustments)
    const adjustment = await this.planAdjustmentManager.proposeAdjustment(
      planId,
      reason,
      changes,
      impact,
      false // no approval required
    );

    // Apply immediately
    const applied = await this.planAdjustmentManager.applyAdjustment(
      adjustment.adjustmentId,
      plan
    );

    this.socketEmitter?.emitPlanAdjusted(planId, applied);

    return { adjustment: applied, updatedPlan: plan };
  }

  // ─── Monitoring ───

  /**
   * Get dashboard metrics aggregated from all commands and plans.
   */
  getDashboard(): DashboardResponse {
    const allCommands = Array.from(this.commands.values());
    const activeStatuses: CommandStatus[] = [
      "analyzing",
      "clarifying",
      "decomposing",
      "planning",
      "approving",
      "executing",
    ];
    const activeCommands = allCommands.filter(c =>
      activeStatuses.includes(c.status)
    );

    let totalMissions = 0;
    let completedMissions = 0;
    let totalTasks = 0;
    let completedTasks = 0;
    let totalBudget = 0;
    let totalSpent = 0;
    let highestRisk: DashboardResponse["overallRiskLevel"] = "low";

    const riskOrder: Record<string, number> = {
      low: 0,
      medium: 1,
      high: 2,
      critical: 3,
    };
    const recentAlerts: DashboardResponse["recentAlerts"] = [];

    const allPlans = Array.from(this.plans.values());
    for (const plan of allPlans) {
      totalMissions += plan.missions.length;
      totalTasks += plan.tasks.length;
      totalBudget += plan.costBudget.totalBudget;

      // Estimate spent from task costs
      const taskCostValues = Object.values(
        plan.costBudget.taskCosts
      ) as number[];
      const taskCostSum = taskCostValues.reduce(
        (s: number, c: number) => s + c,
        0
      );
      totalSpent += taskCostSum;

      if (plan.status === "completed") {
        completedMissions += plan.missions.length;
        completedTasks += plan.tasks.length;
      }

      const planRisk = plan.riskAssessment.overallRiskLevel;
      if (riskOrder[planRisk] > riskOrder[highestRisk]) {
        highestRisk = planRisk as DashboardResponse["overallRiskLevel"];
      }
    }

    const overallProgress = totalTasks === 0 ? 0 : completedTasks / totalTasks;

    return {
      totalCommands: allCommands.length,
      activeCommands: activeCommands.length,
      totalMissions,
      completedMissions,
      totalTasks,
      completedTasks,
      overallProgress,
      overallRiskLevel: highestRisk,
      recentAlerts,
      costSummary: {
        totalBudget,
        totalSpent,
        currency: "CNY",
      },
    };
  }

  // ─── Private: State Machine ───

  /**
   * Transition a command's status, enforcing valid transitions.
   */
  private transitionStatus(
    command: StrategicCommand,
    newStatus: CommandStatus
  ): void {
    const validTransitions: Record<CommandStatus, CommandStatus[]> = {
      draft: ["analyzing"],
      analyzing: ["clarifying", "finalized"],
      clarifying: ["finalized"],
      finalized: ["decomposing"],
      decomposing: ["planning"],
      planning: ["approving"],
      approving: ["executing"],
      executing: ["completed", "failed"],
      completed: [],
      failed: [],
      cancelled: [],
    };

    const allowed = validTransitions[command.status];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new Error(
        `Invalid status transition: ${command.status} → ${newStatus} for command ${command.commandId}`
      );
    }

    command.status = newStatus;
  }
}
