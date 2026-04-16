/**
 * Unit tests for tts-engine.ts
 *
 * Tests BrowserTTSEngine, ServerTTSEngine, and createTTSEngine factory.
 * Requirements: 1.1, 1.2, 1.3, 1.5, 1.6
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TTSEngine, TTSState, ClientVoiceConfig } from "./tts-engine";
import {
  createBrowserTTSEngine,
  createServerTTSEngine,
  createTTSEngine,
} from "./tts-engine";

// ─── Mock helpers ───

/** Minimal SpeechSynthesisUtterance stub */
class MockUtterance {
  text: string;
  lang = "";
  rate = 1;
  pitch = 1;
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onresume: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function createMockSpeechSynthesis() {
  let currentUtterance: MockUtterance | null = null;
  return {
    speak: vi.fn((u: MockUtterance) => {
      currentUtterance = u;
    }),
    cancel: vi.fn(() => {
      currentUtterance = null;
    }),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: vi.fn(() => []),
    get _current() {
      return currentUtterance;
    },
  };
}

// ─── Browser TTS Engine ───

describe("createBrowserTTSEngine", () => {
  let mockSynth: ReturnType<typeof createMockSpeechSynthesis>;

  beforeEach(() => {
    mockSynth = createMockSpeechSynthesis();
    (globalThis as any).window = globalThis;
    (globalThis as any).speechSynthesis = mockSynth;
    (globalThis as any).SpeechSynthesisUtterance = MockUtterance;
  });

  afterEach(() => {
    delete (globalThis as any).speechSynthesis;
    delete (globalThis as any).SpeechSynthesisUtterance;
  });

  it("should report isAvailable = true when speechSynthesis exists", () => {
    const engine = createBrowserTTSEngine();
    expect(engine.isAvailable).toBe(true);
  });

  it("should start as not speaking", () => {
    const engine = createBrowserTTSEngine();
    expect(engine.isSpeaking).toBe(false);
  });

  it("should transition to speaking then idle on successful speak", async () => {
    const engine = createBrowserTTSEngine();
    const states: TTSState[] = [];
    engine.onStateChange(s => states.push(s));

    const promise = engine.speak("hello");

    // Simulate utterance lifecycle
    const utterance = mockSynth._current!;
    utterance.onstart?.();
    expect(engine.isSpeaking).toBe(true);

    utterance.onend?.();
    await promise;

    expect(engine.isSpeaking).toBe(false);
    expect(states).toEqual(["speaking", "idle"]);
  });

  it("should gracefully handle utterance error without rejecting", async () => {
    const engine = createBrowserTTSEngine();
    const states: TTSState[] = [];
    engine.onStateChange(s => states.push(s));

    const promise = engine.speak("fail");
    const utterance = mockSynth._current!;
    utterance.onstart?.();
    utterance.onerror?.({ error: "synthesis-failed" });

    await promise; // should resolve, not reject
    expect(engine.isSpeaking).toBe(false);
    expect(states).toContain("idle");
  });

  it("should apply TTSEngineOptions to utterance", async () => {
    const engine = createBrowserTTSEngine();
    const promise = engine.speak("test", {
      rate: 1.5,
      pitch: 0.8,
      lang: "en-US",
    });

    const utterance = mockSynth._current!;
    expect(utterance.rate).toBe(1.5);
    expect(utterance.pitch).toBe(0.8);
    expect(utterance.lang).toBe("en-US");

    utterance.onend?.();
    await promise;
  });

  it("should default lang to zh-CN", async () => {
    const engine = createBrowserTTSEngine();
    const promise = engine.speak("你好");
    const utterance = mockSynth._current!;
    expect(utterance.lang).toBe("zh-CN");
    utterance.onend?.();
    await promise;
  });

  it("stop() should cancel synthesis and transition to idle", () => {
    const engine = createBrowserTTSEngine();
    const states: TTSState[] = [];
    engine.onStateChange(s => states.push(s));

    engine.stop();

    expect(mockSynth.cancel).toHaveBeenCalled();
    expect(states).toContain("idle");
  });

  it("pause() should call speechSynthesis.pause()", () => {
    const engine = createBrowserTTSEngine();
    engine.pause();
    expect(mockSynth.pause).toHaveBeenCalled();
  });

  it("resume() should call speechSynthesis.resume()", () => {
    const engine = createBrowserTTSEngine();
    engine.resume();
    expect(mockSynth.resume).toHaveBeenCalled();
  });

  it("onStateChange unsubscribe should stop notifications", async () => {
    const engine = createBrowserTTSEngine();
    const states: TTSState[] = [];
    const unsub = engine.onStateChange(s => states.push(s));

    unsub();

    const promise = engine.speak("test");
    const utterance = mockSynth._current!;
    utterance.onstart?.();
    utterance.onend?.();
    await promise;

    expect(states).toEqual([]); // no notifications after unsub
  });
});

// ─── Server TTS Engine ───

describe("createServerTTSEngine", () => {
  beforeEach(() => {
    (globalThis as any).window = globalThis;
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("AudioContext", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should start as not speaking", () => {
    // Mock the config check
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ tts: { available: true } }), {
        status: 200,
      })
    );
    const engine = createServerTTSEngine("/api/voice");
    expect(engine.isSpeaking).toBe(false);
  });

  it("should transition to speaking then idle on successful speak", async () => {
    // Mock config check
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ tts: { available: true } }), {
        status: 200,
      })
    );

    // Create a minimal AudioContext mock
    const mockSource = {
      buffer: null as unknown,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as (() => void) | null,
    };
    const mockAudioCtx = {
      destination: {},
      state: "running",
      createBufferSource: vi.fn(() => mockSource),
      decodeAudioData: vi.fn().mockResolvedValue({ duration: 1 }),
      suspend: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(AudioContext).mockImplementation(() => mockAudioCtx as any);

    const engine = createServerTTSEngine("/api/voice");
    const states: TTSState[] = [];
    engine.onStateChange(s => states.push(s));

    // Mock the TTS POST response
    const audioData = new ArrayBuffer(100);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(audioData, {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      })
    );

    const promise = engine.speak("hello");

    // Wait for fetch + decode to complete, then simulate playback end
    await vi.waitFor(() => {
      expect(mockSource.start).toHaveBeenCalled();
    });

    mockSource.onended?.();
    await promise;

    expect(states).toEqual(["idle", "speaking", "idle"]);
  });

  it("should gracefully handle fetch error without rejecting", async () => {
    // Mock config check
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ tts: { available: true } }), {
        status: 200,
      })
    );

    const engine = createServerTTSEngine("/api/voice");
    const states: TTSState[] = [];
    engine.onStateChange(s => states.push(s));

    // Mock TTS POST failure
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network error"));

    await engine.speak("fail"); // should resolve, not reject
    expect(engine.isSpeaking).toBe(false);
  });

  it("should gracefully handle non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ tts: { available: true } }), {
        status: 200,
      })
    );

    const engine = createServerTTSEngine("/api/voice");

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("service unavailable", { status: 503 })
    );

    await engine.speak("fail"); // should resolve gracefully
    expect(engine.isSpeaking).toBe(false);
  });
});

// ─── createTTSEngine factory ───

describe("createTTSEngine", () => {
  beforeEach(() => {
    (globalThis as any).window = globalThis;
    (globalThis as any).speechSynthesis = createMockSpeechSynthesis();
    (globalThis as any).SpeechSynthesisUtterance = MockUtterance;
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("AudioContext", vi.fn());
  });

  afterEach(() => {
    delete (globalThis as any).speechSynthesis;
    delete (globalThis as any).SpeechSynthesisUtterance;
    vi.restoreAllMocks();
  });

  it("should return a browser engine when server TTS is not available", () => {
    const config: ClientVoiceConfig = {
      tts: { available: false },
      stt: { available: false },
    };
    const engine = createTTSEngine(config);
    expect(engine).toBeDefined();
    expect(engine.isAvailable).toBe(true); // browser speechSynthesis is mocked
  });

  it("should return a fallback-wrapped engine when server TTS is available", () => {
    // Mock config fetch for server engine availability check
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ tts: { available: true } }), {
        status: 200,
      })
    );

    const config: ClientVoiceConfig = {
      tts: { available: true },
      stt: { available: false },
    };
    const engine = createTTSEngine(config);
    expect(engine).toBeDefined();
    // The fallback engine should report available since browser is available
    expect(engine.isAvailable).toBe(true);
  });

  it("should expose all TTSEngine interface methods", () => {
    const config: ClientVoiceConfig = {
      tts: { available: false },
      stt: { available: false },
    };
    const engine = createTTSEngine(config);

    expect(typeof engine.speak).toBe("function");
    expect(typeof engine.pause).toBe("function");
    expect(typeof engine.resume).toBe("function");
    expect(typeof engine.stop).toBe("function");
    expect(typeof engine.onStateChange).toBe("function");
    expect(typeof engine.isAvailable).toBe("boolean");
    expect(typeof engine.isSpeaking).toBe("boolean");
  });
});
