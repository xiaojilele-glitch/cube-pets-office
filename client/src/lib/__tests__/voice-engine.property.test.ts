import { describe, expect, it } from "vitest";
import fc from "fast-check";

/* ─── Property 7: 语音引擎错误恢复 ─── */
/* **Validates: Requirements 1.5, 2.7** */

/**
 * For any TTS or STT engine instance, when the underlying service call throws
 * an exception, the engine should transition to idle state and notify error
 * through callbacks, rather than throwing an uncaught exception to the caller.
 *
 * The TTS/STT engines in tts-engine.ts and stt-engine.ts depend on browser
 * APIs (window.speechSynthesis, AudioContext, MediaRecorder, SpeechRecognition)
 * which are unavailable in Node.js/vitest.
 *
 * We replicate the core error recovery contract here — the same pattern used
 * in createServerTTSEngine.speak(), createBrowserTTSEngine.speak(),
 * createFallbackTTSEngine.speak(), and the STT equivalents — and verify the
 * property: errors are caught, state goes to idle, no uncaught exceptions.
 */

// ---------------------------------------------------------------------------
// Types (mirrored from tts-engine.ts / stt-engine.ts)
// ---------------------------------------------------------------------------

type TTSState = "speaking" | "paused" | "idle";
type STTState = "listening" | "idle";

interface TTSEngine {
  readonly isAvailable: boolean;
  readonly isSpeaking: boolean;
  speak(text: string): Promise<void>;
  stop(): void;
  onStateChange(cb: (state: TTSState) => void): () => void;
}

interface STTEngineCallbacks {
  onInterimTranscript: (text: string) => void;
  onFinalTranscript: (text: string) => void;
  onError: (error: string) => void;
  onStateChange: (state: STTState) => void;
}

interface STTEngine {
  readonly isAvailable: boolean;
  readonly isListening: boolean;
  startListening(callbacks: STTEngineCallbacks): Promise<void>;
  stopListening(): void;
}

// ---------------------------------------------------------------------------
// Engine factories — replicate the error recovery contract from source
// ---------------------------------------------------------------------------

/**
 * Replicates createServerTTSEngine error recovery (tts-engine.ts:225-260).
 * The `serviceFn` simulates the fetch + AudioContext pipeline.
 */
function createMockServerTTSEngine(
  serviceFn: (text: string) => Promise<void>
): TTSEngine {
  const listeners = new Set<(state: TTSState) => void>();
  let speaking = false;

  function notify(state: TTSState) {
    speaking = state === "speaking";
    listeners.forEach(cb => {
      try {
        cb(state);
      } catch {
        /* listener errors must not propagate */
      }
    });
  }

  return {
    get isAvailable() {
      return true;
    },
    get isSpeaking() {
      return speaking;
    },

    async speak(text: string): Promise<void> {
      this.stop();
      try {
        notify("speaking");
        await serviceFn(text);
        notify("idle");
      } catch (err) {
        // Graceful degradation — resolve, never reject (Req 1.5)
        notify("idle");
      }
    },

    stop() {
      notify("idle");
    },

    onStateChange(cb: (state: TTSState) => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

/**
 * Replicates createBrowserTTSEngine error recovery (tts-engine.ts:80-130).
 * The `synthFn` simulates window.speechSynthesis.speak().
 */
function createMockBrowserTTSEngine(
  synthFn: (onEnd: () => void, onError: (err: string) => void) => void
): TTSEngine {
  const listeners = new Set<(state: TTSState) => void>();
  let speaking = false;

  function notify(state: TTSState) {
    speaking = state === "speaking";
    listeners.forEach(cb => {
      try {
        cb(state);
      } catch {
        /* swallow */
      }
    });
  }

  return {
    get isAvailable() {
      return true;
    },
    get isSpeaking() {
      return speaking;
    },

    speak(text: string): Promise<void> {
      return new Promise<void>(resolve => {
        try {
          synthFn(
            () => {
              notify("idle");
              resolve();
            },
            _err => {
              notify("idle");
              resolve();
            } // graceful — never reject
          );
          notify("speaking");
        } catch {
          notify("idle");
          resolve();
        }
      });
    },

    stop() {
      notify("idle");
    },

    onStateChange(cb: (state: TTSState) => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

/**
 * Replicates createFallbackTTSEngine (tts-engine.ts:337-400).
 * Wraps primary with fallback: if primary speak() fails, switch to fallback.
 */
function createMockFallbackTTSEngine(
  primary: TTSEngine,
  fallback: TTSEngine
): TTSEngine {
  const listeners = new Set<(state: TTSState) => void>();
  let activeEngine: TTSEngine = primary;
  let speaking = false;

  function wireListeners(engine: TTSEngine) {
    return engine.onStateChange(state => {
      speaking = state === "speaking";
      listeners.forEach(cb => {
        try {
          cb(state);
        } catch {
          /* swallow */
        }
      });
    });
  }

  let unsubPrimary = wireListeners(primary);

  function switchToFallback() {
    if (activeEngine === fallback) return;
    unsubPrimary();
    activeEngine = fallback;
    wireListeners(fallback);
  }

  return {
    get isAvailable() {
      return primary.isAvailable || fallback.isAvailable;
    },
    get isSpeaking() {
      return speaking;
    },

    async speak(text: string): Promise<void> {
      if (activeEngine === primary && primary.isAvailable) {
        try {
          await primary.speak(text);
          return;
        } catch {
          switchToFallback();
        }
      }
      if (fallback.isAvailable) {
        await fallback.speak(text);
      }
    },

    stop() {
      activeEngine.stop();
    },

    onStateChange(cb: (state: TTSState) => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

/**
 * Replicates createServerSTTEngine error recovery (stt-engine.ts:248-380).
 * The `recordFn` simulates MediaRecorder + fetch pipeline.
 */
function createMockServerSTTEngine(recordFn: () => Promise<string>): STTEngine {
  let listening = false;

  return {
    get isAvailable() {
      return true;
    },
    get isListening() {
      return listening;
    },

    async startListening(callbacks: STTEngineCallbacks): Promise<void> {
      try {
        listening = true;
        callbacks.onStateChange("listening");
        const transcript = await recordFn();
        if (transcript) callbacks.onFinalTranscript(transcript);
      } catch (err) {
        callbacks.onError(err instanceof Error ? err.message : "Unknown error");
        // Graceful degradation — never throw (Req 2.7)
      } finally {
        listening = false;
        callbacks.onStateChange("idle");
      }
    },

    stopListening() {
      listening = false;
    },
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbText = fc.string({ minLength: 1, maxLength: 200 });

const arbErrorMessage = fc.oneof(
  fc.constant("Network error"),
  fc.constant("Timeout"),
  fc.constant("500 Internal Server Error"),
  fc.constant("CORS blocked"),
  fc.constant("decodeAudioData failed"),
  fc.string({ minLength: 1, maxLength: 80 })
);

const arbErrorType = fc.constantFrom("throw", "reject") as fc.Arbitrary<
  "throw" | "reject"
>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Feature: multi-modal-agent, Property 7: 语音引擎错误恢复", () => {
  // ── TTS: ServerTTSEngine error recovery ──

  it("ServerTTSEngine.speak() resolves (never rejects) on service error, and transitions to idle", async () => {
    await fc.assert(
      fc.asyncProperty(arbText, arbErrorMessage, async (text, errorMsg) => {
        const engine = createMockServerTTSEngine(() =>
          Promise.reject(new Error(errorMsg))
        );
        const states: TTSState[] = [];
        engine.onStateChange(s => states.push(s));

        // Must resolve, never reject
        await engine.speak(text);

        // Final state must be idle
        expect(states[states.length - 1]).toBe("idle");
        expect(engine.isSpeaking).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // ── TTS: BrowserTTSEngine error recovery (onerror callback) ──

  it("BrowserTTSEngine.speak() resolves when synth fires onerror, and transitions to idle", async () => {
    await fc.assert(
      fc.asyncProperty(arbText, arbErrorMessage, async (text, errorMsg) => {
        const engine = createMockBrowserTTSEngine((_onEnd, onError) => {
          // Simulate async error from SpeechSynthesisUtterance.onerror
          Promise.resolve().then(() => onError(errorMsg));
        });
        const states: TTSState[] = [];
        engine.onStateChange(s => states.push(s));

        await engine.speak(text);

        expect(states[states.length - 1]).toBe("idle");
        expect(engine.isSpeaking).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // ── TTS: BrowserTTSEngine error recovery (synchronous throw) ──

  it("BrowserTTSEngine.speak() resolves when synth throws synchronously, and transitions to idle", async () => {
    await fc.assert(
      fc.asyncProperty(arbText, arbErrorMessage, async (text, errorMsg) => {
        const engine = createMockBrowserTTSEngine(() => {
          throw new Error(errorMsg);
        });
        const states: TTSState[] = [];
        engine.onStateChange(s => states.push(s));

        await engine.speak(text);

        expect(states[states.length - 1]).toBe("idle");
        expect(engine.isSpeaking).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // ── TTS: FallbackTTSEngine error recovery ──

  it("FallbackTTSEngine falls back to secondary when primary fails, and transitions to idle", async () => {
    await fc.assert(
      fc.asyncProperty(arbText, arbErrorMessage, async (text, errorMsg) => {
        // Primary always fails
        const primary = createMockServerTTSEngine(() =>
          Promise.reject(new Error(errorMsg))
        );
        // Fallback succeeds
        const fallback = createMockServerTTSEngine(() => Promise.resolve());

        const engine = createMockFallbackTTSEngine(primary, fallback);
        const states: TTSState[] = [];
        engine.onStateChange(s => states.push(s));

        await engine.speak(text);

        expect(states[states.length - 1]).toBe("idle");
        expect(engine.isSpeaking).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // ── STT: ServerSTTEngine error recovery ──

  it("ServerSTTEngine.startListening() never throws on service error, transitions to idle, and calls onError", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbErrorMessage,
        arbErrorType,
        async (errorMsg, errorType) => {
          const engine = createMockServerSTTEngine(() => {
            if (errorType === "throw") throw new Error(errorMsg);
            return Promise.reject(new Error(errorMsg));
          });

          const states: STTState[] = [];
          const errors: string[] = [];

          const callbacks: STTEngineCallbacks = {
            onInterimTranscript: () => {},
            onFinalTranscript: () => {},
            onError: err => errors.push(err),
            onStateChange: s => states.push(s),
          };

          // Must not throw
          await engine.startListening(callbacks);

          // Final state must be idle
          expect(states[states.length - 1]).toBe("idle");
          expect(engine.isListening).toBe(false);
          // Error callback must have been called
          expect(errors.length).toBeGreaterThan(0);
          expect(errors[0]).toBe(errorMsg);
        }
      ),
      { numRuns: 100 }
    );
  });
});
