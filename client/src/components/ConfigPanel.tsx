/**
 * Config Panel - AI model configuration
 * Design: Warm glass-morphism, left slide-in panel
 */
import { useAppStore } from '@/lib/store';
import { useWorkflowStore } from '@/lib/workflow-store';
import {
  buildBrowserRuntimeExport,
  loadBrowserRuntimeMetadata,
  restoreBrowserRuntimeFromBundle,
  syncBrowserRuntimeFromServer,
} from '@/lib/browser-runtime-sync';
import type { BrowserRuntimeExportBundle, BrowserRuntimeMetadata } from '@/lib/browser-runtime-storage';
import {
  Settings,
  X,
  Eye,
  EyeOff,
  Server,
  Key,
  Brain,
  Database,
  Tag,
  RefreshCw,
  Download,
  Upload,
} from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';

export function ConfigPanel() {
  const { aiConfig, hydrateAIConfig, isAIConfigLoading, isConfigOpen, toggleConfig } = useAppStore();
  const {
    fetchAgents,
    fetchWorkflows,
    fetchHeartbeatStatuses,
    fetchHeartbeatReports,
  } = useWorkflowStore();
  const [showKey, setShowKey] = useState(false);
  const [runtimeMeta, setRuntimeMeta] = useState<BrowserRuntimeMetadata | null>(null);
  const [isRuntimeSyncing, setIsRuntimeSyncing] = useState(false);
  const [isRuntimeExporting, setIsRuntimeExporting] = useState(false);
  const [isRuntimeImporting, setIsRuntimeImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const refreshRuntimeMeta = async () => {
    try {
      setRuntimeMeta(await loadBrowserRuntimeMetadata());
    } catch (error) {
      console.error('[ConfigPanel] Failed to load browser runtime metadata:', error);
    }
  };

  useEffect(() => {
    if (!isConfigOpen) return;

    hydrateAIConfig().catch((error) => {
      console.error('[ConfigPanel] Failed to refresh AI config:', error);
    });
    void refreshRuntimeMeta();
  }, [hydrateAIConfig, isConfigOpen]);

  if (!isConfigOpen) return null;

  const handleRefresh = async () => {
    try {
      await hydrateAIConfig();
      toast.success('Config reloaded', {
        description: 'Values were refreshed from .env on the server.',
      });
    } catch (error: any) {
      toast.error('Failed to reload config', {
        description: error?.message || 'Please check the server.',
      });
    }
  };

  const inputClass = `w-full px-3.5 py-2.5 text-sm bg-[#FFFCF8] border border-[#E8DDD0] rounded-xl
    text-[#3A2A1A] placeholder-[#C4B5A0] transition-all`;

  const labelClass = 'flex items-center gap-2 text-xs font-semibold text-[#5A4A3A] mb-1.5';

  const formatRuntimeTime = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleString('zh-CN') : '--';

  const handleSyncRuntime = async () => {
    setIsRuntimeSyncing(true);

    try {
      const summary = await syncBrowserRuntimeFromServer();
      await refreshRuntimeMeta();
      toast.success('Browser runtime synced', {
        description: `Cached ${summary.agentCount} agents, ${summary.workflowCount} workflows, and ${summary.heartbeatReportCount} heartbeat reports locally.`,
      });
    } catch (error: any) {
      toast.error('Failed to sync browser runtime', {
        description: error?.message || 'Please check the server connection.',
      });
    } finally {
      setIsRuntimeSyncing(false);
    }
  };

  const handleExportRuntime = async () => {
    setIsRuntimeExporting(true);

    try {
      const { fileName, bundle } = await buildBrowserRuntimeExport();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      await refreshRuntimeMeta();
      toast.success('Browser runtime exported', {
        description: 'Configuration, reports, persona, and local history were downloaded as JSON.',
      });
    } catch (error: any) {
      toast.error('Failed to export browser runtime', {
        description: error?.message || 'No local runtime snapshot is available yet.',
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

      toast.success('Browser runtime imported', {
        description: 'Local IndexedDB runtime data has been restored from the selected JSON file.',
      });
    } catch (error: any) {
      toast.error('Failed to import browser runtime', {
        description: error?.message || 'Please verify the selected JSON file.',
      });
    } finally {
      event.target.value = '';
      setIsRuntimeImporting(false);
    }
  };

  return (
    <div
      className="fixed top-0 left-0 h-full w-[340px] z-[55] flex flex-col
        bg-white/90 backdrop-blur-2xl border-r border-white/60
        shadow-[12px_0_40px_rgba(0,0,0,0.1)]
        animate-in slide-in-from-left duration-300"
      style={{ pointerEvents: 'auto' }}
    >
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#F0E8E0]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#2D5F4A] to-[#3D7F5A] flex items-center justify-center shadow-sm">
            <Settings className="w-4 h-4 text-white" />
          </div>
          <h3 className="text-sm font-bold text-[#3A2A1A]">AI Config</h3>
        </div>
        <button
          onClick={toggleConfig}
          className="p-2 rounded-xl hover:bg-[#F0E8E0] transition-colors"
        >
          <X className="w-4 h-4 text-[#8B7355]" />
        </button>
      </div>

      <div className="mx-5 mt-4 p-3.5 rounded-xl bg-gradient-to-br from-[#F0E8E0] to-[#E8DDD0] border border-[#E0D5C5]">
        <div className="flex items-center gap-2 mb-1.5">
          <Server className="w-3.5 h-3.5 text-[#2D5F4A]" />
          <span className="text-xs font-bold text-[#3A2A1A]">Source</span>
        </div>
        <p className="text-sm font-semibold text-[#2D5F4A]">`.env` only</p>
        <p className="text-[10px] text-[#8B7355] mt-0.5">Chat panel and workflow always read the same server config.</p>
        <p className="text-[10px] text-[#8B7355] mt-1">To change model or key, edit `.env` and restart the server.</p>
      </div>

      <div className="mx-5 mt-3 rounded-xl border border-[#D8E6DE] bg-gradient-to-br from-[#F2FBF6] to-[#E7F4EC] p-3.5">
        <div className="flex items-center gap-2 mb-1.5">
          <Database className="w-3.5 h-3.5 text-[#2D5F4A]" />
          <span className="text-xs font-bold text-[#3A2A1A]">Browser Runtime</span>
        </div>
        <p className="text-[10px] text-[#5A6A5E]">
          Mirror `database.json`, sessions, memory, reports, `SOUL`, and heartbeat snapshots into IndexedDB for offline viewing and export.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-[#5A6A5E]">
          <div className="rounded-lg bg-white/60 px-2.5 py-2">
            <p className="font-semibold text-[#2D5F4A]">Last Sync</p>
            <p className="mt-0.5">{formatRuntimeTime(runtimeMeta?.lastSyncedAt)}</p>
          </div>
          <div className="rounded-lg bg-white/60 px-2.5 py-2">
            <p className="font-semibold text-[#2D5F4A]">Last Import</p>
            <p className="mt-0.5">{formatRuntimeTime(runtimeMeta?.importedAt)}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2">
          <button
            onClick={() => void handleSyncRuntime()}
            disabled={isRuntimeSyncing}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#2D5F4A] to-[#3D7F5A] px-3 py-2.5 text-xs font-bold text-white transition-all hover:from-[#245040] hover:to-[#2D6F4A] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRuntimeSyncing ? 'animate-spin' : ''}`} />
            {isRuntimeSyncing ? 'Syncing Browser Runtime...' : 'Sync Browser Runtime'}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => void handleExportRuntime()}
              disabled={isRuntimeExporting}
              className="flex items-center justify-center gap-2 rounded-xl bg-white/75 px-3 py-2.5 text-xs font-semibold text-[#315745] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5" />
              {isRuntimeExporting ? 'Exporting...' : 'Export JSON'}
            </button>
            <button
              onClick={() => importInputRef.current?.click()}
              disabled={isRuntimeImporting}
              className="flex items-center justify-center gap-2 rounded-xl bg-white/75 px-3 py-2.5 text-xs font-semibold text-[#315745] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload className="w-3.5 h-3.5" />
              {isRuntimeImporting ? 'Importing...' : 'Import JSON'}
            </button>
          </div>
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(event) => void handleImportRuntime(event)}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div>
          <label className={labelClass}>
            <Key className="w-3.5 h-3.5 text-[#C4956A]" />
            API Key
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={aiConfig.apiKey}
              readOnly
              className={`${inputClass} pr-10 font-mono text-xs`}
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-[#F0E8E0] transition-colors"
            >
              {showKey
                ? <EyeOff className="w-3.5 h-3.5 text-[#8B7355]" />
                : <Eye className="w-3.5 h-3.5 text-[#8B7355]" />}
            </button>
          </div>
        </div>

        <div>
          <label className={labelClass}>
            <Server className="w-3.5 h-3.5 text-[#C4956A]" />
            Base URL
          </label>
          <input
            type="text"
            value={aiConfig.baseUrl}
            readOnly
            className={`${inputClass} font-mono text-xs`}
          />
        </div>

        <div>
          <label className={labelClass}>
            <Brain className="w-3.5 h-3.5 text-[#C4956A]" />
            Model
          </label>
          <input
            type="text"
            value={aiConfig.model}
            readOnly
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>
            <Tag className="w-3.5 h-3.5 text-[#C4956A]" />
            Reasoning Effort
          </label>
          <input
            type="text"
            value={aiConfig.modelReasoningEffort}
            readOnly
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>
            <Database className="w-3.5 h-3.5 text-[#C4956A]" />
            Max Context
          </label>
          <input
            type="number"
            value={aiConfig.maxContext}
            readOnly
            className={`${inputClass} font-mono`}
          />
        </div>

        <div>
          <label className={labelClass}>
            <Tag className="w-3.5 h-3.5 text-[#C4956A]" />
            Provider Name
          </label>
          <input
            type="text"
            value={aiConfig.providerName}
            readOnly
            className={inputClass}
          />
        </div>
      </div>

      <div className="px-5 py-4 border-t border-[#F0E8E0]">
        <button
          onClick={() => void handleRefresh()}
          disabled={isAIConfigLoading}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm font-bold
            bg-gradient-to-r from-[#2D5F4A] to-[#3D7F5A] text-white
            hover:from-[#245040] hover:to-[#2D6F4A]
            active:scale-[0.98] transition-all duration-200 shadow-md
            disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${isAIConfigLoading ? 'animate-spin' : ''}`} />
          {isAIConfigLoading ? 'Reloading...' : 'Reload From Server'}
        </button>
      </div>
    </div>
  );
}
