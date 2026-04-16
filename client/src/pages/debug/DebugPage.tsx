import { Link } from "wouter";
import { useI18n } from "@/i18n";
import { WorkspacePageShell } from "@/components/workspace/WorkspacePageShell";

export default function DebugPage() {
  const { copy } = useI18n();
  return (
    <WorkspacePageShell
      eyebrow="Debug"
      title={copy.toolbar.moreActions.debug?.label || "Debug"}
      description={copy.toolbar.moreActions.debug?.description || "Low-frequency capabilities"}
    >
      <div className="p-6">
        <ul className="space-y-4">
          <li>
            <Link
              href="/lineage"
              className="text-[#d07a4f] hover:underline font-semibold"
            >
              Data Lineage View
            </Link>
          </li>
          <li>
            <Link
              href="/command-center/legacy"
              className="text-[#d07a4f] hover:underline font-semibold"
            >
              Legacy Command Center
            </Link>
          </li>
        </ul>
      </div>
    </WorkspacePageShell>
  );
}
