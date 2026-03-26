/**
 * Config Panel - AI model configuration
 * Design: Warm glass-morphism, left slide-in panel
 */
import { useAppStore } from '@/lib/store';
import { Settings, X, Eye, EyeOff, Server, Key, Brain, Database, Tag, RefreshCw, Monitor } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export function ConfigPanel() {
  const {
    aiConfig,
    hydrateAIConfig,
    isAIConfigLoading,
    isConfigOpen,
    toggleConfig,
    runtimeMode,
    setRuntimeMode,
  } = useAppStore();
  const [showKey, setShowKey] = useState(false);
  const isFrontendMode = runtimeMode === 'frontend';

  useEffect(() => {
    if (!isConfigOpen) return;

    hydrateAIConfig().catch((error) => {
      console.error('[ConfigPanel] Failed to refresh AI config:', error);
    });
  }, [hydrateAIConfig, isConfigOpen]);

  if (!isConfigOpen) return null;

  const handleRefresh = async () => {
    if (isFrontendMode) {
      toast.info('Frontend mode uses local preview values', {
        description: 'Switch to Advanced Mode to reload real server config.',
      });
      return;
    }

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
        <p className="text-sm font-semibold text-[#2D5F4A]">
          {isFrontendMode ? 'Browser-only preview' : '`.env` only'}
        </p>
        <p className="text-[10px] text-[#8B7355] mt-0.5">
          {isFrontendMode
            ? 'Current session stays in the browser and avoids any required backend setup.'
            : 'Chat panel and workflow always read the same server config.'}
        </p>
        <p className="text-[10px] text-[#8B7355] mt-1">
          {isFrontendMode
            ? 'Switch to Advanced Mode when you want real workflow execution, reports, and server-backed model calls.'
            : 'To change model or key, edit `.env` and restart the server.'}
        </p>
      </div>

      <div className="mx-5 mt-4 p-3.5 rounded-xl bg-white/80 border border-[#E8DDD0] shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-[#3A2A1A]">Run Mode</p>
            <p className="mt-1 text-[10px] leading-relaxed text-[#8B7355]">
              纯前端模式适合首次打开和本地演示；高级模式保留现有服务端实现，用于真实工作流和报告链路。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void setRuntimeMode('frontend')}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-semibold transition-colors ${
                isFrontendMode
                  ? 'bg-[#2D5F4A] text-white'
                  : 'bg-[#F7F1EA] text-[#5A4A3A] hover:bg-[#F0E8E0]'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              纯前端
            </button>
            <button
              onClick={() => void setRuntimeMode('advanced')}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-semibold transition-colors ${
                isFrontendMode
                  ? 'bg-[#F7F1EA] text-[#5A4A3A] hover:bg-[#F0E8E0]'
                  : 'bg-[#D4845A] text-white'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              高级
            </button>
          </div>
        </div>
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
          {isAIConfigLoading
            ? 'Reloading...'
            : isFrontendMode
              ? 'Switch To Advanced Mode'
              : 'Reload From Server'}
        </button>
      </div>
    </div>
  );
}
