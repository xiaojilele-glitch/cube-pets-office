import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ClarificationAnswer,
  ClarificationQuestion,
} from "../../../shared/nl-command/contracts.js";
import { AuditTrail } from "../../core/nl-command/audit-trail.js";
import { ClarificationDialogManager } from "../../core/nl-command/clarification-dialog.js";

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(
  __test_dirname,
  "../../../data/__test_clarification__/nl-audit.json"
);

function makeQuestions(): ClarificationQuestion[] {
  return [
    {
      questionId: "q-1",
      text: "What is the target module?",
      type: "free_text",
    },
    {
      questionId: "q-2",
      text: "Which deployment strategy?",
      type: "single_choice",
      options: ["blue-green", "canary", "rolling"],
    },
  ];
}

function makeFreeTextAnswer(
  questionId: string,
  text: string
): ClarificationAnswer {
  return { questionId, text, timestamp: Date.now() };
}

function makeSelectionAnswer(
  questionId: string,
  text: string,
  selectedOptions: string[]
): ClarificationAnswer {
  return { questionId, text, selectedOptions, timestamp: Date.now() };
}

describe("ClarificationDialogManager", () => {
  let auditTrail: AuditTrail;
  let manager: ClarificationDialogManager;

  beforeEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    auditTrail = new AuditTrail(TEST_AUDIT_PATH);
    manager = new ClarificationDialogManager({ auditTrail });
  });

  afterEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("createDialog()", () => {
    it("should create a dialog with the given questions", async () => {
      const questions = makeQuestions();
      const dialog = await manager.createDialog("cmd-1", questions);

      expect(dialog.dialogId).toBeTruthy();
      expect(dialog.commandId).toBe("cmd-1");
      expect(dialog.questions).toEqual(questions);
      expect(dialog.answers).toEqual([]);
      expect(dialog.clarificationRounds).toBe(0);
      expect(dialog.status).toBe("active");
    });

    it("should store the dialog for later retrieval", async () => {
      const dialog = await manager.createDialog("cmd-1", makeQuestions());
      const retrieved = manager.getDialog(dialog.dialogId);
      expect(retrieved).toBe(dialog);
    });

    it("should record an audit entry on creation", async () => {
      await manager.createDialog("cmd-1", makeQuestions());
      const entries = await auditTrail.query({
        operationType: "clarification_question",
      });
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[0].entityId).toBe("cmd-1");
    });
  });

  describe("addAnswer()", () => {
    it("should accept a free-text answer", async () => {
      const dialog = await manager.createDialog("cmd-1", makeQuestions());
      const answer = makeFreeTextAnswer("q-1", "The payment module");
      const updated = await manager.addAnswer(dialog.dialogId, answer);

      expect(updated.answers).toHaveLength(1);
      expect(updated.answers[0].text).toBe("The payment module");
      expect(updated.answers[0].selectedOptions).toBeUndefined();
    });

    it("should accept a selection-based answer", async () => {
      const dialog = await manager.createDialog("cmd-1", makeQuestions());
      const answer = makeSelectionAnswer("q-2", "canary", ["canary"]);
      const updated = await manager.addAnswer(dialog.dialogId, answer);

      expect(updated.answers).toHaveLength(1);
      expect(updated.answers[0].selectedOptions).toEqual(["canary"]);
    });

    it("should mark dialog as completed when all questions are answered", async () => {
      const dialog = await manager.createDialog("cmd-1", makeQuestions());

      await manager.addAnswer(
        dialog.dialogId,
        makeFreeTextAnswer("q-1", "payment module")
      );
      expect(dialog.status).toBe("active");

      await manager.addAnswer(
        dialog.dialogId,
        makeSelectionAnswer("q-2", "canary", ["canary"])
      );
      expect(dialog.status).toBe("completed");
      expect(dialog.clarificationRounds).toBe(1);
    });

    it("should throw when dialog does not exist", async () => {
      const answer = makeFreeTextAnswer("q-1", "test");
      await expect(manager.addAnswer("nonexistent", answer)).rejects.toThrow(
        "Dialog not found"
      );
    });

    it("should record an audit entry for each answer", async () => {
      const dialog = await manager.createDialog("cmd-1", makeQuestions());
      await manager.addAnswer(
        dialog.dialogId,
        makeFreeTextAnswer("q-1", "payment")
      );
      await manager.addAnswer(
        dialog.dialogId,
        makeSelectionAnswer("q-2", "canary", ["canary"])
      );

      const entries = await auditTrail.query({
        operationType: "clarification_answer",
      });
      expect(entries).toHaveLength(2);
    });
  });

  describe("isComplete()", () => {
    it("should return false when no answers exist", async () => {
      const dialog = await manager.createDialog("cmd-1", makeQuestions());
      expect(manager.isComplete(dialog)).toBe(false);
    });

    it("should return false when only some questions are answered", async () => {
      const dialog = await manager.createDialog("cmd-1", makeQuestions());
      await manager.addAnswer(
        dialog.dialogId,
        makeFreeTextAnswer("q-1", "test")
      );
      // Re-fetch to check state before completion
      const current = manager.getDialog(dialog.dialogId)!;
      // Only q-1 answered, q-2 still pending — but addAnswer already checked isComplete
      // Let's check with a fresh dialog that has partial answers
      const freshDialog = await manager.createDialog("cmd-2", makeQuestions());
      freshDialog.answers.push(makeFreeTextAnswer("q-1", "test"));
      expect(manager.isComplete(freshDialog)).toBe(false);
    });

    it("should return true when all questions are answered", async () => {
      const dialog = await manager.createDialog("cmd-1", makeQuestions());
      dialog.answers.push(makeFreeTextAnswer("q-1", "test"));
      dialog.answers.push(makeSelectionAnswer("q-2", "canary", ["canary"]));
      expect(manager.isComplete(dialog)).toBe(true);
    });

    it("should return true for a dialog with no questions", async () => {
      const dialog = await manager.createDialog("cmd-1", []);
      expect(manager.isComplete(dialog)).toBe(true);
    });
  });

  describe("getDialog()", () => {
    it("should return undefined for unknown dialogId", () => {
      expect(manager.getDialog("nonexistent")).toBeUndefined();
    });

    it("should return the correct dialog", async () => {
      const d1 = await manager.createDialog("cmd-1", makeQuestions());
      const d2 = await manager.createDialog("cmd-2", []);

      expect(manager.getDialog(d1.dialogId)?.commandId).toBe("cmd-1");
      expect(manager.getDialog(d2.dialogId)?.commandId).toBe("cmd-2");
    });
  });
});
