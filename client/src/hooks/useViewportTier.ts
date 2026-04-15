import { useSyncExternalStore } from "react";

export type ViewportTier = "mobile" | "tablet" | "desktop";

const MOBILE_MAX_WIDTH = 767;
const TABLET_MAX_WIDTH = 1279;
const RESIZE_SETTLE_MS = 180;

type Listener = () => void;

function getViewportWidth() {
  if (typeof window === "undefined") return 1280;
  return window.innerWidth;
}

export function getViewportTier(width: number): ViewportTier {
  if (width <= MOBILE_MAX_WIDTH) return "mobile";
  if (width <= TABLET_MAX_WIDTH) return "tablet";
  return "desktop";
}

type TierSnapshot = {
  tier: ViewportTier;
  width: number;
};

const serverWidth = 1280;
const serverTierSnapshot: TierSnapshot = {
  tier: getViewportTier(serverWidth),
  width: serverWidth,
};
let currentTierSnapshot: TierSnapshot = serverTierSnapshot;

let initialized = false;
let latestWidth = serverWidth;
let latestTier = serverTierSnapshot.tier;
let resizeActive = false;
let resizeSettleTimer: number | null = null;
let widthRafId: number | null = null;

const tierListeners = new Set<Listener>();
const widthListeners = new Set<Listener>();
const resizeListeners = new Set<Listener>();

let mobileMediaQuery: MediaQueryList | null = null;
let tabletMediaQuery: MediaQueryList | null = null;

function emit(listeners: Set<Listener>) {
  listeners.forEach(listener => listener());
}

function notifyWidthListeners() {
  if (widthRafId !== null || typeof window === "undefined") return;

  widthRafId = window.requestAnimationFrame(() => {
    widthRafId = null;
    emit(widthListeners);
  });
}

function updateTierSnapshot(width: number) {
  const nextTier = getViewportTier(width);
  const tierChanged = nextTier !== latestTier;

  latestWidth = width;
  if (!tierChanged) {
    return;
  }

  latestTier = nextTier;
  currentTierSnapshot = {
    tier: nextTier,
    width,
  };
  emit(tierListeners);
}

function setResizeActive(nextValue: boolean) {
  if (resizeActive === nextValue) return;
  resizeActive = nextValue;
  emit(resizeListeners);
}

function scheduleResizeSettle() {
  if (typeof window === "undefined") return;

  if (resizeSettleTimer !== null) {
    window.clearTimeout(resizeSettleTimer);
  }

  resizeSettleTimer = window.setTimeout(() => {
    resizeSettleTimer = null;
    setResizeActive(false);
  }, RESIZE_SETTLE_MS);
}

function handleResize() {
  const width = getViewportWidth();
  latestWidth = width;
  notifyWidthListeners();
  updateTierSnapshot(width);
  setResizeActive(true);
  scheduleResizeSettle();
}

function ensureViewportObservers() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  latestWidth = getViewportWidth();
  latestTier = getViewportTier(latestWidth);
  currentTierSnapshot = {
    tier: latestTier,
    width: latestWidth,
  };

  mobileMediaQuery = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
  tabletMediaQuery = window.matchMedia(`(max-width: ${TABLET_MAX_WIDTH}px)`);

  const handleMediaChange = () => {
    updateTierSnapshot(getViewportWidth());
  };

  mobileMediaQuery.addEventListener("change", handleMediaChange);
  tabletMediaQuery.addEventListener("change", handleMediaChange);
  window.addEventListener("resize", handleResize, { passive: true });
}

function subscribeTier(listener: Listener) {
  ensureViewportObservers();
  tierListeners.add(listener);
  return () => {
    tierListeners.delete(listener);
  };
}

function subscribeWidth(listener: Listener) {
  ensureViewportObservers();
  widthListeners.add(listener);
  return () => {
    widthListeners.delete(listener);
  };
}

function subscribeResize(listener: Listener) {
  ensureViewportObservers();
  resizeListeners.add(listener);
  return () => {
    resizeListeners.delete(listener);
  };
}

function getTierSnapshot(): TierSnapshot {
  if (typeof window === "undefined") return serverTierSnapshot;
  return currentTierSnapshot;
}

function getWidthSnapshot(): number {
  if (typeof window === "undefined") return serverWidth;
  return latestWidth;
}

function getResizeSnapshot(): boolean {
  return resizeActive;
}

export function useViewportTier() {
  const snapshot = useSyncExternalStore(
    subscribeTier,
    getTierSnapshot,
    () => serverTierSnapshot
  );
  const width = typeof window === "undefined" ? snapshot.width : getViewportWidth();

  return {
    width,
    tier: snapshot.tier,
    isMobile: snapshot.tier === "mobile",
    isTablet: snapshot.tier === "tablet",
    isDesktop: snapshot.tier === "desktop",
    isCompact: snapshot.tier !== "desktop",
  };
}

export function useViewportWidth() {
  return useSyncExternalStore(
    subscribeWidth,
    getWidthSnapshot,
    () => serverWidth
  );
}

export function useViewportResizeState() {
  return useSyncExternalStore(
    subscribeResize,
    getResizeSnapshot,
    () => false
  );
}
