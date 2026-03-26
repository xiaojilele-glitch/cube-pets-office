/**
 * Global state management with Zustand
 * Manages: PDF viewer, AI config, pet interactions, UI panels
 */
import { create } from 'zustand';

export interface AIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  modelReasoningEffort: string;
  maxContext: number;
  providerName: string;
  wireApi: string;
}

export type RuntimeMode = 'frontend' | 'advanced';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  petName?: string;
  timestamp: number;
}

interface AppState {
  currentPage: number;
  totalPages: number;
  isPdfOpen: boolean;
  setCurrentPage: (page: number) => void;
  togglePdf: () => void;
  openPdf: () => void;
  closePdf: () => void;

  runtimeMode: RuntimeMode;
  setRuntimeMode: (mode: RuntimeMode) => Promise<void>;

  aiConfig: AIConfig;
  isAIConfigLoading: boolean;
  hydrateAIConfig: () => Promise<void>;
  isConfigOpen: boolean;
  toggleConfig: () => void;

  chatMessages: ChatMessage[];
  isChatOpen: boolean;
  isLoading: boolean;
  addMessage: (msg: ChatMessage) => void;
  clearChat: () => void;
  toggleChat: () => void;
  setLoading: (loading: boolean) => void;

  selectedPet: string | null;
  setSelectedPet: (pet: string | null) => void;

  isSceneReady: boolean;
  setSceneReady: (ready: boolean) => void;
  loadingProgress: number;
  setLoadingProgress: (progress: number) => void;
}

const DEFAULT_AI_CONFIG: AIConfig = {
  apiKey: '',
  baseUrl: '',
  model: '',
  modelReasoningEffort: 'high',
  maxContext: 1000000,
  providerName: '',
  wireApi: 'chat_completions',
};

const RUNTIME_MODE_STORAGE_KEY = 'cube-pets-office-runtime-mode';

const BROWSER_PREVIEW_AI_CONFIG: AIConfig = {
  apiKey: 'Not required in frontend mode',
  baseUrl: 'Browser-only preview',
  model: 'Local demo responses',
  modelReasoningEffort: 'instant',
  maxContext: 32000,
  providerName: 'Built-in browser preview',
  wireApi: 'demo',
};

function getInitialRuntimeMode(): RuntimeMode {
  if (typeof window === 'undefined') return 'frontend';

  const stored = window.localStorage.getItem(RUNTIME_MODE_STORAGE_KEY);
  return stored === 'advanced' ? 'advanced' : 'frontend';
}

function persistRuntimeMode(mode: RuntimeMode) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(RUNTIME_MODE_STORAGE_KEY, mode);
}

export const useAppStore = create<AppState>((set, get) => ({
  currentPage: 1,
  totalPages: 33,
  isPdfOpen: false,
  setCurrentPage: (page) => set({ currentPage: Math.max(1, Math.min(page, 33)) }),
  togglePdf: () => set((s) => ({ isPdfOpen: !s.isPdfOpen })),
  openPdf: () => set({ isPdfOpen: true }),
  closePdf: () => set({ isPdfOpen: false }),

  runtimeMode: getInitialRuntimeMode(),
  setRuntimeMode: async (mode) => {
    persistRuntimeMode(mode);

    if (mode === 'frontend') {
      set({
        runtimeMode: mode,
        aiConfig: BROWSER_PREVIEW_AI_CONFIG,
        isAIConfigLoading: false,
      });
      return;
    }

    set({ runtimeMode: mode });
    try {
      await get().hydrateAIConfig();
    } catch (error) {
      console.error('[Runtime Mode] Failed to hydrate advanced config:', error);
    }
  },

  aiConfig:
    getInitialRuntimeMode() === 'frontend'
      ? BROWSER_PREVIEW_AI_CONFIG
      : DEFAULT_AI_CONFIG,
  isAIConfigLoading: false,
  hydrateAIConfig: async () => {
    if (get().runtimeMode === 'frontend') {
      set({
        aiConfig: BROWSER_PREVIEW_AI_CONFIG,
        isAIConfigLoading: false,
      });
      return;
    }

    set({ isAIConfigLoading: true });

    try {
      const response = await fetch('/api/config/ai');
      if (!response.ok) {
        throw new Error(`API ${response.status}`);
      }

      const data = await response.json();
      set({
        aiConfig: { ...DEFAULT_AI_CONFIG, ...data.config },
        isAIConfigLoading: false,
      });
    } catch (error) {
      console.error('[AI Config] Failed to hydrate config:', error);
      set({ isAIConfigLoading: false });
      throw error;
    }
  },
  isConfigOpen: false,
  toggleConfig: () => set((s) => ({ isConfigOpen: !s.isConfigOpen })),

  chatMessages: [],
  isChatOpen: false,
  isLoading: false,
  addMessage: (msg) => set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
  clearChat: () => set({ chatMessages: [] }),
  toggleChat: () => set((s) => ({ isChatOpen: !s.isChatOpen })),
  setLoading: (loading) => set({ isLoading: loading }),

  selectedPet: null,
  setSelectedPet: (pet) => set({ selectedPet: pet }),

  isSceneReady: false,
  setSceneReady: (ready) => set({ isSceneReady: ready }),
  loadingProgress: 0,
  setLoadingProgress: (progress) => set({ loadingProgress: progress }),
}));
