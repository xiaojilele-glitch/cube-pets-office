/**
 * TTS Engine abstraction layer.
 *
 * Provides a unified interface for text-to-speech across:
 * - Browser SpeechSynthesis API (pure frontend mode)
 * - Server-side TTS service via POST /api/voice/tts + AudioContext playback
 *
 * Factory `createTTSEngine` picks the best available engine based on
 * server config, falling back to browser when the server is unavailable.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.5, 1.6
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TTSState = "speaking" | "paused" | "idle";

export interface TTSEngineOptions {
  voice?: string;
  rate?: number;
  pitch?: number;
  lang?: string;
}

export interface TTSEngine {
  readonly isAvailable: boolean;
  readonly isSpeaking: boolean;
  speak(text: string, options?: TTSEngineOptions): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  onStateChange(callback: (state: TTSState) => void): () => void;
}

/** Minimal client-side voice config (only availability matters). */
export interface ClientVoiceConfig {
  tts: { available: boolean };
  stt: { available: boolean };
}

// ---------------------------------------------------------------------------
// Browser TTS Engine
// ---------------------------------------------------------------------------

/**
 * Browser-based TTS engine using `window.speechSynthesis`.
 *
 * Requirements: 1.2
 */
export function createBrowserTTSEngine(): TTSEngine {
  const listeners = new Set<(state: TTSState) => void>();
  let speaking = false;

  function notify(state: TTSState) {
    speaking = state === "speaking";
    listeners.forEach((cb) => {
      try {
        cb(state);
      } catch {
        /* listener errors must not propagate */
      }
    });
  }

  const available =
    typeof window !== "undefined" && "speechSynthesis" in window;

  return {
    get isAvailable() {
      return available;
    },
    get isSpeaking() {
      return speaking;
    },

    speak(text: string, options?: TTSEngineOptions): Promise<void> {
      return new Promise<void>((resolve) => {
        if (!available) {
          console.error("[BrowserTTS] speechSynthesis not available");
          resolve();
          return;
        }

        try {
          // Stop any ongoing speech first
          window.speechSynthesis.cancel();

          const utterance = new SpeechSynthesisUtterance(text);
          if (options?.voice) {
            const voices = window.speechSynthesis.getVoices();
            const match = voices.find(
              (v) => v.name === options.voice || v.voiceURI === options.voice,
            );
            if (match) utterance.voice = match;
          }
          if (options?.rate != null) utterance.rate = options.rate;
          if (options?.pitch != null) utterance.pitch = options.pitch;
          utterance.lang = options?.lang ?? "zh-CN";

          utterance.onstart = () => notify("speaking");
          utterance.onpause = () => notify("paused");
          utterance.onresume = () => notify("speaking");
          utterance.onend = () => {
            notify("idle");
            resolve();
          };
          utterance.onerror = (e) => {
            console.error("[BrowserTTS] utterance error:", e.error);
            notify("idle");
            resolve(); // graceful degradation — never reject
          };

          window.speechSynthesis.speak(utterance);
        } catch (err) {
          console.error("[BrowserTTS] speak error:", err);
          notify("idle");
          resolve();
        }
      });
    },

    pause() {
      if (available) {
        try {
          window.speechSynthesis.pause();
        } catch (err) {
          console.error("[BrowserTTS] pause error:", err);
        }
      }
    },

    resume() {
      if (available) {
        try {
          window.speechSynthesis.resume();
        } catch (err) {
          console.error("[BrowserTTS] resume error:", err);
        }
      }
    },

    stop() {
      if (available) {
        try {
          window.speechSynthesis.cancel();
          notify("idle");
        } catch (err) {
          console.error("[BrowserTTS] stop error:", err);
          notify("idle");
        }
      }
    },

    onStateChange(callback: (state: TTSState) => void): () => void {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Server TTS Engine
// ---------------------------------------------------------------------------

/**
 * Server-based TTS engine that POSTs to /api/voice/tts and plays the
 * returned audio/mpeg via AudioContext.
 *
 * Requirements: 1.3
 */
export function createServerTTSEngine(apiUrl: string): TTSEngine {
  const listeners = new Set<(state: TTSState) => void>();
  let speaking = false;
  let available = false;
  let audioCtx: AudioContext | null = null;
  let currentSource: AudioBufferSourceNode | null = null;

  // Check availability asynchronously via GET /api/voice/config
  if (typeof window !== "undefined") {
    checkAvailability();
  }

  async function checkAvailability() {
    try {
      const res = await fetch(`${apiUrl}/config`);
      if (res.ok) {
        const data = (await res.json()) as { tts: { available: boolean } };
        available = data.tts.available;
      }
    } catch {
      available = false;
    }
  }

  function notify(state: TTSState) {
    speaking = state === "speaking";
    listeners.forEach((cb) => {
      try {
        cb(state);
      } catch {
        /* listener errors must not propagate */
      }
    });
  }

  function getAudioContext(): AudioContext {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    return audioCtx;
  }

  return {
    get isAvailable() {
      return available;
    },
    get isSpeaking() {
      return speaking;
    },

    async speak(text: string, options?: TTSEngineOptions): Promise<void> {
      // Stop any ongoing playback first
      this.stop();

      try {
        const body: Record<string, unknown> = { text };
        if (options?.voice) body.voice = options.voice;

        const res = await fetch(`${apiUrl}/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => "unknown error");
          throw new Error(`Server TTS error (${res.status}): ${detail}`);
        }

        const arrayBuffer = await res.arrayBuffer();
        const ctx = getAudioContext();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        currentSource = source;

        return new Promise<void>((resolve) => {
          source.onended = () => {
            currentSource = null;
            notify("idle");
            resolve();
          };
          notify("speaking");
          source.start(0);
        });
      } catch (err) {
        console.error("[ServerTTS] speak error:", err);
        currentSource = null;
        notify("idle");
        // Graceful degradation — resolve, never reject (Req 1.5)
      }
    },

    pause() {
      // AudioContext-based playback doesn't natively support pause/resume
      // on a BufferSourceNode. We suspend the context as a workaround.
      if (audioCtx && speaking) {
        audioCtx.suspend().then(() => notify("paused")).catch(() => {});
      }
    },

    resume() {
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume().then(() => notify("speaking")).catch(() => {});
      }
    },

    stop() {
      try {
        if (currentSource) {
          currentSource.stop();
          currentSource = null;
        }
      } catch {
        currentSource = null;
      }
      notify("idle");
    },

    onStateChange(callback: (state: TTSState) => void): () => void {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the best available TTS engine based on voice config.
 *
 * Strategy:
 * 1. If server TTS is available → use ServerTTSEngine
 * 2. Otherwise → fallback to BrowserTTSEngine
 *
 * Requirements: 1.6
 */
export function createTTSEngine(config: ClientVoiceConfig): TTSEngine {
  if (config.tts.available) {
    const serverEngine = createServerTTSEngine("/api/voice");
    // Even when server reports available, wrap with browser fallback
    // in case server calls fail at runtime (Req 1.5, 1.6)
    const browserEngine = createBrowserTTSEngine();
    return createFallbackTTSEngine(serverEngine, browserEngine);
  }
  return createBrowserTTSEngine();
}

// ---------------------------------------------------------------------------
// Fallback wrapper (internal)
// ---------------------------------------------------------------------------

/**
 * Wraps a primary engine with a fallback: if the primary `speak()` fails
 * (throws or the engine becomes unavailable), the fallback engine is used.
 */
function createFallbackTTSEngine(
  primary: TTSEngine,
  fallback: TTSEngine,
): TTSEngine {
  const listeners = new Set<(state: TTSState) => void>();
  let activeEngine: TTSEngine = primary;
  let speaking = false;

  // Forward state changes from whichever engine is active
  function wireListeners(engine: TTSEngine) {
    return engine.onStateChange((state) => {
      speaking = state === "speaking";
      listeners.forEach((cb) => {
        try {
          cb(state);
        } catch {
          /* swallow */
        }
      });
    });
  }

  let unsubPrimary = wireListeners(primary);
  let unsubFallback: (() => void) | null = null;

  function switchToFallback() {
    if (activeEngine === fallback) return;
    unsubPrimary();
    activeEngine = fallback;
    unsubFallback = wireListeners(fallback);
    console.warn("[TTS] Primary engine failed, falling back to browser TTS");
  }

  return {
    get isAvailable() {
      return primary.isAvailable || fallback.isAvailable;
    },
    get isSpeaking() {
      return speaking;
    },

    async speak(text: string, options?: TTSEngineOptions): Promise<void> {
      if (activeEngine === primary && primary.isAvailable) {
        try {
          await primary.speak(text, options);
          return;
        } catch {
          // Primary failed — switch to fallback
          switchToFallback();
        }
      }

      if (fallback.isAvailable) {
        await fallback.speak(text, options);
      } else {
        console.error("[TTS] No TTS engine available");
      }
    },

    pause() {
      activeEngine.pause();
    },

    resume() {
      activeEngine.resume();
    },

    stop() {
      activeEngine.stop();
    },

    onStateChange(callback: (state: TTSState) => void): () => void {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
        if (listeners.size === 0) {
          unsubPrimary();
          unsubFallback?.();
        }
      };
    },
  };
}
