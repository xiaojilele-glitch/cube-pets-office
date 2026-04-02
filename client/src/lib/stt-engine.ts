/**
 * STT Engine abstraction layer.
 *
 * Provides a unified interface for speech-to-text across:
 * - Browser SpeechRecognition API (pure frontend mode)
 * - Server-side STT service via MediaRecorder + POST /api/voice/stt
 *
 * Factory `createSTTEngine` picks the best available engine based on
 * server config, falling back to browser when the server is unavailable.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.8
 */

import type { ClientVoiceConfig } from "./tts-engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type STTState = "listening" | "idle";

export interface STTEngineCallbacks {
  onInterimTranscript: (text: string) => void;
  onFinalTranscript: (text: string) => void;
  onError: (error: string) => void;
  onStateChange: (state: STTState) => void;
}

export interface STTEngine {
  readonly isAvailable: boolean;
  readonly isListening: boolean;
  startListening(callbacks: STTEngineCallbacks): Promise<void>;
  stopListening(): void;
}

// ---------------------------------------------------------------------------
// Web Speech API type shims (not in default TS lib when `types` is restricted)
// ---------------------------------------------------------------------------

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { readonly transcript: string; readonly confidence: number };
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onresult:
    | ((this: SpeechRecognitionInstance, ev: SpeechRecognitionEvent) => void)
    | null;
  onerror:
    | ((
        this: SpeechRecognitionInstance,
        ev: SpeechRecognitionErrorEvent,
      ) => void)
    | null;
  onend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/** 3-second silence timeout (ms) for BrowserSTTEngine auto-stop. */
const SILENCE_TIMEOUT_MS = 3_000;

// ---------------------------------------------------------------------------
// Browser STT Engine
// ---------------------------------------------------------------------------

/**
 * Browser-based STT engine using `webkitSpeechRecognition` or
 * `SpeechRecognition` API.
 *
 * - continuous = true, interimResults = true
 * - 3-second silence timeout auto-stop
 *
 * Requirements: 2.2, 2.4
 */
export function createBrowserSTTEngine(lang?: string): STTEngine {
  let listening = false;
  let recognition: SpeechRecognitionInstance | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let currentCallbacks: STTEngineCallbacks | null = null;

  const available =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  function clearSilenceTimer() {
    if (silenceTimer !== null) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  function resetSilenceTimer() {
    clearSilenceTimer();
    silenceTimer = setTimeout(() => {
      // Auto-stop after 3 seconds of silence (Req 2.3)
      if (listening && recognition) {
        recognition.stop();
      }
    }, SILENCE_TIMEOUT_MS);
  }

  function cleanup() {
    clearSilenceTimer();
    listening = false;
    recognition = null;
    currentCallbacks?.onStateChange("idle");
    currentCallbacks = null;
  }

  return {
    get isAvailable() {
      return available;
    },
    get isListening() {
      return listening;
    },

    startListening(callbacks: STTEngineCallbacks): Promise<void> {
      return new Promise<void>((resolve) => {
        if (!available) {
          callbacks.onError("SpeechRecognition API not available");
          resolve();
          return;
        }

        // Stop any ongoing recognition first
        if (recognition) {
          try {
            recognition.stop();
          } catch {
            /* ignore */
          }
          cleanup();
        }

        try {
          const SpeechRecognitionCtor =
            (window as unknown as Record<string, unknown>)
              .SpeechRecognition ??
            (window as unknown as Record<string, unknown>)
              .webkitSpeechRecognition;

          recognition = new (SpeechRecognitionCtor as {
            new (): SpeechRecognitionInstance;
          })();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = lang ?? "zh-CN";

          currentCallbacks = callbacks;

          recognition.onstart = () => {
            listening = true;
            callbacks.onStateChange("listening");
            resetSilenceTimer();
            resolve();
          };

          recognition.onresult = (event) => {
            resetSilenceTimer();

            let interim = "";
            let final_ = "";

            for (let i = event.resultIndex; i < event.results.length; i++) {
              const result = event.results[i];
              if (result.isFinal) {
                final_ += result[0].transcript;
              } else {
                interim += result[0].transcript;
              }
            }

            if (interim) callbacks.onInterimTranscript(interim);
            if (final_) callbacks.onFinalTranscript(final_);
          };

          recognition.onerror = (event) => {
            console.error("[BrowserSTT] recognition error:", event.error);
            callbacks.onError(event.error);
            cleanup();
            resolve(); // graceful — never reject
          };

          recognition.onend = () => {
            cleanup();
          };

          recognition.start();
        } catch (err) {
          console.error("[BrowserSTT] startListening error:", err);
          callbacks.onError(
            err instanceof Error ? err.message : "Unknown error",
          );
          cleanup();
          resolve();
        }
      });
    },

    stopListening() {
      if (recognition) {
        try {
          recognition.stop();
        } catch (err) {
          console.error("[BrowserSTT] stopListening error:", err);
          cleanup();
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Server STT Engine
// ---------------------------------------------------------------------------

/**
 * Server-based STT engine that records audio via MediaRecorder and sends
 * the recorded Blob to POST /api/voice/stt on stop.
 *
 * - No interim results (only final on stop)
 * - Uses audio/webm format
 *
 * Requirements: 2.5
 */
export function createServerSTTEngine(
  apiUrl: string,
  lang?: string,
): STTEngine {
  let listening = false;
  let available = false;
  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];
  let currentCallbacks: STTEngineCallbacks | null = null;
  let mediaStream: MediaStream | null = null;

  // Check availability asynchronously via GET /api/voice/config
  if (typeof window !== "undefined") {
    checkAvailability();
  }

  async function checkAvailability() {
    try {
      const res = await fetch(`${apiUrl}/config`);
      if (res.ok) {
        const data = (await res.json()) as { stt: { available: boolean } };
        available = data.stt.available;
      }
    } catch {
      available = false;
    }
  }

  function cleanup() {
    // Stop all media tracks
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    mediaRecorder = null;
    audioChunks = [];
    listening = false;
    currentCallbacks?.onStateChange("idle");
    currentCallbacks = null;
  }

  async function sendAudioToServer(blob: Blob): Promise<void> {
    const callbacks = currentCallbacks;
    if (!callbacks) return;

    try {
      const formData = new FormData();
      formData.append("audio", blob, "recording.webm");
      if (lang) formData.append("lang", lang);

      const res = await fetch(`${apiUrl}/stt`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "unknown error");
        throw new Error(`Server STT error (${res.status}): ${detail}`);
      }

      const data = (await res.json()) as { transcript: string };
      if (data.transcript) {
        callbacks.onFinalTranscript(data.transcript);
      }
    } catch (err) {
      console.error("[ServerSTT] sendAudio error:", err);
      callbacks.onError(
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  }

  return {
    get isAvailable() {
      return available;
    },
    get isListening() {
      return listening;
    },

    async startListening(callbacks: STTEngineCallbacks): Promise<void> {
      // Stop any ongoing recording first
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        try {
          mediaRecorder.stop();
        } catch {
          /* ignore */
        }
        cleanup();
      }

      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });

        mediaRecorder = new MediaRecorder(mediaStream, {
          mimeType: "audio/webm",
        });
        audioChunks = [];
        currentCallbacks = callbacks;

        mediaRecorder.ondataavailable = (event: BlobEvent) => {
          if (event.data.size > 0) {
            audioChunks.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          const blob = new Blob(audioChunks, { type: "audio/webm" });
          await sendAudioToServer(blob);
          cleanup();
        };

        mediaRecorder.onerror = () => {
          console.error("[ServerSTT] MediaRecorder error");
          callbacks.onError("MediaRecorder error");
          cleanup();
        };

        mediaRecorder.start();
        listening = true;
        callbacks.onStateChange("listening");
      } catch (err) {
        console.error("[ServerSTT] startListening error:", err);
        callbacks.onError(
          err instanceof Error ? err.message : "Unknown error",
        );
        cleanup();
        // Graceful degradation — never throw (Req 2.7)
      }
    },

    stopListening() {
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        try {
          mediaRecorder.stop();
        } catch (err) {
          console.error("[ServerSTT] stopListening error:", err);
          cleanup();
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the best available STT engine based on voice config.
 *
 * Strategy:
 * 1. If server STT is available → use ServerSTTEngine
 * 2. Otherwise → fallback to BrowserSTTEngine
 * 3. All errors caught, engine transitions to idle (graceful degradation)
 *
 * Requirements: 2.7, 2.8
 */
export function createSTTEngine(config: ClientVoiceConfig): STTEngine {
  if (config.stt.available) {
    const serverEngine = createServerSTTEngine("/api/voice");
    const browserEngine = createBrowserSTTEngine();
    return createFallbackSTTEngine(serverEngine, browserEngine);
  }
  return createBrowserSTTEngine();
}

// ---------------------------------------------------------------------------
// Fallback wrapper (internal)
// ---------------------------------------------------------------------------

/**
 * Wraps a primary engine with a fallback: if the primary `startListening()`
 * fails (throws or the engine becomes unavailable), the fallback engine is
 * used.
 */
function createFallbackSTTEngine(
  primary: STTEngine,
  fallback: STTEngine,
): STTEngine {
  let activeEngine: STTEngine = primary;

  function switchToFallback() {
    if (activeEngine === fallback) return;
    activeEngine = fallback;
    console.warn("[STT] Primary engine failed, falling back to browser STT");
  }

  return {
    get isAvailable() {
      return primary.isAvailable || fallback.isAvailable;
    },
    get isListening() {
      return activeEngine.isListening;
    },

    async startListening(callbacks: STTEngineCallbacks): Promise<void> {
      if (activeEngine === primary && primary.isAvailable) {
        try {
          await primary.startListening(callbacks);
          return;
        } catch {
          // Primary failed — switch to fallback
          switchToFallback();
        }
      }

      if (fallback.isAvailable) {
        await fallback.startListening(callbacks);
      } else {
        callbacks.onError("No STT engine available");
        callbacks.onStateChange("idle");
      }
    },

    stopListening() {
      activeEngine.stopListening();
    },
  };
}
