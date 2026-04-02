/**
 * Collaboration Replay System — Replay Engine
 *
 * State machine driven playback engine for ExecutionTimeline events.
 * Uses requestAnimationFrame (with setTimeout fallback for tests) to
 * advance currentTime based on elapsed real time × speed multiplier.
 *
 * State transitions:
 *   idle → play() → playing
 *   playing → pause() → paused
 *   paused → resume() → playing
 *   playing | paused → stop() → stopped
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 17.4
 */

import type {
  ExecutionEvent,
  ExecutionTimeline,
  ReplayEventType,
  ReplayFilters,
} from '../../../../shared/replay/contracts';
import { PLAYBACK_SPEEDS } from '../../../../shared/replay/contracts';
import type { PlaybackSpeed, ReplayState } from '../../../../shared/replay/contracts';

// Re-export for convenience
export { PLAYBACK_SPEEDS };
export type { PlaybackSpeed, ReplayState, ReplayFilters };

/* ─── Engine State ─── */

export interface ReplayEngineState {
  state: ReplayState;
  speed: PlaybackSpeed;
  currentTime: number;
  currentEventIndex: number;
  totalDuration: number;
  eventCount: number;
  filters: ReplayFilters;
  interactiveMode: boolean;
}

/* ─── Callback types ─── */

type EventCallback = (event: ExecutionEvent) => void;
type StateChangeCallback = (state: ReplayEngineState) => void;
type UnsubscribeFn = () => void;

/* ─── ReplayEngine ─── */

export class ReplayEngine {
  // ── Timeline data ──
  private readonly timeline: ExecutionTimeline;
  private readonly events: ExecutionEvent[];

  // ── Playback state ──
  private _state: ReplayState = 'idle';
  private _speed: PlaybackSpeed = 1;
  private _currentTime: number;
  private _currentEventIndex = -1;
  private _filters: ReplayFilters = {};
  private _interactiveMode = false;

  // ── Animation loop ──
  private animFrameId: number | null = null;
  private lastRealTime: number | null = null;

  // ── Subscribers ──
  private eventCallbacks: Set<EventCallback> = new Set();
  private stateCallbacks: Set<StateChangeCallback> = new Set();

  // ── Cached filtered events ──
  private _filteredEvents: ExecutionEvent[] | null = null;

  constructor(timeline: ExecutionTimeline) {
    this.timeline = timeline;
    this.events = timeline.events;
    this._currentTime = timeline.startTime;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * Public API — State machine controls
   * ═══════════════════════════════════════════════════════════════════════ */

  /** idle → playing */
  play(): void {
    if (this._state !== 'idle') return;
    this._currentTime = this.timeline.startTime;
    this._currentEventIndex = -1;
    this.transitionTo('playing');
    this.startLoop();
  }

  /** playing → paused */
  pause(): void {
    if (this._state !== 'playing') return;
    this.stopLoop();
    this.transitionTo('paused');
  }

  /** paused → playing */
  resume(): void {
    if (this._state !== 'paused') return;
    this.transitionTo('playing');
    this.startLoop();
  }

  /** playing | paused → stopped */
  stop(): void {
    if (this._state !== 'playing' && this._state !== 'paused') return;
    this.stopLoop();
    this.transitionTo('stopped');
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * Public API — Speed, filters, seek, interactive mode
   * ═══════════════════════════════════════════════════════════════════════ */

  setSpeed(speed: PlaybackSpeed): void {
    if (!(PLAYBACK_SPEEDS as readonly number[]).includes(speed)) return;
    this._speed = speed;
    this.notifyStateChange();
  }

  setFilters(filters: ReplayFilters): void {
    this._filters = {
      eventTypes: filters.eventTypes ? [...filters.eventTypes] : undefined,
      agentIds: filters.agentIds ? [...filters.agentIds] : undefined,
      keyword: filters.keyword,
    };
    this._filteredEvents = null; // invalidate cache
    this.notifyStateChange();
  }

  /**
   * Jump to a specific timestamp.
   * Sets currentEventIndex to the last event whose timestamp <= target.
   */
  seek(timestamp: number): void {
    if (this._state === 'idle' || this._state === 'stopped') return;

    const clamped = Math.max(
      this.timeline.startTime,
      Math.min(timestamp, this.timeline.endTime),
    );
    this._currentTime = clamped;

    // Binary-search for the last event with timestamp <= clamped
    const filtered = this.getFilteredEvents();
    let lo = 0;
    let hi = filtered.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (filtered[mid].timestamp <= clamped) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    // Map back to the full-events index for getCurrentEvent()
    if (idx >= 0) {
      const targetEvent = filtered[idx];
      this._currentEventIndex = this.events.indexOf(targetEvent);
    } else {
      this._currentEventIndex = -1;
    }

    this.notifyStateChange();
  }

  setInteractiveMode(enabled: boolean): void {
    this._interactiveMode = enabled;
    this.notifyStateChange();
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * Public API — Queries
   * ═══════════════════════════════════════════════════════════════════════ */

  getState(): ReplayEngineState {
    return {
      state: this._state,
      speed: this._speed,
      currentTime: this._currentTime,
      currentEventIndex: this._currentEventIndex,
      totalDuration: this.timeline.totalDuration,
      eventCount: this.timeline.eventCount,
      filters: {
        eventTypes: this._filters.eventTypes ? [...this._filters.eventTypes] : undefined,
        agentIds: this._filters.agentIds ? [...this._filters.agentIds] : undefined,
        keyword: this._filters.keyword,
      },
      interactiveMode: this._interactiveMode,
    };
  }

  getCurrentEvent(): ExecutionEvent | null {
    if (this._currentEventIndex < 0 || this._currentEventIndex >= this.events.length) {
      return null;
    }
    return this.events[this._currentEventIndex];
  }

  getFilteredEvents(): ExecutionEvent[] {
    if (this._filteredEvents) return this._filteredEvents;
    this._filteredEvents = this.applyFilters(this.events);
    return this._filteredEvents;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * Public API — Subscriptions
   * ═══════════════════════════════════════════════════════════════════════ */

  onEvent(callback: EventCallback): UnsubscribeFn {
    this.eventCallbacks.add(callback);
    return () => {
      this.eventCallbacks.delete(callback);
    };
  }

  onStateChange(callback: StateChangeCallback): UnsubscribeFn {
    this.stateCallbacks.add(callback);
    return () => {
      this.stateCallbacks.delete(callback);
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * Internal — Animation loop
   * ═══════════════════════════════════════════════════════════════════════ */

  private startLoop(): void {
    this.lastRealTime = null;
    this.tick = this.tick.bind(this);
    this.scheduleFrame();
  }

  private stopLoop(): void {
    if (this.animFrameId !== null) {
      this.cancelFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.lastRealTime = null;
  }

  /**
   * Single tick of the playback loop.
   * Advances currentTime by (realDelta * speed) and fires events whose
   * timestamps fall within the advanced window.
   */
  private tick(now?: number): void {
    if (this._state !== 'playing') return;

    const realNow = now ?? performance.now();

    if (this.lastRealTime === null) {
      this.lastRealTime = realNow;
      this.scheduleFrame();
      return;
    }

    const realDelta = realNow - this.lastRealTime;
    this.lastRealTime = realNow;

    // Advance virtual time
    const prevTime = this._currentTime;
    this._currentTime = Math.min(
      this._currentTime + realDelta * this._speed,
      this.timeline.endTime,
    );

    // Fire events in the (prevTime, currentTime] window
    const filtered = this.getFilteredEvents();
    for (const event of filtered) {
      if (event.timestamp > prevTime && event.timestamp <= this._currentTime) {
        // Update currentEventIndex (in full events array)
        this._currentEventIndex = this.events.indexOf(event);
        this.notifyEvent(event);

        // Interactive mode: auto-pause at DECISION_MADE events
        if (this._interactiveMode && event.eventType === 'DECISION_MADE') {
          this.stopLoop();
          this.transitionTo('paused');
          return; // stop processing further events this tick
        }
      }
    }

    // Check if we've reached the end
    if (this._currentTime >= this.timeline.endTime) {
      this.stopLoop();
      this.transitionTo('stopped');
      return;
    }

    this.notifyStateChange();
    this.scheduleFrame();
  }

  /* ─── Frame scheduling (rAF with setTimeout fallback) ─── */

  private scheduleFrame(): void {
    if (typeof requestAnimationFrame === 'function') {
      this.animFrameId = requestAnimationFrame((t) => this.tick(t));
    } else {
      // Fallback for test environments without rAF
      this.animFrameId = setTimeout(() => this.tick(performance.now()), 16) as unknown as number;
    }
  }

  private cancelFrame(id: number): void {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(id);
    } else {
      clearTimeout(id);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * Internal — Filtering
   * ═══════════════════════════════════════════════════════════════════════ */

  private applyFilters(events: ExecutionEvent[]): ExecutionEvent[] {
    let result = events;

    const { eventTypes, agentIds, keyword } = this._filters;

    if (eventTypes && eventTypes.length > 0) {
      const typeSet = new Set<ReplayEventType>(eventTypes);
      result = result.filter((e) => typeSet.has(e.eventType));
    }

    if (agentIds && agentIds.length > 0) {
      const agentSet = new Set<string>(agentIds);
      result = result.filter(
        (e) => agentSet.has(e.sourceAgent) || (e.targetAgent && agentSet.has(e.targetAgent)),
      );
    }

    if (keyword && keyword.length > 0) {
      const kw = keyword.toLowerCase();
      result = result.filter((e) => JSON.stringify(e.eventData).toLowerCase().includes(kw));
    }

    return result;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * Internal — State transitions & notifications
   * ═══════════════════════════════════════════════════════════════════════ */

  private transitionTo(newState: ReplayState): void {
    this._state = newState;
    this.notifyStateChange();
  }

  private notifyEvent(event: ExecutionEvent): void {
    this.eventCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch {
        // swallow subscriber errors
      }
    });
  }

  private notifyStateChange(): void {
    const snapshot = this.getState();
    this.stateCallbacks.forEach((cb) => {
      try {
        cb(snapshot);
      } catch {
        // swallow subscriber errors
      }
    });
  }
}
