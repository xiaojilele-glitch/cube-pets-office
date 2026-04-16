import { useI18n } from "@/i18n";
import { useAppStore } from "@/lib/store";

const PIXEL_SIZE = 8;
const PIXEL_PET_CELLS = [
  { x: 3, y: 0, color: "#D6A16F" },
  { x: 6, y: 0, color: "#D6A16F" },
  { x: 2, y: 1, color: "#D6A16F" },
  { x: 3, y: 1, color: "#D6A16F" },
  { x: 4, y: 1, color: "#D6A16F" },
  { x: 5, y: 1, color: "#D6A16F" },
  { x: 6, y: 1, color: "#D6A16F" },
  { x: 7, y: 1, color: "#D6A16F" },
  { x: 2, y: 2, color: "#D6A16F" },
  { x: 3, y: 2, color: "#E4B788" },
  { x: 4, y: 2, color: "#E4B788" },
  { x: 5, y: 2, color: "#E4B788" },
  { x: 6, y: 2, color: "#E4B788" },
  { x: 7, y: 2, color: "#D6A16F" },
  { x: 1, y: 3, color: "#D6A16F" },
  { x: 2, y: 3, color: "#E4B788" },
  { x: 3, y: 3, color: "#EBC49B" },
  { x: 4, y: 3, color: "#EBC49B" },
  { x: 5, y: 3, color: "#EBC49B" },
  { x: 6, y: 3, color: "#EBC49B" },
  { x: 7, y: 3, color: "#E4B788" },
  { x: 8, y: 3, color: "#D6A16F" },
  { x: 1, y: 4, color: "#D6A16F" },
  { x: 2, y: 4, color: "#E4B788" },
  { x: 3, y: 4, color: "#EBC49B" },
  { x: 4, y: 4, color: "#FFFFFF" },
  { x: 5, y: 4, color: "#EBC49B" },
  { x: 6, y: 4, color: "#FFFFFF" },
  { x: 7, y: 4, color: "#EBC49B" },
  { x: 8, y: 4, color: "#D6A16F" },
  { x: 1, y: 5, color: "#D6A16F" },
  { x: 2, y: 5, color: "#E4B788" },
  { x: 3, y: 5, color: "#EBC49B" },
  { x: 4, y: 5, color: "#3E2B1D" },
  { x: 5, y: 5, color: "#EBC49B" },
  { x: 6, y: 5, color: "#3E2B1D" },
  { x: 7, y: 5, color: "#EBC49B" },
  { x: 8, y: 5, color: "#D6A16F" },
  { x: 1, y: 6, color: "#D6A16F" },
  { x: 2, y: 6, color: "#E4B788" },
  { x: 3, y: 6, color: "#EBC49B" },
  { x: 4, y: 6, color: "#EBC49B" },
  { x: 5, y: 6, color: "#EBC49B" },
  { x: 6, y: 6, color: "#EBC49B" },
  { x: 7, y: 6, color: "#EBC49B" },
  { x: 8, y: 6, color: "#D6A16F" },
  { x: 2, y: 7, color: "#D6A16F" },
  { x: 3, y: 7, color: "#E4B788" },
  { x: 4, y: 7, color: "#EBC49B" },
  { x: 5, y: 7, color: "#EBC49B" },
  { x: 6, y: 7, color: "#E4B788" },
  { x: 7, y: 7, color: "#D6A16F" },
  { x: 3, y: 8, color: "#D6A16F" },
  { x: 4, y: 8, color: "#6D4B32" },
  { x: 5, y: 8, color: "#6D4B32" },
  { x: 6, y: 8, color: "#D6A16F" },
];

export function LoadingScreen() {
  const loadingProgress = useAppStore(state => state.loadingProgress);
  const { copy } = useI18n();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,#0a1628_0%,#0d1f3c_38%,#060e1a_100%)] px-6 text-center">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(6,182,212,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.06)_1px,transparent_1px)] bg-[size:22px_22px]" />
        <div className="absolute left-[16%] top-[18%] h-28 w-28 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute right-[18%] top-[26%] h-36 w-36 rounded-full bg-blue-500/15 blur-3xl" />
        <div className="absolute bottom-[18%] left-[22%] h-32 w-32 rounded-full bg-purple-500/12 blur-3xl" />
        <div className="absolute bottom-[16%] right-[24%] h-24 w-24 rounded-full bg-cyan-400/16 blur-3xl" />
      </div>

      <div className="glass-panel relative w-full max-w-[420px] rounded-[36px] px-7 py-8">
        <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

        <div className="relative mx-auto mb-7 flex h-32 w-32 items-center justify-center">
          <div className="absolute inset-4 rounded-[28px] bg-cyan-500/10 blur-2xl" />
          <div
            className="glass-panel relative h-[92px] w-[92px] rounded-[24px]"
            style={{ animation: "petFloat 1.8s ease-in-out infinite" }}
          >
            <div
              className="absolute left-1/2 top-1/2 h-[72px] w-[72px] -translate-x-1/2 -translate-y-1/2"
              style={{ imageRendering: "pixelated" }}
            >
              {PIXEL_PET_CELLS.map((cell, index) => (
                <span
                  key={`${cell.x}-${cell.y}-${index}`}
                  className="absolute"
                  style={{
                    left: `${cell.x * PIXEL_SIZE}px`,
                    top: `${cell.y * PIXEL_SIZE}px`,
                    width: `${PIXEL_SIZE}px`,
                    height: `${PIXEL_SIZE}px`,
                    backgroundColor: cell.color,
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)",
                  }}
                />
              ))}
            </div>
          </div>

          <div
            className="absolute bottom-1 left-1/2 h-4 w-20 -translate-x-1/2 rounded-full bg-cyan-500/20 blur-md"
            style={{ animation: "shadowPulse 1.8s ease-in-out infinite" }}
          />
        </div>

        <div className="glass-panel mx-auto mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-300/80">
          <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.6)]" />
          Loading Pod
        </div>

        <h2
          className="mb-2 text-[28px] font-bold text-white/90"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {copy.loading.title}
        </h2>
        <p className="mb-6 text-sm leading-6 text-white/50">
          {copy.loading.description(Math.round(loadingProgress))}
        </p>

        <div className="glass-panel rounded-[24px] p-3">
          <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-cyan-300/70 font-data">
            <span>PIXEL SYNC</span>
            <span>{Math.round(loadingProgress)}%</span>
          </div>
          <div className="relative h-3 overflow-hidden rounded-full bg-white/10">
            <div className="absolute inset-y-0 left-0 w-full bg-[linear-gradient(90deg,rgba(255,255,255,0.06)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.06)_50%,rgba(255,255,255,0.06)_75%,transparent_75%,transparent)] bg-[length:18px_18px] opacity-50" />
            <div
              className="relative h-full rounded-full bg-[linear-gradient(90deg,#06b6d4_0%,#3b82f6_55%,#8b5cf6_100%)] transition-all duration-300 ease-out"
              style={{ width: `${loadingProgress}%` }}
            >
              <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.25),transparent)] opacity-70" />
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes petFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes shadowPulse {
          0%, 100% { transform: translateX(-50%) scaleX(1); opacity: 0.24; }
          50% { transform: translateX(-50%) scaleX(0.78); opacity: 0.12; }
        }
      `}</style>
    </div>
  );
}
