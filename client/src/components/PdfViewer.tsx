import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useViewportTier } from "@/hooks/useViewportTier";
import { useI18n } from "@/i18n";
import { PDF_PAGES, PDF_TOTAL_PAGES } from "@/lib/assets";
import { useAppStore } from "@/lib/store";

export function PdfViewer() {
  const { currentPage, setCurrentPage, isPdfOpen, closePdf } = useAppStore();
  const { copy } = useI18n();
  const { isMobile, isTablet } = useViewportTier();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setImageLoaded(false);
  }, [currentPage]);

  if (!isPdfOpen) return null;

  const isOverlayFullscreen = isMobile || isFullscreen;
  const shellClass = isOverlayFullscreen
    ? "inset-0 rounded-none"
    : isTablet
      ? "inset-y-4 right-4 left-auto w-[min(56vw,560px)] rounded-[28px]"
      : "inset-y-6 right-6 left-auto w-[min(42vw,560px)] rounded-[32px]";

  return (
    <div
      className={`fixed z-[72] flex border border-[#E8DDD0]/60 bg-[#FEFBF7]/98 shadow-[-12px_0_40px_rgba(0,0,0,0.1)] backdrop-blur-2xl animate-in slide-in-from-right duration-300 ${shellClass} flex-col`}
      style={{ pointerEvents: "auto" }}
    >
      <div className="flex items-center justify-between border-b border-[#E8DDD0]/60 bg-gradient-to-r from-[#FFF8F0] to-[#FFF5EC] px-4 py-3 sm:px-5 sm:py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#C4956A] to-[#D4A57A] shadow-sm">
            <BookOpen className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <h3
              className="truncate text-sm font-bold text-[#3A2A1A]"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              {copy.pdf.title}
            </h3>
            <p className="mt-0.5 truncate text-[10px] text-[#8B7355]">
              {copy.pdf.subtitle} · {copy.pdf.author}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isMobile && (
            <button
              onClick={() => setIsFullscreen(prev => !prev)}
              className="rounded-xl p-2 transition-colors hover:bg-[#F0E8E0]"
              title={
                isFullscreen ? copy.pdf.exitFullscreen : copy.pdf.fullscreen
              }
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4 text-[#8B7355]" />
              ) : (
                <Maximize2 className="h-4 w-4 text-[#8B7355]" />
              )}
            </button>
          )}
          <button
            onClick={closePdf}
            className="rounded-xl p-2 transition-colors hover:bg-[#F0E8E0]"
            title={copy.common.close}
          >
            <X className="h-4 w-4 text-[#8B7355]" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4"
      >
        <div className="relative overflow-hidden rounded-xl border border-[#F0E8E0] bg-white shadow-[0_2px_20px_rgba(0,0,0,0.06)]">
          {!imageLoaded && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-[#FEFBF7]"
              style={{ minHeight: isMobile ? 360 : 600 }}
            >
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#C4956A] border-t-transparent" />
                <span className="text-xs text-[#8B7355]">
                  {copy.pdf.loadingPage(currentPage)}
                </span>
              </div>
            </div>
          )}
          <img
            src={PDF_PAGES[currentPage - 1]}
            alt={`${copy.pdf.page} ${currentPage}`}
            className={`h-auto w-full transition-opacity duration-300 ${imageLoaded ? "opacity-100" : "opacity-0"}`}
            onLoad={() => setImageLoaded(true)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E8DDD0]/60 bg-gradient-to-r from-[#FFF8F0] to-[#FFF5EC] px-4 py-3 sm:px-5">
        <button
          onClick={() => {
            setCurrentPage(currentPage - 1);
            scrollRef.current?.scrollTo(0, 0);
          }}
          disabled={currentPage <= 1}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#C4956A] to-[#D4A57A] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
          {copy.pdf.previous}
        </button>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-[#8B7355]">
            {copy.pdf.page}
          </label>
          <input
            type="number"
            min={1}
            max={PDF_TOTAL_PAGES}
            value={currentPage}
            onChange={event => {
              const page = Number(event.target.value);
              if (page >= 1 && page <= PDF_TOTAL_PAGES) {
                setCurrentPage(page);
                scrollRef.current?.scrollTo(0, 0);
              }
            }}
            className="w-16 rounded-xl border border-[#E8DDD0] bg-white py-1.5 text-center text-sm font-semibold text-[#3A2A1A] transition-all focus:border-[#C4956A] focus:outline-none focus:ring-2 focus:ring-[#C4956A]/30"
          />
          <span className="text-sm font-medium text-[#8B7355]">
            / {PDF_TOTAL_PAGES}
          </span>
        </div>

        <button
          onClick={() => {
            setCurrentPage(currentPage + 1);
            scrollRef.current?.scrollTo(0, 0);
          }}
          disabled={currentPage >= PDF_TOTAL_PAGES}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#C4956A] to-[#D4A57A] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {copy.pdf.next}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
