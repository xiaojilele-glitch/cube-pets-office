import { useEffect, useState } from "react";
import { LoaderCircle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type CreateMissionInput = {
  title?: string;
  sourceText?: string;
  kind?: string;
  topicId?: string;
};

export function CreateMissionDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreateMissionInput) => Promise<string | null>;
}) {
  const [title, setTitle] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [kind, setKind] = useState("chat");
  const [topicId, setTopicId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setSourceText("");
      setKind("chat");
      setTopicId("");
      setSubmitting(false);
    }
  }, [open]);

  const canSubmit = title.trim().length > 0 || sourceText.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    try {
      const missionId = await onCreate({
        title: title.trim() || undefined,
        sourceText: sourceText.trim() || undefined,
        kind: kind.trim() || undefined,
        topicId: topicId.trim() || undefined,
      });

      if (missionId) {
        onOpenChange(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-[28px] border-stone-200 bg-white/95 p-0 shadow-[0_24px_70px_rgba(112,84,51,0.16)]">
        <DialogHeader className="border-b border-stone-200/80 px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-stone-900">
            <Plus className="size-4 text-amber-600" />
            New Mission
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-stone-500">
            Create a mission directly from the Worktree A task API and open it in
            the mission workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 px-6 py-5">
          <div className="grid gap-2">
            <Label htmlFor="mission-title">Title</Label>
            <Input
              id="mission-title"
              value={title}
              onChange={event => setTitle(event.target.value)}
              placeholder="Short mission title"
              className="rounded-2xl border-stone-200 bg-stone-50/80"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="mission-source">Source Text</Label>
            <Textarea
              id="mission-source"
              value={sourceText}
              onChange={event => setSourceText(event.target.value)}
              placeholder="Describe the mission request, constraints, and desired outcome."
              className="min-h-32 rounded-[20px] border-stone-200 bg-stone-50/80 text-sm leading-6 text-stone-700"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="mission-kind">Kind</Label>
              <Input
                id="mission-kind"
                value={kind}
                onChange={event => setKind(event.target.value)}
                placeholder="chat"
                className="rounded-2xl border-stone-200 bg-stone-50/80"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="mission-topic">Topic / Thread</Label>
              <Input
                id="mission-topic"
                value={topicId}
                onChange={event => setTopicId(event.target.value)}
                placeholder="Optional topicId"
                className="rounded-2xl border-stone-200 bg-stone-50/80"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-stone-200/80 px-6 py-5">
          <Button
            type="button"
            variant="outline"
            className="rounded-full border-stone-200 bg-white/80"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="rounded-full bg-[#d07a4f] text-white hover:bg-[#c26d42]"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || submitting}
          >
            {submitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Create Mission
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
