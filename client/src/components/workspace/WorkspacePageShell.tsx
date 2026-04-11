import type { HTMLAttributes, ReactNode } from "react";

import { useViewportTier } from "@/hooks/useViewportTier";
import { cn } from "@/lib/utils";

interface WorkspacePageShellProps {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function WorkspacePageShell({
  eyebrow,
  title,
  description,
  actions,
  toolbar,
  children,
  className,
  contentClassName,
}: WorkspacePageShellProps) {
  const { isMobile } = useViewportTier();
  const mobileShellStyle = isMobile
    ? { paddingTop: "calc(env(safe-area-inset-top) + 240px)" }
    : undefined;

  return (
    <div
      className={cn(
        "workspace-page min-h-screen pb-28 text-[var(--workspace-text-strong)] md:pb-40",
        isMobile ? undefined : "pt-6",
        className
      )}
      style={mobileShellStyle}
    >
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 md:gap-5 md:px-6">
        <section className="workspace-shell rounded-[32px] p-5 md:p-6">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 flex-1">
                <p className="workspace-eyebrow">{eyebrow}</p>
                <h1 className="workspace-title">{title}</h1>
                {description ? (
                  <div className="workspace-description mt-3 max-w-3xl text-sm leading-7 md:text-[15px]">
                    {description}
                  </div>
                ) : null}
              </div>
              {actions ? (
                <div className="flex flex-wrap items-center gap-2.5 md:max-w-[44%] md:justify-end">
                  {actions}
                </div>
              ) : null}
            </div>

            {toolbar ? (
              <div className="workspace-panel workspace-panel-inset rounded-[28px] p-4 md:p-5">
                {toolbar}
              </div>
            ) : null}
          </div>
        </section>

        <div className={cn("flex min-h-0 flex-col gap-4", contentClassName)}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function WorkspacePanel({
  className,
  strong = false,
  inset = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  strong?: boolean;
  inset?: boolean;
}) {
  return (
    <div
      className={cn(
        "workspace-panel rounded-[28px]",
        strong && "workspace-panel-strong",
        inset && "workspace-panel-inset",
        className
      )}
      {...props}
    />
  );
}
