/**
 * TeachingOverlay — Demo/teaching mode overlay.
 *
 * Demo mode toggle hides tech panels and enlarges 3D scene.
 * Provides annotation tools and question markers.
 *
 * Requirements: 17.1, 17.2, 17.3
 */

import { useCallback, useState } from "react";
import { MessageCircleQuestion, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useReplayStore } from "@/lib/replay/replay-store-ui";

interface Annotation {
  id: string;
  x: number;
  y: number;
  text: string;
  type: "note" | "question";
}

export function TeachingOverlay() {
  const toggleDemoMode = useReplayStore(s => s.toggleDemoMode);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [tool, setTool] = useState<"none" | "annotate" | "question">("none");

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (tool === "none") return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const newAnnotation: Annotation = {
        id: crypto.randomUUID(),
        x,
        y,
        text: tool === "question" ? "?" : "",
        type: tool === "question" ? "question" : "note",
      };
      setAnnotations(prev => [...prev, newAnnotation]);
      setTool("none");
    },
    [tool]
  );

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations(prev => prev.filter(a => a.id !== id));
  }, []);

  return (
    <div className="absolute inset-0 z-10" onClick={handleCanvasClick}>
      {/* Top bar */}
      <div className="absolute left-0 right-0 top-0 z-20 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent px-4 py-2">
        <span className="rounded bg-amber-500/80 px-2 py-0.5 text-[10px] font-bold text-black">
          DEMO MODE
        </span>
        <div className="flex gap-1">
          <Button
            variant={tool === "annotate" ? "default" : "ghost"}
            size="icon-sm"
            onClick={e => {
              e.stopPropagation();
              setTool(tool === "annotate" ? "none" : "annotate");
            }}
            className="text-white/80"
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant={tool === "question" ? "default" : "ghost"}
            size="icon-sm"
            onClick={e => {
              e.stopPropagation();
              setTool(tool === "question" ? "none" : "question");
            }}
            className="text-white/80"
          >
            <MessageCircleQuestion className="size-3.5" />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={e => {
            e.stopPropagation();
            toggleDemoMode();
          }}
          className="ml-auto text-white/60"
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Annotations */}
      {annotations.map(a => (
        <div
          key={a.id}
          className="absolute z-20 cursor-pointer"
          style={{ left: a.x, top: a.y }}
          onClick={e => {
            e.stopPropagation();
            removeAnnotation(a.id);
          }}
        >
          {a.type === "question" ? (
            <div className="flex size-6 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-black shadow-lg">
              ?
            </div>
          ) : (
            <div className="rounded bg-blue-500/80 px-2 py-1 text-[10px] text-white shadow-lg">
              📝 Note
            </div>
          )}
        </div>
      ))}

      {/* Tool hint */}
      {tool !== "none" && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-[11px] text-white/80">
          Click to place{" "}
          {tool === "question" ? "question marker" : "annotation"}
        </div>
      )}
    </div>
  );
}
