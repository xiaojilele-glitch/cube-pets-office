import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MessageCircle,
  Mic,
  MicOff,
  Monitor,
  Play,
  Send,
  Server,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { GlowButton } from "@/components/ui/GlowButton";

import {
  DEFAULT_AGENT_ID,
  getAgentChatRole,
  getAgentEmoji,
  getAgentLabel,
} from "@/lib/agent-config";
import { fetchJsonSafe, type ApiRequestError } from "@/lib/api-client";
import { callBrowserLLM } from "@/lib/browser-llm";
import { CAN_USE_ADVANCED_RUNTIME } from "@/lib/deploy-target";
import { createSTTEngine, type STTEngine } from "@/lib/stt-engine";
import { useAppStore, type ChatMessage } from "@/lib/store";
import {
  createTTSEngine,
  type ClientVoiceConfig,
  type TTSEngine,
} from "@/lib/tts-engine";
import { useI18n } from "@/i18n";
import { useViewportTier } from "@/hooks/useViewportTier";

const PAPER_CONTEXT = `You are a cute cube-pet research assistant working in a warm study.

You are discussing a paper about turning one natural-language instruction into coordinated multi-agent work.

Core ideas:
- An organizational mirror maps one request into coordinated execution.
- The structure is CEO -> Manager -> Worker.
- The system includes 18 agents, departmental delegation, memory, review, revision, and meta-audit.
- A 3D front end visualizes each agent's work state in real time.

Reply naturally, stay concise, and keep a bit of character.`;

function buildFrontendModeReply({
  input,
  canUseAdvancedRuntime,
  copy,
}: {
  input: string;
  canUseAdvancedRuntime: boolean;
  copy: ReturnType<typeof useI18n>["copy"];
}) {
  const normalized = input.toLowerCase();

  if (/workflow|phase|flow|阶段|流程|工作流|编排/.test(normalized)) {
    return copy.chat.presets.workflow;
  }

  if (/memory|report|heartbeat|soul|记忆|报告/.test(normalized)) {
    return copy.chat.presets.memory;
  }

  if (/help|mode|how|use|怎么|如何|模式/.test(normalized)) {
    return canUseAdvancedRuntime
      ? copy.chat.presets.helpAdvanced
      : copy.chat.presets.helpPages;
  }

  if (canUseAdvancedRuntime) {
    return copy.chat.presets.genericAdvanced;
  }

  return copy.chat.presets.genericPages;
}

function getModeLabel(
  runtimeMode: "frontend" | "advanced",
  browserDirect: boolean,
  copy: ReturnType<typeof useI18n>["copy"]
) {
  if (runtimeMode === "frontend") {
    return browserDirect
      ? copy.chat.modeLabels.frontendBrowser
      : copy.chat.modeLabels.frontendPreview;
  }

  return browserDirect
    ? copy.chat.modeLabels.browserDirect
    : copy.chat.modeLabels.serverProxy;
}

function isApiRequestError(error: unknown): error is ApiRequestError {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<ApiRequestError>;
  return (
    typeof candidate.endpoint === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.detail === "string"
  );
}

export function buildChatErrorContent(
  error: unknown,
  copy: ReturnType<typeof useI18n>["copy"]
) {
  if (isApiRequestError(error)) {
    return `${copy.chat.errorTitle}\n${error.message}\n${error.detail}`;
  }

  const safeMessage =
    error instanceof Error &&
    error.message &&
    !error.message.includes("Unexpected token")
      ? error.message
      : copy.chat.errorHint;

  return `${copy.chat.errorTitle}\n${safeMessage}`;
}

export function ChatPanel({ embedded = false }: { embedded?: boolean }) {
  const {
    chatMessages,
    addMessage,
    clearChat,
    isChatOpen,
    toggleChat,
    isLoading,
    setLoading,
    aiConfig,
    selectedPet,
    runtimeMode,
    locale,
    ttsEnabled,
    setTtsEnabled,
    sttAvailable,
    setSttAvailable,
    ttsAvailable,
    setTtsAvailable,
  } = useAppStore();
  const { copy } = useI18n();
  const { isMobile, isTablet } = useViewportTier();

  const [input, setInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [playingMessageIndex, setPlayingMessageIndex] = useState<number | null>(
    null
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sttEngineRef = useRef<STTEngine | null>(null);
  const ttsEngineRef = useRef<TTSEngine | null>(null);

  const agentId = selectedPet || DEFAULT_AGENT_ID;
  const agentName = getAgentLabel(agentId);
  const agentEmoji = getAgentEmoji(agentId);
  const agentRole = getAgentChatRole(agentId, locale);
  const isFrontendMode = runtimeMode === "frontend";
  const isBrowserDirect = aiConfig.mode === "browser_direct";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    if (!isChatOpen) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 250);
    return () => window.clearTimeout(timer);
  }, [isChatOpen]);

  // Check voice capabilities on mount (Req 3.6, 3.7)
  useEffect(() => {
    let cancelled = false;

    async function detectVoiceCapabilities() {
      // Browser API checks
      const browserSTT =
        typeof window !== "undefined" &&
        ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
      const browserTTS =
        typeof window !== "undefined" && "speechSynthesis" in window;

      // Server config check
      let serverConfig: ClientVoiceConfig = {
        tts: { available: false },
        stt: { available: false },
      };
      try {
        const result =
          await fetchJsonSafe<ClientVoiceConfig>("/api/voice/config");
        if (result.ok) {
          serverConfig = result.data;
        }
      } catch {
        // Server unavailable — rely on browser APIs only
      }

      if (cancelled) return;
      setSttAvailable(browserSTT || serverConfig.stt.available);
      setTtsAvailable(browserTTS || serverConfig.tts.available);

      // Create STT engine with detected config
      sttEngineRef.current = createSTTEngine(serverConfig);

      // Create TTS engine with detected config (Req 3.3, 3.5)
      ttsEngineRef.current = createTTSEngine(serverConfig);
    }

    void detectVoiceCapabilities();
    return () => {
      cancelled = true;
    };
  }, [setSttAvailable, setTtsAvailable]);

  // Reset playingMessageIndex when TTS engine goes idle (Req 3.5)
  useEffect(() => {
    const engine = ttsEngineRef.current;
    if (!engine) return;
    const unsub = engine.onStateChange(state => {
      if (state === "idle") {
        setPlayingMessageIndex(null);
      }
    });
    return unsub;
  });

  const toggleRecording = useCallback(() => {
    const engine = sttEngineRef.current;
    if (!engine) return;

    if (isRecording) {
      engine.stopListening();
      setIsRecording(false);
      setInterimText("");
      return;
    }

    void engine.startListening({
      onInterimTranscript: text => {
        setInterimText(text);
      },
      onFinalTranscript: text => {
        setInput(prev => (prev ? `${prev} ${text}` : text));
        setInterimText("");
      },
      onError: error => {
        console.error("[ChatPanel STT] error:", error);
        setIsRecording(false);
        setInterimText("");
      },
      onStateChange: state => {
        setIsRecording(state === "listening");
        if (state === "idle") setInterimText("");
      },
    });
  }, [isRecording]);

  // Play or stop TTS for a specific message (Req 3.3, 3.5)
  const handleTtsPlay = useCallback(
    (index: number, content: string) => {
      const engine = ttsEngineRef.current;
      if (!engine) return;

      // If already playing this message, stop it
      if (playingMessageIndex === index) {
        engine.stop();
        setPlayingMessageIndex(null);
        return;
      }

      // Stop any ongoing playback first
      engine.stop();
      setPlayingMessageIndex(index);
      void engine.speak(content);
    },
    [playingMessageIndex]
  );

  const shellClass = useMemo(() => {
    if (isMobile) {
      return "left-2 right-2 bottom-[calc(env(safe-area-inset-bottom)+8px)] top-[calc(env(safe-area-inset-top)+108px)] rounded-[30px]";
    }

    if (isTablet) {
      return "bottom-5 right-5 h-[min(68svh,560px)] w-[380px] rounded-3xl";
    }

    return "bottom-6 right-6 h-[560px] w-[390px] rounded-3xl";
  }, [isMobile, isTablet]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const currentInput = input.trim();
    const userMessage: ChatMessage = {
      role: "user",
      content: currentInput,
      timestamp: Date.now(),
    };

    addMessage(userMessage);
    setInput("");
    setLoading(true);

    try {
      const messages = [
        {
          role: "system" as const,
          content: `${PAPER_CONTEXT}\n\nCurrent role: ${agentName} ${agentEmoji}\nRole description: ${agentRole}`,
        },
        ...chatMessages.slice(-10).map(message => ({
          role: message.role,
          content: message.content,
        })),
        { role: "user" as const, content: currentInput },
      ];

      let assistantContent: string = copy.chat.lostThought;

      if (isFrontendMode && !isBrowserDirect) {
        await new Promise(resolve => window.setTimeout(resolve, 280));
        assistantContent = buildFrontendModeReply({
          input: currentInput,
          canUseAdvancedRuntime: CAN_USE_ADVANCED_RUNTIME,
          copy,
        });
      } else if (isBrowserDirect) {
        const data = await callBrowserLLM(messages, aiConfig, {
          maxTokens: 400,
          temperature: 0.7,
        });
        assistantContent = data.content || assistantContent;
      } else {
        const result = await fetchJsonSafe<{ content?: string }>("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages,
            maxTokens: 400,
            temperature: 0.7,
          }),
        });

        if (!result.ok) {
          throw result.error;
        }

        assistantContent = result.data.content || assistantContent;
      }

      addMessage({
        role: "assistant",
        content: assistantContent,
        petName: agentId,
        timestamp: Date.now(),
      });
    } catch (error) {
      addMessage({
        role: "assistant",
        content: buildChatErrorContent(error, copy),
        petName: agentId,
        timestamp: Date.now(),
      });
    } finally {
      setLoading(false);
    }
  }, [
    addMessage,
    agentEmoji,
    agentId,
    agentName,
    agentRole,
    aiConfig,
    chatMessages,
    copy,
    input,
    isBrowserDirect,
    isFrontendMode,
    isLoading,
    locale,
    setLoading,
  ]);

  if (!isChatOpen && !embedded) return null;

  return (
    <div
      className={
        embedded
          ? "flex h-full flex-col overflow-hidden"
          : `fixed z-[71] flex flex-col studio-shell animate-in slide-in-from-bottom-4 fade-in duration-300 ${shellClass}`
      }
      style={embedded ? undefined : { pointerEvents: "auto" }}
    >
      {!embedded && (
        <div className="flex items-center justify-between border-b border-[rgba(151,120,90,0.14)] px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#D4845A] to-[#E4946A] shadow-sm">
              <MessageCircle className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-[#3A2A1A]">
                {copy.chat.title(agentName)}
              </h3>
              <p className="truncate text-[10px] text-[#8B7355]">
                {agentRole} / {getModeLabel(runtimeMode, isBrowserDirect, copy)}
              </p>
            </div>
            <span className="text-lg">{agentEmoji}</span>
          </div>

          <div className="flex items-center gap-1">
            <div className="rounded-full studio-surface px-2 py-1 text-[9px] font-semibold text-[#7D6856]">
              {isFrontendMode ? (
                <span className="inline-flex items-center gap-1">
                  <Monitor className="h-3 w-3" />
                  {copy.chat.badges.frontend}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Server className="h-3 w-3" />
                  {copy.chat.badges.advanced}
                </span>
              )}
            </div>
            <button
              onClick={clearChat}
              className="rounded-xl p-2 transition-colors hover:bg-white/35"
              title={copy.chat.clear}
            >
              <Trash2 className="h-3.5 w-3.5 text-[#8B7355]" />
            </button>
            <button
              onClick={toggleChat}
              className="rounded-xl p-2 transition-colors hover:bg-white/35"
              title={copy.common.close}
            >
              <X className="h-3.5 w-3.5 text-[#8B7355]" />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {chatMessages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl studio-surface">
              <span className="text-2xl">{agentEmoji}</span>
            </div>
            <p className="mb-1 text-sm font-semibold text-[#3A2A1A]">
              {copy.chat.ready(agentName)}
            </p>
            <p className="text-xs leading-relaxed text-[#7D6856]">
              {isFrontendMode
                ? CAN_USE_ADVANCED_RUNTIME
                  ? copy.chat.emptyFrontendAdvanced
                  : copy.chat.emptyFrontendPages
                : copy.chat.emptyAdvanced}
            </p>
          </div>
        )}

        {chatMessages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-2 duration-200`}
          >
            <div
              className={`flex items-end gap-1.5 ${message.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div
                className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
                  message.role === "user"
                    ? "rounded-br-md bg-gradient-to-br from-[#5E8B72] to-[#87AFC7] text-white"
                    : "rounded-bl-md studio-surface text-[#4A3727]"
                }`}
              >
                {message.role !== "user" && (
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[#8B7355]">
                    <span>
                      {message.petName
                        ? getAgentEmoji(message.petName)
                        : agentEmoji}
                    </span>
                    <span>
                      {message.petName
                        ? getAgentLabel(message.petName)
                        : agentName}
                    </span>
                  </div>
                )}
                <div className="whitespace-pre-wrap break-words">
                  {message.content}
                </div>
              </div>
              {/* TTS play/stop button — visible for assistant messages when TTS is enabled (Req 3.3, 3.5) */}
              {message.role === "assistant" && ttsEnabled && (
                <button
                  onClick={() => handleTtsPlay(index, message.content)}
                  className={`relative mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all ${
                    playingMessageIndex === index
                      ? "bg-[#D4845A] text-white shadow-sm"
                      : "studio-surface text-[#8B7355] hover:bg-white/6"
                  }`}
                  title={playingMessageIndex === index ? "Stop" : "Play"}
                >
                  {playingMessageIndex === index ? (
                    <Square className="h-3 w-3" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                  {/* Pulsing indicator when playing (Req 3.5) */}
                  {playingMessageIndex === index && (
                    <span className="absolute inset-0 animate-ping rounded-full bg-[#D4845A] opacity-25" />
                  )}
                </button>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start animate-in fade-in duration-200">
            <div className="rounded-2xl rounded-bl-md studio-surface px-3.5 py-2.5">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">{agentEmoji}</span>
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#5E8B72] [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#5E8B72] [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#5E8B72]" />
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="rounded-b-3xl border-t border-[rgba(151,120,90,0.14)] studio-surface px-4 py-3">
        {/* Interim transcript preview */}
        {interimText && (
          <p className="mb-2 truncate text-xs italic text-[#8B7355]">
            {interimText}
          </p>
        )}
        <div className="flex items-center gap-2">
          {/* Microphone button — visible only when STT is available (Req 3.6) */}
          {sttAvailable && (
            <button
              onClick={toggleRecording}
              disabled={isLoading}
              className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-all ${
                isRecording
                  ? "bg-red-500 text-white shadow-md"
                  : "studio-surface text-[#8B7355] hover:bg-white/65"
              } disabled:cursor-not-allowed disabled:opacity-50`}
              title={isRecording ? "Stop recording" : "Start recording"}
            >
              {isRecording ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
              {/* Pulse animation indicator when recording (Req 3.2) */}
              {isRecording && (
                <span className="absolute inset-0 animate-ping rounded-2xl bg-red-400 opacity-30" />
              )}
            </button>
          )}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault();
                void sendMessage();
              }
            }}
            placeholder={copy.chat.placeholder(agentName)}
            className="flex-1 rounded-2xl studio-input px-4 py-3 text-sm outline-none transition-all"
          />
          <GlowButton
            onClick={() => void sendMessage()}
            disabled={!input.trim() || isLoading}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl !px-0"
          >
            <Send className="h-4 w-4" />
          </GlowButton>
          {/* TTS toggle — visible only when TTS is available (Req 3.7) */}
          {ttsAvailable && (
            <button
              onClick={() => setTtsEnabled(!ttsEnabled)}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-all ${
                ttsEnabled
                  ? "bg-[#C98257]/18 text-[#B86F45] shadow-md"
                  : "studio-surface text-[#8B7355] hover:bg-white/65"
              }`}
              title={ttsEnabled ? "Disable TTS" : "Enable TTS"}
            >
              {ttsEnabled ? (
                <Volume2 className="h-4 w-4" />
              ) : (
                <VolumeX className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
