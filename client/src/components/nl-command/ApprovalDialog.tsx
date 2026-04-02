import { useState } from "react";

import type { NLExecutionPlan, PlanApprovalRequest } from "@shared/nl-command/contracts";

/**
 * Approval dialog for reviewing and submitting plan approval decisions.
 *
 * @see Requirements 7.3, 7.4
 */
export interface ApprovalDialogProps {
  plan: NLExecutionPlan;
  approval?: PlanApprovalRequest;
  onSubmit?: (decision: "approved" | "rejected" | "revision_requested", comments: string) => void;
}

export function ApprovalDialog({ plan, approval, onSubmit }: ApprovalDialogProps) {
  const [decision, setDecision] = useState<"approved" | "rejected" | "revision_requested">("approved");
  const [comments, setComments] = useState("");

  const handleSubmit = () => {
    onSubmit?.(decision, comments);
    setComments("");
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4">
      <div className="text-sm font-medium text-stone-800">
        Plan Approval — <span className="text-indigo-600">{plan.planId.slice(0, 8)}</span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs text-stone-500">
        <div>Missions: {plan.missions.length}</div>
        <div>Tasks: {plan.tasks.length}</div>
        <div>Status: {plan.status}</div>
      </div>

      {approval && (
        <div className="text-xs text-stone-500">
          Approvals: {approval.approvals.length}/{approval.requiredApprovers.length} ·
          Status: <span className="font-medium">{approval.status}</span>
        </div>
      )}

      {onSubmit && (
        <>
          <div className="flex gap-2">
            {(["approved", "rejected", "revision_requested"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDecision(d)}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  decision === d
                    ? "bg-indigo-100 text-indigo-700"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                }`}
              >
                {d.replace(/_/g, " ")}
              </button>
            ))}
          </div>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Comments (optional)"
            rows={2}
            className="w-full resize-none rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-700 placeholder:text-stone-400 focus:border-indigo-300 focus:outline-none"
          />
          <button
            onClick={handleSubmit}
            className="self-end rounded-md bg-indigo-600 px-4 py-1.5 text-xs text-white transition-colors hover:bg-indigo-700"
          >
            Submit
          </button>
        </>
      )}
    </div>
  );
}
