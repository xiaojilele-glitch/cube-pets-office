/**
 * Config Panel - AI model configuration
 * Design: Warm glass-morphism, left slide-in panel
 */
import { useAppStore } from '@/lib/store';
import { Settings, X, Eye, EyeOff, Server, Key, Brain, Database, Tag, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export function ConfigPanel() {
  const { aiConfig, hydrateAIConfig, isAIConfigLoading, isConfigOpen, toggleConfig } = useAppStore();
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (!isConfigOpen) return;

    hydrateAIConfig().catch((error) => {
      console.error('[ConfigPanel] Failed to refresh AI config:', error);
    });
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
