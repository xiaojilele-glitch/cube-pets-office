import { useState } from "react";
import { Link } from "wouter";
import { ConfigPanel } from "@/components/ConfigPanel";
import { AuditPanel } from "@/components/AuditPanel";
import { PermissionPanel } from "@/components/permissions/PermissionPanel";
import { LineageContent } from "@/pages/lineage/LineagePage";
import { Shield, FileSearch, GitBranch, Settings2, Bug } from "lucide-react";
import { WorkspacePageShell, WorkspacePanel } from "@/components/workspace/WorkspacePageShell";

export default function DebugPage() {
  const [activeTab, setActiveTab] = useState<"config" | "permissions" | "audit" | "lineage" | "legacy">("lineage");

  const tabs = [
    { id: "lineage" as const, label: "Lineage", icon: GitBranch },
    { id: "audit" as const, label: "Audit", icon: FileSearch },
    { id: "permissions" as const, label: "Permissions", icon: Shield },
    { id: "config" as const, label: "Config", icon: Settings2 },
    { id: "legacy" as const, label: "Legacy", icon: Bug },
  ];

  const toolbar = (
    <div className="flex flex-wrap gap-2">
      {tabs.map(tab => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            className="workspace-pill flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
            data-active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <WorkspacePageShell
      eyebrow="INTERNAL"
      title="Debug Console"
      description="Internal tools for debugging lineage, audit trails, permissions, and runtime configurations."
      toolbar={toolbar}
    >
      <div className="min-h-[600px]">
        {activeTab === "lineage" && <LineageContent embedded />}
        {activeTab === "audit" && (
          <WorkspacePanel className="h-[700px] overflow-hidden bg-white/90">
            <AuditPanel />
          </WorkspacePanel>
        )}
        {activeTab === "permissions" && (
          <WorkspacePanel className="h-[700px] overflow-hidden bg-white/90">
            <PermissionPanel />
          </WorkspacePanel>
        )}
        {activeTab === "config" && (
          <WorkspacePanel className="h-[700px] overflow-hidden bg-white/90 relative">
             <ConfigPanel inline />
          </WorkspacePanel>
        )}
        {activeTab === "legacy" && (
          <WorkspacePanel className="h-[700px] overflow-hidden bg-white/90 relative p-6">
            <ul className="space-y-4">
              <li>
                <Link
                  href="/command-center/legacy"
                  className="text-[#d07a4f] hover:underline font-semibold"
                >
                  Legacy Command Center
                </Link>
              </li>
            </ul>
          </WorkspacePanel>
        )}
      </div>
    </WorkspacePageShell>
  );
}
