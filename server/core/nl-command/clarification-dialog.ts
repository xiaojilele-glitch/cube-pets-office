/**
 * 澄清对话管理器 (Clarification Dialog Manager)
 *
 * 管理指令澄清对话的生命周期：创建对话、添加回答、检查完成状态。
 * 支持自由文本和选择式回答，集成 AuditTrail 记录澄清过程。
 *
 * @see Requirements 2.1, 2.3, 2.6
 */

import type {
  ClarificationAnswer,
  ClarificationDialog,
  ClarificationQuestion,
} from '../../../shared/nl-command/contracts.js';
import { AuditTrail } from './audit-trail.js';

export interface ClarificationDialogManagerOptions {
  auditTrail: AuditTrail;
}

export class ClarificationDialogManager {
  private readonly dialogs = new Map<string, ClarificationDialog>();
  private readonly auditTrail: AuditTrail;

  constructor(options: ClarificationDialogManagerOptions) {
    this.auditTrail = options.auditTrail;
  }

  /**
   * 创建新的澄清对话。
   * @see Requirement 2.1
   */
  async createDialog(
    commandId: string,
    questions: ClarificationQuestion[],
  ): Promise<ClarificationDialog> {
    const dialogId = `dialog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const dialog: ClarificationDialog = {
      dialogId,
      commandId,
      questions,
      answers: [],
      clarificationRounds: 0,
      status: 'active',
    };

    this.dialogs.set(dialogId, dialog);

    await this.auditTrail.record({
      entryId: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operationType: 'clarification_question',
      operator: 'system',
      content: `Created clarification dialog with ${questions.length} questions`,
      timestamp: Date.now(),
      result: 'success',
      entityId: commandId,
      entityType: 'command',
      metadata: { dialogId, questionCount: questions.length },
    });

    return dialog;
  }

  /**
   * 添加澄清回答。支持自由文本（text）和选择式（selectedOptions）回答。
   * 当所有问题都已回答时，自动递增 clarificationRounds 并标记为 completed。
   * @see Requirement 2.3, 2.6
   */
  async addAnswer(
    dialogId: string,
    answer: ClarificationAnswer,
  ): Promise<ClarificationDialog> {
    const dialog = this.dialogs.get(dialogId);
    if (!dialog) {
      throw new Error(`Dialog not found: ${dialogId}`);
    }

    dialog.answers.push(answer);

    // Check if all questions have been answered
    if (this.isComplete(dialog)) {
      dialog.clarificationRounds += 1;
      dialog.status = 'completed';
    }

    await this.auditTrail.record({
      entryId: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operationType: 'clarification_answer',
      operator: 'user',
      content: `Answered question ${answer.questionId}${answer.selectedOptions?.length ? ' (selection)' : ' (free-text)'}`,
      timestamp: Date.now(),
      result: 'success',
      entityId: dialog.commandId,
      entityType: 'command',
      metadata: {
        dialogId,
        questionId: answer.questionId,
        answerType: answer.selectedOptions?.length ? 'selection' : 'free_text',
      },
    });

    return dialog;
  }

  /**
   * 检查对话是否已完成（所有问题都已回答）。
   */
  isComplete(dialog: ClarificationDialog): boolean {
    const answeredIds = new Set(dialog.answers.map((a) => a.questionId));
    return dialog.questions.every((q) => answeredIds.has(q.questionId));
  }

  /**
   * 根据 dialogId 获取对话。
   */
  getDialog(dialogId: string): ClarificationDialog | undefined {
    return this.dialogs.get(dialogId);
  }
}
