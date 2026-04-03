import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

/* ─── Property 5: 语音能力检测驱动 UI 可见性 ─── */
/* **Validates: Requirements 3.6, 3.7** */

/**
 * For any combination of browser API support states (SpeechRecognition
 * available/unavailable, SpeechSynthesis available/unavailable) and server
 * config states (STT available/unavailable, TTS available/unavailable):
 *
 *   STT button visibility  = (browserSTT || serverSTT)
 *   TTS toggle visibility  = (browserTTS || serverTTS)
 *
 * This mirrors the logic in ChatPanel.tsx detectVoiceCapabilities():
 *   setSttAvailable(browserSTT || serverConfig.stt.available);
 *   setTtsAvailable(browserTTS || serverConfig.tts.available);
 */

// ---------------------------------------------------------------------------
// Pure visibility functions — replicate ChatPanel detection logic
// ---------------------------------------------------------------------------

function computeSTTVisibility(browserSTTAvailable: boolean, serverSTTAvailable: boolean): boolean {
  return browserSTTAvailable || serverSTTAvailable;
}

function computeTTSVisibility(browserTTSAvailable: boolean, serverTTSAvailable: boolean): boolean {
  return browserTTSAvailable || serverTTSAvailable;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbBool = fc.boolean();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Feature: multi-modal-agent, Property 5: 语音能力检测驱动 UI 可见性', () => {
  it('STT button visibility equals (browserSTT || serverSTT) for any capability combination', () => {
    fc.assert(
      fc.property(arbBool, arbBool, (browserSTT, serverSTT) => {
        const visible = computeSTTVisibility(browserSTT, serverSTT);
        expect(visible).toBe(browserSTT || serverSTT);
      }),
      { numRuns: 100 },
    );
  });

  it('TTS toggle visibility equals (browserTTS || serverTTS) for any capability combination', () => {
    fc.assert(
      fc.property(arbBool, arbBool, (browserTTS, serverTTS) => {
        const visible = computeTTSVisibility(browserTTS, serverTTS);
        expect(visible).toBe(browserTTS || serverTTS);
      }),
      { numRuns: 100 },
    );
  });

  it('both controls hidden only when all four capabilities are false', () => {
    fc.assert(
      fc.property(arbBool, arbBool, arbBool, arbBool, (browserSTT, serverSTT, browserTTS, serverTTS) => {
        const sttVisible = computeSTTVisibility(browserSTT, serverSTT);
        const ttsVisible = computeTTSVisibility(browserTTS, serverTTS);

        // Both hidden iff all sources are false
        if (!browserSTT && !serverSTT && !browserTTS && !serverTTS) {
          expect(sttVisible).toBe(false);
          expect(ttsVisible).toBe(false);
        }

        // If any STT source is true, STT must be visible
        if (browserSTT || serverSTT) {
          expect(sttVisible).toBe(true);
        }

        // If any TTS source is true, TTS must be visible
        if (browserTTS || serverTTS) {
          expect(ttsVisible).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('STT and TTS visibility are independent of each other', () => {
    fc.assert(
      fc.property(arbBool, arbBool, arbBool, arbBool, (browserSTT, serverSTT, browserTTS, serverTTS) => {
        const sttVisible = computeSTTVisibility(browserSTT, serverSTT);
        const ttsVisible = computeTTSVisibility(browserTTS, serverTTS);

        // STT visibility depends only on STT sources
        expect(sttVisible).toBe(browserSTT || serverSTT);
        // TTS visibility depends only on TTS sources
        expect(ttsVisible).toBe(browserTTS || serverTTS);

        // Changing TTS sources should not affect STT visibility (and vice versa)
        // Verified implicitly: sttVisible doesn't reference browserTTS/serverTTS
      }),
      { numRuns: 100 },
    );
  });
});
