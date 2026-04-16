/**
 * ExportDialog — Export format selection and report generation.
 *
 * Supports JSON, CSV, interactive HTML export.
 * Report generation with section selection and format choice.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4
 */

import { useCallback, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useReplayStore } from "@/lib/replay/replay-store-ui";
import { ReplayExporter } from "@/lib/replay/exporter";
import type { ReportSection } from "@/lib/replay/exporter";

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ExportFormat = "json" | "csv" | "html";
type ReportFormat = "html" | "markdown";

const ALL_SECTIONS: { id: ReportSection; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "events", label: "Events" },
  { id: "performance", label: "Performance" },
  { id: "cost", label: "Cost" },
  { id: "anomalies", label: "Anomalies" },
];

export function ExportDialog({ open, onOpenChange }: ExportDialogProps) {
  const timeline = useReplayStore(s => s.timeline);
  const [format, setFormat] = useState<ExportFormat>("json");
  const [reportFormat, setReportFormat] = useState<ReportFormat>("html");
  const [sections, setSections] = useState<Set<ReportSection>>(
    new Set<ReportSection>(["summary", "events"])
  );
  const [tab, setTab] = useState<"data" | "report">("data");

  const toggleSection = useCallback((id: ReportSection) => {
    setSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleExportData = useCallback(() => {
    if (!timeline) return;
    const exporter = new ReplayExporter();
    let content: string;
    let filename: string;
    let mime: string;

    switch (format) {
      case "json":
        content = exporter.exportJSON(timeline);
        filename = `replay-${timeline.missionId}.json`;
        mime = "application/json";
        break;
      case "csv":
        content = exporter.exportCSV(timeline);
        filename = `replay-${timeline.missionId}.csv`;
        mime = "text/csv";
        break;
      case "html":
        content = exporter.exportInteractiveHTML(timeline);
        filename = `replay-${timeline.missionId}.html`;
        mime = "text/html";
        break;
    }

    download(content, filename, mime);
    onOpenChange(false);
  }, [timeline, format, onOpenChange]);

  const handleExportReport = useCallback(() => {
    if (!timeline) return;
    const exporter = new ReplayExporter();
    const report = exporter.generateReport(timeline, {
      sections: Array.from(sections),
    });

    let content: string;
    let filename: string;
    let mime: string;

    if (reportFormat === "html") {
      content = exporter.exportReportHTML(report);
      filename = `report-${timeline.missionId}.html`;
      mime = "text/html";
    } else {
      content = exporter.exportReportMarkdown(report);
      filename = `report-${timeline.missionId}.md`;
      mime = "text/markdown";
    }

    download(content, filename, mime);
    onOpenChange(false);
  }, [timeline, sections, reportFormat, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1a1a2e] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Replay</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 rounded-md bg-white/10 p-1">
          <button
            onClick={() => setTab("data")}
            className={`flex-1 rounded px-3 py-1 text-xs font-medium ${tab === "data" ? "bg-white/20" : "text-white/50"}`}
          >
            Data Export
          </button>
          <button
            onClick={() => setTab("report")}
            className={`flex-1 rounded px-3 py-1 text-xs font-medium ${tab === "report" ? "bg-white/20" : "text-white/50"}`}
          >
            Report
          </button>
        </div>

        {tab === "data" ? (
          <div className="space-y-3">
            <p className="text-xs text-white/60">Select export format</p>
            <div className="flex gap-2">
              {(["json", "csv", "html"] as ExportFormat[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`rounded-md border px-4 py-2 text-xs font-medium transition-colors ${
                    format === f
                      ? "border-blue-500 bg-blue-500/20 text-blue-300"
                      : "border-white/10 text-white/50 hover:border-white/30"
                  }`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-white/60">Select report sections</p>
            <div className="space-y-1">
              {ALL_SECTIONS.map(s => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 text-xs text-white/70"
                >
                  <input
                    type="checkbox"
                    checked={sections.has(s.id)}
                    onChange={() => toggleSection(s.id)}
                    className="rounded"
                  />
                  {s.label}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              {(["html", "markdown"] as ReportFormat[]).map(f => (
                <button
                  key={f}
                  onClick={() => setReportFormat(f)}
                  className={`rounded-md border px-3 py-1.5 text-xs ${
                    reportFormat === f
                      ? "border-blue-500 bg-blue-500/20 text-blue-300"
                      : "border-white/10 text-white/50"
                  }`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-white/50"
          >
            Cancel
          </Button>
          <Button
            onClick={tab === "data" ? handleExportData : handleExportReport}
          >
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
