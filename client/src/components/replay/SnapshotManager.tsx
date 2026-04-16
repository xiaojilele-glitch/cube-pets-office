/**
 * SnapshotManager — Create, list, jump-to, export/import snapshots.
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4
 */

import { useCallback, useState } from "react";
import { Bookmark, Download, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useReplayStore } from "@/lib/replay/replay-store-ui";

export function SnapshotManager() {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const snapshots = useReplayStore(s => s.snapshots);
  const createSnapshot = useReplayStore(s => s.createSnapshot);
  const jumpToSnapshot = useReplayStore(s => s.jumpToSnapshot);

  const handleCreate = useCallback(() => {
    if (!label.trim()) return;
    createSnapshot(label.trim(), note.trim() || undefined);
    setLabel("");
    setNote("");
  }, [label, note, createSnapshot]);

  const handleExport = useCallback(() => {
    const json = JSON.stringify(snapshots, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "replay-snapshots.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [snapshots]);

  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        // For now just log — full import would merge into store
        console.log("[SnapshotManager] Imported snapshots:", imported);
      } catch (err) {
        console.error("[SnapshotManager] Import failed:", err);
      }
    };
    input.click();
  }, []);

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(!open)}
        className="text-white/70 hover:text-white"
      >
        <Bookmark className="size-4" />
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-white/10 bg-[#1a1a2e] p-3 shadow-xl">
          <p className="mb-2 text-xs font-semibold text-white/80">Snapshots</p>

          {/* Create */}
          <div className="mb-3 space-y-1.5">
            <Input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="Label"
              className="h-7 border-white/10 bg-white/5 text-[11px] text-white placeholder:text-white/30"
            />
            <Input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Note (optional)"
              className="h-7 border-white/10 bg-white/5 text-[11px] text-white placeholder:text-white/30"
            />
            <Button
              size="sm"
              onClick={handleCreate}
              className="w-full text-[11px]"
            >
              Create Snapshot
            </Button>
          </div>

          {/* List */}
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {snapshots.length === 0 && (
              <p className="text-[10px] text-white/30">No snapshots yet</p>
            )}
            {snapshots.map(s => (
              <button
                key={s.snapshotId}
                onClick={() => jumpToSnapshot(s.snapshotId)}
                className="block w-full rounded px-2 py-1 text-left text-[11px] text-white/70 hover:bg-white/10"
              >
                <span className="font-medium">{s.label}</span>
                <span className="ml-2 text-white/40">
                  {new Date(s.createdAt).toLocaleTimeString()}
                </span>
              </button>
            ))}
          </div>

          {/* Export / Import */}
          <div className="mt-2 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              className="flex-1 text-[10px]"
            >
              <Download className="mr-1 size-3" /> Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleImport}
              className="flex-1 text-[10px]"
            >
              <Upload className="mr-1 size-3" /> Import
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
