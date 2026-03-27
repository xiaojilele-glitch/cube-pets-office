import {
  AlertTriangle,
  Brain,
  Database,
  Download,
  Eye,
  EyeOff,
  Globe,
  Key,
  Monitor,
  RefreshCw,
  RotateCcw,
  Server,
  Settings,
  ShieldAlert,
  Tag,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';

import {
  buildBrowserRuntimeExport,
  loadBrowserRuntimeMetadata,
  restoreBrowserRuntimeFromBundle,
  syncBrowserRuntimeFromServer,
} from '@/lib/browser-runtime-sync';
import type {
  BrowserRuntimeExportBundle,
  BrowserRuntimeMetadata,
} from '@/lib/browser-runtime-storage';
import { CAN_USE_ADVANCED_RUNTIME } from '@/lib/deploy-target';
import { useAppStore, type AIConfig } from '@/lib/store';
import { useWorkflowStore } from '@/lib/workflow-store';
import { useI18n } from '@/i18n';
import { useViewportTier } from '@/hooks/useViewportTier';

function getSourceLabel(
  isFrontendMode: boolean,
  isBrowserMode: boolean,
  copy: ReturnType<typeof useI18n>['copy']
) {
  if (isFrontendMode && !isBrowserMode) return copy.config.sourceLabels.frontendPreview;
  if (isBrowserMode) return copy.config.sourceLabels.browserStorage;
  return copy.config.sourceLabels.serverEnv;
}

export function ConfigPanel() {
  const {
    runtimeMode,
    setRuntimeMode,
    aiConfig,
    serverAIConfig,
    hydrateAIConfig,
    updateBrowserAIConfig,
    setAIConfigMode,
    resetBrowserAIConfig,
    isAIConfigLoading,
    isConfigOpen,
    toggleConfig,
    locale,
  } = useAppStore();
  const {
    fetchAgents,
    fetchWorkflows,
    fetchHeartbeatStatuses,
    fetchHeartbeatReports,
  } = useWorkflowStore();
  const { copy } = useI18n();
  const { isMobile, isTablet } = useViewportTier();

  const [showKey, setShowKey] = useState(false);
  const [runtimeMeta, setRuntimeMeta] = useState<BrowserRuntimeMetadata | null>(null);
  const [isRuntimeSyncing, setIsRuntimeSyncing] = useState(false);
  const [isRuntimeExporting, setIsRuntimeExporting] = useState(false);
  const [isRuntimeImporting, setIsRuntimeImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const isFrontendMode = runtimeMode === 'frontend';
  const isBrowserMode = aiConfig.mode === 'browser_direct';

  useEffect(() => {
    if (!isConfigOpen) return;

    hydrateAIConfig().catch(error => {
      console.error('[ConfigPanel] Failed to refresh AI config:', error);
    });

    loadBrowserRuntimeMetadata()
      .then(setRuntimeMeta)
      .catch(error => {
        console.error('[ConfigPanel] Failed to load browser runtime metadata:', error);
      });
  }, [hydrateAIConfig, isConfigOpen]);

  if (!isConfigOpen) return null;

  const inputClass =
    'w-full rounded-xl border border-[#E8DDD0] bg-[#FFFCF8] px-3.5 py-2.5 text-sm text-[#3A2A1A] transition-all placeholder:text-[#C4B5A0] disabled:bg-[#F7F1EA] disabled:opacity-70';
  const labelClass = 'mb-1.5 flex items-center gap-2 text-xs font-semibold text-[#5A4A3A]';
  const shellClass = isMobile
    ? 'inset-0 rounded-none'
    : isTablet
      ? 'inset-y-4 left-4 w-[min(52vw,420px)] rounded-[30px]'
      : 'left-0 top-0 h-full w-[410px] rounded-none';

  const refreshRuntimeMeta = async () => {
    try {
      setRuntimeMeta(await loadBrowserRuntimeMetadata());
    } catch (error) {
      console.error('[ConfigPanel] Failed to load browser runtime metadata:', error);
    }
  };

  const handleRefresh = async () => {
    try {
      await hydrateAIConfig();
      toast.success(copy.config.toasts.reloadSuccess, {
        description: isFrontendMode
          ? copy.config.toasts.reloadSuccessFrontend
          : isBrowserMode
            ? copy.config.toasts.reloadSuccessBrowser
            : copy.config.toasts.reloadSuccessServer,
      });
    } catch (error: any) {
      toast.error(copy.config.toasts.reloadError, {
        description: error?.message || copy.chat.errorHint,
      });
    }
  };

  const updateField = (patch: Partial<AIConfig>) => {
    if (!isBrowserMode) return;
    updateBrowserAIConfig(patch);
  };

  const handleRuntimeModeChange = async (mode: 'frontend' | 'advanced') => {
    await setRuntimeMode(mode);
    toast.success(
      mode === 'frontend' ? copy.config.toasts.runtimeFrontend : copy.config.toasts.runtimeAdvanced,
      {
        description:
          mode === 'frontend'
            ? copy.config.toasts.runtimeFrontendDescription
            : copy.config.toasts.runtimeAdvancedDescription,
      }
    );
  };

  const handleAISourceChange = (mode: AIConfig['mode']) => {
    setAIConfigMode(mode);
    toast.success(mode === 'browser_direct' ? copy.config.toasts.aiBrowser : copy.config.toasts.aiServer, {
      description:
        mode === 'browser_direct'
          ? copy.config.toasts.aiBrowserDescription
          : copy.config.toasts.aiServerDescription,
    });
  };

  const formatRuntimeTime = (value: string | null | undefined) =>
    value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : copy.common.unavailable;

  const handleSyncRuntime = async () => {
    setIsRuntimeSyncing(true);
    try {
      await syncBrowserRuntimeFromServer();
      await refreshRuntimeMeta();
      toast.success(copy.config.toasts.syncSuccess);
    } catch (error: any) {
      toast.error(copy.config.toasts.syncError, {
        description: error?.message || copy.chat.errorHint,
      });
    } finally {
      setIsRuntimeSyncing(false);
    }
  };

  const handleExportRuntime = async () => {
    setIsRuntimeExporting(true);
    try {
      const { fileName, bundle } = await buildBrowserRuntimeExport();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      await refreshRuntimeMeta();
      toast.success(copy.config.toasts.exportSuccess);
    } catch (error: any) {
      toast.error(copy.config.toasts.exportError, {
        description: error?.message || copy.chat.errorHint,
      });
    } finally {
      setIsRuntimeExporting(false);
    }
  };

  const handleImportRuntime = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsRuntimeImporting(true);
    try {
      const raw = await file.text();
      const bundle = JSON.parse(raw) as BrowserRuntimeExportBundle;
      await restoreBrowserRuntimeFromBundle(bundle);
      await refreshRuntimeMeta();

      await hydrateAIConfig().catch(() => undefined);
      await fetchAgents();
      await fetchWorkflows();
      await fetchHeartbeatStatuses();
      await fetchHeartbeatReports(undefined, 12);

      toast.success(copy.config.toasts.importSuccess);
    } catch (error: any) {
      toast.error(copy.config.toasts.importError, {
        description: error?.message || copy.chat.errorHint,
      });
    } finally {
      event.target.value = '';
      setIsRuntimeImporting(false);
    }
  };

  return (
    <div
      className={`fixed z-[72] flex flex-col border border-white/60 bg-white/92 shadow-[12px_0_40px_rgba(0,0,0,0.1)] backdrop-blur-2xl animate-in slide-in-from-left duration-300 ${shellClass}`}
      style={{ pointerEvents: 'auto' }}
    >
      <div className="flex items-center justify-between border-b border-[#F0E8E0] px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#2D5F4A] to-[#3D7F5A] shadow-sm">
            <Settings className="h-4 w-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#3A2A1A]">{copy.config.title}</h3>
            <p className="text-[10px] text-[#8B7355]">
              {isFrontendMode ? copy.config.subtitleFrontend : copy.config.subtitleAdvanced}
            </p>
          </div>
        </div>
        <button
          onClick={toggleConfig}
          className="rounded-xl p-2 transition-colors hover:bg-[#F0E8E0]"
          title={copy.common.close}
        >
          <X className="h-4 w-4 text-[#8B7355]" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#E8DDD0] bg-white/80 p-3.5 shadow-sm">
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-xs font-bold text-[#3A2A1A]">{copy.config.sections.runMode}</p>
                <p className="mt-1 text-[10px] leading-relaxed text-[#8B7355]">
                  {CAN_USE_ADVANCED_RUNTIME
                    ? copy.config.runModeDescription
                    : copy.config.pagesModeDescription}
                </p>
              </div>
              <div className={`grid gap-2 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
                <button
                  onClick={() => void handleRuntimeModeChange('frontend')}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-semibold transition-colors ${
                    isFrontendMode
                      ? 'bg-[#2D5F4A] text-white'
                      : 'bg-[#F7F1EA] text-[#5A4A3A] hover:bg-[#F0E8E0]'
                  }`}
                >
                  <Monitor className="h-3.5 w-3.5" />
                  {copy.config.toggles.frontend}
                </button>
                {CAN_USE_ADVANCED_RUNTIME ? (
                  <button
                    onClick={() => void handleRuntimeModeChange('advanced')}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-semibold transition-colors ${
                      isFrontendMode
                        ? 'bg-[#F7F1EA] text-[#5A4A3A] hover:bg-[#F0E8E0]'
                        : 'bg-[#D4845A] text-white'
                    }`}
                  >
                    <Server className="h-3.5 w-3.5" />
                    {copy.config.toggles.advanced}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-[#E8DDD0] bg-[#F7F1EA] p-1.5">
            <button
              onClick={() => handleAISourceChange('server_proxy')}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all ${
                !isBrowserMode ? 'bg-white text-[#2D5F4A] shadow-sm' : 'text-[#8B7355] hover:bg-white/70'
              }`}
            >
              <Server className="h-3.5 w-3.5" />
              {copy.common.serverProxy}
            </button>
            <button
              onClick={() => handleAISourceChange('browser_direct')}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all ${
                isBrowserMode ? 'bg-white text-[#2D5F4A] shadow-sm' : 'text-[#8B7355] hover:bg-white/70'
              }`}
            >
              <Globe className="h-3.5 w-3.5" />
              {copy.common.browserDirect}
            </button>
          </div>

          <div className="rounded-xl border border-[#E0D5C5] bg-gradient-to-br from-[#F0E8E0] to-[#E8DDD0] p-3.5">
            <div className="mb-1.5 flex items-center gap-2">
              {isBrowserMode ? (
                <Globe className="h-3.5 w-3.5 text-[#2D5F4A]" />
              ) : (
                <Server className="h-3.5 w-3.5 text-[#2D5F4A]" />
              )}
              <span className="text-xs font-bold text-[#3A2A1A]">{copy.config.sections.currentSource}</span>
            </div>
            <p className="text-sm font-semibold text-[#2D5F4A]">
              {getSourceLabel(isFrontendMode, isBrowserMode, copy)}
            </p>
            <p className="mt-0.5 text-[10px] text-[#8B7355]">
              {isFrontendMode
                ? isBrowserMode
                  ? copy.config.currentSourceDescription.frontendBrowser
                  : copy.config.currentSourceDescription.frontendPreview
                : isBrowserMode
                  ? copy.config.currentSourceDescription.advancedBrowser
                  : copy.config.currentSourceDescription.advancedServer}
            </p>
          </div>

          {isBrowserMode ? (
            <div className="rounded-xl border border-[#E8C27A] bg-[#FFF7E5] px-3.5 py-3">
              <div className="flex items-center gap-2 text-[#8A5A18]">
                <ShieldAlert className="h-4 w-4" />
                <span className="text-xs font-bold">{copy.config.browserDirectNoticeTitle}</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[#7A5B2B]">
                {copy.config.browserDirectNotice}
              </p>
            </div>
          ) : null}

          <div className="rounded-xl border border-[#D8E6DE] bg-gradient-to-br from-[#F2FBF6] to-[#E7F4EC] p-3.5">
            <div className="mb-1.5 flex items-center gap-2">
              <Database className="h-3.5 w-3.5 text-[#2D5F4A]" />
              <span className="text-xs font-bold text-[#3A2A1A]">{copy.config.sections.browserRuntime}</span>
            </div>
            <p className="text-[10px] text-[#5A6A5E]">{copy.config.browserRuntimeDescription}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-[#5A6A5E]">
              <div className="rounded-lg bg-white/60 px-2.5 py-2">
                <p className="font-semibold text-[#2D5F4A]">{copy.config.lastSync}</p>
                <p className="mt-0.5">{formatRuntimeTime(runtimeMeta?.lastSyncedAt)}</p>
              </div>
              <div className="rounded-lg bg-white/60 px-2.5 py-2">
                <p className="font-semibold text-[#2D5F4A]">{copy.config.lastImport}</p>
                <p className="mt-0.5">{formatRuntimeTime(runtimeMeta?.importedAt)}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2">
              {CAN_USE_ADVANCED_RUNTIME ? (
                <button
                  onClick={() => void handleSyncRuntime()}
                  disabled={isRuntimeSyncing}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#2D5F4A] to-[#3D7F5A] px-3 py-2.5 text-xs font-bold text-white transition-all hover:from-[#245040] hover:to-[#2D6F4A] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isRuntimeSyncing ? 'animate-spin' : ''}`} />
                  {isRuntimeSyncing ? copy.config.syncingRuntime : copy.config.syncRuntime}
                </button>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => void handleExportRuntime()}
                  disabled={isRuntimeExporting}
                  className="flex items-center justify-center gap-2 rounded-xl bg-white/75 px-3 py-2.5 text-xs font-semibold text-[#315745] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Download className="h-3.5 w-3.5" />
                  {isRuntimeExporting ? copy.config.exportingJson : copy.config.exportJson}
                </button>
                <button
                  onClick={() => importInputRef.current?.click()}
                  disabled={isRuntimeImporting}
                  className="flex items-center justify-center gap-2 rounded-xl bg-white/75 px-3 py-2.5 text-xs font-semibold text-[#315745] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {isRuntimeImporting ? copy.config.importingJson : copy.config.importJson}
                </button>
              </div>
            </div>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={event => void handleImportRuntime(event)}
            />
          </div>

          <div>
            <label className={labelClass}>
              <Key className="h-3.5 w-3.5 text-[#C4956A]" />
              {copy.config.sections.apiKey}
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={aiConfig.apiKey}
                readOnly={!isBrowserMode}
                onChange={event => updateField({ apiKey: event.target.value })}
                placeholder={isBrowserMode ? 'sk-...' : ''}
                className={`${inputClass} pr-10 font-mono text-xs`}
              />
              <button
                onClick={() => setShowKey(prev => !prev)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 transition-colors hover:bg-[#F0E8E0]"
                title={copy.config.sections.apiKey}
              >
                {showKey ? (
                  <EyeOff className="h-3.5 w-3.5 text-[#8B7355]" />
                ) : (
                  <Eye className="h-3.5 w-3.5 text-[#8B7355]" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className={labelClass}>
              <Server className="h-3.5 w-3.5 text-[#C4956A]" />
              {copy.config.sections.baseUrl}
            </label>
            <input
              type="text"
              value={aiConfig.baseUrl}
              readOnly={!isBrowserMode}
              onChange={event => updateField({ baseUrl: event.target.value })}
              placeholder={isBrowserMode ? 'https://api.openai.com/v1' : ''}
              className={`${inputClass} font-mono text-xs`}
            />
          </div>

          {isBrowserMode ? (
            <div>
              <label className={labelClass}>
                <Globe className="h-3.5 w-3.5 text-[#C4956A]" />
                {copy.config.sections.proxyUrl}
              </label>
              <input
                type="text"
                value={aiConfig.proxyUrl}
                onChange={event => updateField({ proxyUrl: event.target.value })}
                placeholder="http://localhost:8787/v1"
                className={`${inputClass} font-mono text-xs`}
              />
              <p className="mt-1 text-[10px] text-[#8B7355]">{copy.config.proxyHelp}</p>
            </div>
          ) : null}

          <div>
            <label className={labelClass}>
              <Brain className="h-3.5 w-3.5 text-[#C4956A]" />
              {copy.config.sections.model}
            </label>
            <input
              type="text"
              value={aiConfig.model}
              readOnly={!isBrowserMode}
              onChange={event => updateField({ model: event.target.value })}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>
              <Tag className="h-3.5 w-3.5 text-[#C4956A]" />
              {copy.config.sections.wireApi}
            </label>
            <select
              value={aiConfig.wireApi}
              disabled={!isBrowserMode}
              onChange={event => updateField({ wireApi: event.target.value as AIConfig['wireApi'] })}
              className={inputClass}
            >
              <option value="chat_completions">chat_completions</option>
              <option value="responses">responses</option>
            </select>
          </div>

          <div>
            <label className={labelClass}>
              <Tag className="h-3.5 w-3.5 text-[#C4956A]" />
              {copy.config.sections.reasoning}
            </label>
            <input
              type="text"
              value={aiConfig.modelReasoningEffort}
              readOnly={!isBrowserMode}
              onChange={event => updateField({ modelReasoningEffort: event.target.value })}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>
              <Database className="h-3.5 w-3.5 text-[#C4956A]" />
              {copy.config.sections.timeout}
            </label>
            <input
              type="number"
              value={aiConfig.timeoutMs}
              readOnly={!isBrowserMode}
              onChange={event => updateField({ timeoutMs: Number(event.target.value) || 45000 })}
              className={`${inputClass} font-mono`}
            />
          </div>

          <div>
            <label className={labelClass}>
              <Database className="h-3.5 w-3.5 text-[#C4956A]" />
              {copy.config.sections.maxContext}
            </label>
            <input
              type="number"
              value={aiConfig.maxContext}
              readOnly={!isBrowserMode}
              onChange={event => updateField({ maxContext: Number(event.target.value) || 1000000 })}
              className={`${inputClass} font-mono`}
            />
          </div>

          <div>
            <label className={labelClass}>
              <Tag className="h-3.5 w-3.5 text-[#C4956A]" />
              {copy.config.sections.providerName}
            </label>
            <input type="text" value={aiConfig.providerName} readOnly className={inputClass} />
          </div>

          {!isBrowserMode ? (
            <div className="rounded-xl border border-[#D7C9B8] bg-[#F8F3EC] px-3.5 py-3">
              <div className="flex items-center gap-2 text-[#6F5B46]">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-xs font-bold">
                  {isFrontendMode ? copy.config.previewOnlyTitle : copy.config.serverOwnedTitle}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[#8B7355]">
                {isFrontendMode
                  ? copy.config.previewOnlyDescription
                  : copy.config.serverOwnedDescription}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-[#D7C9B8] bg-[#F8F3EC] px-3.5 py-3">
              <div className="flex items-center gap-2 text-[#6F5B46]">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-xs font-bold">{copy.config.browserScopeTitle}</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[#8B7355]">
                {copy.config.browserScopeDescription}
              </p>
              <p className="mt-2 text-[10px] text-[#8B7355]">
                {copy.config.serverDefault}: {serverAIConfig.model} / {serverAIConfig.providerName}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className={`border-t border-[#F0E8E0] px-4 py-4 sm:px-5 ${isMobile ? 'pb-[calc(env(safe-area-inset-bottom)+16px)]' : ''}`}>
        <div className={`grid gap-2 ${isMobile ? 'grid-cols-1' : 'grid-cols-[1fr_auto]'}`}>
          <button
            onClick={() => void handleRefresh()}
            disabled={isAIConfigLoading}
            className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#2D5F4A] to-[#3D7F5A] px-4 py-3 text-sm font-bold text-white shadow-md transition-all duration-200 hover:from-[#245040] hover:to-[#2D6F4A] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isAIConfigLoading ? 'animate-spin' : ''}`} />
            {isAIConfigLoading ? copy.config.buttons.reloading : copy.config.buttons.reload}
          </button>

          {isBrowserMode ? (
            <button
              onClick={() => {
                resetBrowserAIConfig();
                toast.success(copy.config.toasts.resetSuccess);
              }}
              className="flex items-center justify-center gap-2 rounded-2xl border border-[#E8DDD0] bg-[#F7F1EA] px-4 py-3 text-sm font-bold text-[#5A4A3A] transition-all duration-200 hover:bg-[#F0E8E0] active:scale-[0.98]"
            >
              <RotateCcw className="h-4 w-4" />
              {copy.config.buttons.resetLocal}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
