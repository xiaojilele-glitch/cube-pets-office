import { cn } from "@/lib/utils";

export type WorkspaceTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export function workspaceToneClass(tone: WorkspaceTone) {
  return `workspace-tone-${tone}`;
}

export function workspaceStatusClass(tone: WorkspaceTone, className?: string) {
  return cn("workspace-status", workspaceToneClass(tone), className);
}

export function workspaceCalloutClass(tone: WorkspaceTone, className?: string) {
  return cn("workspace-callout", workspaceToneClass(tone), className);
}
