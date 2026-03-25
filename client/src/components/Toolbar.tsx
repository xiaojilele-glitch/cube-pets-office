import { useState } from 'react';
import {
  BookOpen,
  Brain,
  HelpCircle,
  MessageCircle,
  Settings,
  Target,
  Workflow,
  X,
} from 'lucide-react';

import { getAgentToolbarLabel } from '@/lib/agent-config';
import { useAppStore } from '@/lib/store';
import { useWorkflowStore } from '@/lib/workflow-store';

type DockButton = {
  id: 'paper' | 'config' | 'workflow' | 'chat' | 'help';
  label: string;
  icon: typeof BookOpen;
  active: boolean;
  accent: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

export function Toolbar() {
  const {
    togglePdf,
    toggleConfig,
    toggleChat,
    isPdfOpen,
    isConfigOpen,
    isChatOpen,
    selectedPet,
  } = useAppStore();
  const { isWorkflowPanelOpen, toggleWorkflowPanel } = useWorkflowStore();

  const [showInfo, setShowInfo] = useState(false);

  const dockButtons: DockButton[] = [
    {
      id: 'paper',
      label: '论文',
      icon: BookOpen,
      active: isPdfOpen,
      accent: '#C48A55',
      onClick: (event) => {
        event.stopPropagation();
        togglePdf();
      },
    },
    {
      id: 'config',
      label: '配置',
      icon: Settings,
      active: isConfigOpen,
      accent: '#2F6A54',
      onClick: (event) => {
        event.stopPropagation();
        toggleConfig();
      },
    },
    {
      id: 'workflow',
      label: '编排',
      icon: Brain,
      active: isWorkflowPanelOpen,
      accent: '#D07A4F',
      onClick: (event) => {
        event.stopPropagation();
        toggleWorkflowPanel();
      },
    },
    {
      id: 'chat',
      label: '聊天',
      icon: MessageCircle,
      active: isChatOpen,
      accent: '#A86B4E',
      onClick: (event) => {
        event.stopPropagation();
        toggleChat();
      },
    },
    {
      id: 'help',
      label: '帮助',
      icon: HelpCircle,
      active: showInfo,
      accent: '#75604D',
      onClick: (event) => {
        event.stopPropagation();
        setShowInfo((prev) => !prev);
      },
    },
  ];

  return (
    <>
      <div
        className="fixed bottom-6 left-5 z-[60] flex items-end gap-3"
        style={{ pointerEvents: 'auto' }}
      >
        <div className="rounded-[30px] border border-white/60 bg-white/74 p-2 shadow-[0_14px_40px_rgba(60,44,28,0.14)] backdrop-blur-2xl">
          <div className="mb-1 px-2.5 pt-1">
            <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-[#AA927C]">
              Dock
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            {dockButtons.map((button) => {
              const Icon = button.icon;

              return (
                <button
                  key={button.id}
                  onClick={button.onClick}
                  className={`group flex min-w-[120px] items-center gap-3 rounded-[22px] px-3.5 py-3 text-left transition-all duration-300 ${
                    button.active
                      ? 'translate-x-1 shadow-[0_12px_24px_rgba(80,56,36,0.14)]'
                      : 'hover:translate-x-1 hover:bg-white/70'
                  }`}
                  style={{
                    background: button.active
                      ? `linear-gradient(135deg, ${button.accent}, ${button.accent}CC)`
                      : 'rgba(255,255,255,0.28)',
                    color: button.active ? '#FFFFFF' : '#5A4A3A',
                  }}
                >
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-2xl shadow-sm"
                    style={{
                      background: button.active ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.74)',
                    }}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{button.label}</div>
                    <div
                      className="text-[10px] uppercase tracking-[0.16em]"
                      style={{ color: button.active ? 'rgba(255,255,255,0.78)' : '#A08972' }}
                    >
                      {button.id === 'paper' && 'paper'}
                      {button.id === 'config' && 'model'}
                      {button.id === 'workflow' && 'ops'}
                      {button.id === 'chat' && 'agent'}
                      {button.id === 'help' && 'tips'}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {showInfo && (
          <div className="mb-2 w-[320px] rounded-[28px] border border-white/60 bg-white/88 p-5 shadow-[0_16px_44px_rgba(60,44,28,0.18)] backdrop-blur-2xl animate-in fade-in slide-in-from-left-4 duration-300">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#A08972]">
                  Quick Guide
                </p>
                <h4
                  className="mt-1 text-sm font-bold text-[#3A2A1A]"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  如何使用这间办公室
                </h4>
              </div>
              <button
                onClick={() => setShowInfo(false)}
                className="rounded-xl p-2 transition-colors hover:bg-[#F0E8E0]"
              >
                <X className="h-3.5 w-3.5 text-[#8B7355]" />
              </button>
            </div>

            <div className="space-y-3 text-xs leading-relaxed text-[#5A4A3A]">
              <div className="flex items-start gap-3">
                <Target className="mt-0.5 h-4 w-4 shrink-0 text-[#D07A4F]" />
                <span>点击任意 Agent 会高亮它，并把聊天焦点切到该角色。</span>
              </div>
              <div className="flex items-start gap-3">
                <Workflow className="mt-0.5 h-4 w-4 shrink-0 text-[#7A5BC3]" />
                <span>“编排”面板里可以看组织树、工作流进度、评审结果和记忆。</span>
              </div>
              <div className="flex items-start gap-3">
                <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-[#C48A55]" />
                <span>“论文”会打开完整参考材料，适合边看边问边验证系统设计。</span>
              </div>
              <div className="flex items-start gap-3">
                <Settings className="mt-0.5 h-4 w-4 shrink-0 text-[#2F6A54]" />
                <span>如果模型调用异常，先检查 `API Key`、`Base URL` 和模型名称是否可用。</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedPet && (
        <div
          className="fixed right-5 top-24 z-[60] max-w-[280px] rounded-[24px] border border-white/60 bg-white/82 px-4 py-3 shadow-[0_12px_30px_rgba(60,44,28,0.14)] backdrop-blur-2xl animate-in fade-in slide-in-from-right-2 duration-300"
          style={{ pointerEvents: 'auto' }}
        >
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[#A08972]">
            Current Focus
          </p>
          <p className="mt-1 text-sm font-semibold text-[#3A2A1A]">
            {getAgentToolbarLabel(selectedPet)}
          </p>
        </div>
      )}
    </>
  );
}
