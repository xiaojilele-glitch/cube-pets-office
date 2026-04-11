import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface StatusPillStackItem {
  key: string;
  label: string;
  icon?: ReactNode;
  className?: string;
}

export function StatusPillStack({
  items,
  className,
}: {
  items: StatusPillStackItem[];
  className?: string;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {items.map(item => (
        <span key={item.key} className={cn("workspace-status", item.className)}>
          {item.icon ? <span className="shrink-0">{item.icon}</span> : null}
          {item.label}
        </span>
      ))}
    </div>
  );
}
