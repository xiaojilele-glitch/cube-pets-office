import { useEffect, useState } from "react";
import { Download, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Framework = "crewai" | "langgraph" | "autogen" | "all";

const FRAMEWORK_OPTIONS: { value: Framework; label: string }[] = [
  { value: "crewai", label: "CrewAI" },
  { value: "langgraph", label: "LangGraph" },
  { value: "autogen", label: "AutoGen" },
  { value: "all", label: "All" },
];

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
}

export function ExportDialog({
  open,
  onOpenChange,
  workflowId,
}: ExportDialogProps) {
  const [framework, setFramework] = useState<Framework>("crewai");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFramework("crewai");
      setExporting(false);
      setError(null);
    }
  }, [open]);

  async function handleExport() {
    if (exporting) return;

    setExporting(true);
    setError(null);

    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId, framework }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Export failed (${res.status})`);
      }

      const blob = await res.blob();
      const filename =
        res.headers
          .get("Content-Disposition")
          ?.match(/filename="?(.+?)"?$/)?.[1] ?? `cube-export-${framework}.zip`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-[28px] border-stone-200 bg-white/95 p-0 shadow-[0_24px_70px_rgba(112,84,51,0.16)]">
        <DialogHeader className="border-b border-stone-200/80 px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-stone-900">
            <Download className="size-4 text-amber-600" />
            Export to Other Frameworks
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-stone-500">
            Choose a target framework and download the generated project as a
            ZIP file.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 px-6 py-5">
          <p className="text-sm font-medium text-stone-700">Target Framework</p>
          <div className="grid grid-cols-2 gap-2">
            {FRAMEWORK_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                disabled={exporting}
                onClick={() => setFramework(opt.value)}
                className={`rounded-2xl border px-4 py-2 text-sm font-medium transition-colors ${
                  framework === opt.value
                    ? "border-amber-500 bg-amber-50 text-amber-700"
                    : "border-stone-200 bg-stone-50/80 text-stone-600 hover:border-stone-300"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="border-t border-stone-200/80 px-6 py-5">
          <Button
            type="button"
            variant="outline"
            className="rounded-full border-stone-200 bg-white/80"
            onClick={() => onOpenChange(false)}
            disabled={exporting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="rounded-full bg-[#d07a4f] text-white hover:bg-[#c26d42]"
            onClick={() => void handleExport()}
            disabled={exporting}
          >
            {exporting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {exporting ? "Exporting…" : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
