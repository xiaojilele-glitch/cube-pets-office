import type {
  InteriorAgentStatus,
  InteriorStageStatus,
  MissionTaskStatus,
  TaskArtifact,
  TimelineLevel,
} from "@/lib/tasks-store";
import { cn } from "@/lib/utils";

export function formatTaskDate(value: number | null): string {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString();
}

export function formatTaskRelative(value: number | null): string {
  if (!value) return "n/a";
  const diff = Date.now() - value;
  const minutes = Math.max(1, Math.round(diff / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function compactText(
  value: string | null | undefined,
  maxLength = 120
): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}...`
    : normalized;
}

export function missionStatusLabel(status: MissionTaskStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "waiting":
      return "Waiting";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
  }
}

export function missionStatusTone(status: MissionTaskStatus): string {
  return cn(
    "border",
    status === "done" && "border-emerald-200 bg-emerald-50 text-emerald-700",
    status === "running" && "border-amber-200 bg-amber-50 text-amber-700",
    status === "waiting" && "border-sky-200 bg-sky-50 text-sky-700",
    status === "queued" && "border-stone-200 bg-stone-50 text-stone-700",
    status === "failed" && "border-rose-200 bg-rose-50 text-rose-700"
  );
}

export function timelineTone(level: TimelineLevel): string {
  return cn(
    "border",
    level === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
    level === "info" && "border-sky-200 bg-sky-50 text-sky-700",
    level === "warn" && "border-amber-200 bg-amber-50 text-amber-700",
    level === "error" && "border-rose-200 bg-rose-50 text-rose-700"
  );
}

export function stageTone(status: InteriorStageStatus): string {
  return cn(
    "border",
    status === "done" && "border-emerald-200 bg-emerald-50 text-emerald-700",
    status === "running" && "border-amber-200 bg-amber-50 text-amber-700",
    status === "pending" && "border-stone-200 bg-stone-50 text-stone-600",
    status === "failed" && "border-rose-200 bg-rose-50 text-rose-700"
  );
}

export function agentStatusLabel(status: InteriorAgentStatus): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "working":
      return "Working";
    case "thinking":
      return "Thinking";
    case "done":
      return "Done";
    case "error":
      return "Error";
  }
}

export function agentStatusTone(status: InteriorAgentStatus): string {
  return cn(
    "border",
    status === "done" && "border-emerald-200 bg-emerald-50 text-emerald-700",
    status === "working" && "border-amber-200 bg-amber-50 text-amber-700",
    status === "thinking" && "border-sky-200 bg-sky-50 text-sky-700",
    status === "idle" && "border-stone-200 bg-stone-50 text-stone-600",
    status === "error" && "border-rose-200 bg-rose-50 text-rose-700"
  );
}

export function roleLabel(role: string): string {
  if (role === "ceo") return "CEO";
  if (role === "manager") return "Manager";
  if (role === "worker") return "Worker";
  return role;
}

export function artifactActionLabel(artifact: TaskArtifact): string {
  if (artifact.kind === "attachment") return "Download attachment";
  if (artifact.downloadKind === "external") {
    return artifact.kind === "url" ? "Open link" : "Open artifact";
  }
  if (!artifact.workflowId) return "View metadata";
  if (artifact.format === "md") return "Download markdown";
  return "Download report";
}

export function downloadAttachmentArtifact(artifact: TaskArtifact): boolean {
  if (!artifact.content || typeof window === "undefined") {
    return false;
  }

  const blob = new Blob([artifact.content], {
    type: artifact.mimeType || "text/plain;charset=utf-8",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = artifact.filename || "artifact.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  return true;
}
