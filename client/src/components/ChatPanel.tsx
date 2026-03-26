import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, Trash2, X } from 'lucide-react';

import {
  DEFAULT_AGENT_ID,
  getAgentChatRole,
  getAgentEmoji,
  getAgentLabel,
} from '@/lib/agent-config';
import { useAppStore, type ChatMessage } from '@/lib/store';

const PAPER_CONTEXT = `You are a cute cube-pet research assistant working in a warm study.

You are discussing a paper about turning one natural-language instruction into coordinated multi-agent work.

Core ideas:
- An organizational mirror maps one request into coordinated execution.
- The structure is CEO -> Manager -> Worker.
- The system includes 18 agents, departmental delegation, memory, review, revision, and meta-audit.
- A 3D front end visualizes each agent's work state in real time.

Reply naturally, stay concise, and keep a bit of character.`;

export function ChatPanel() {
  const {
    chatMessages,
    addMessage,
    clearChat,
    isChatOpen,
    toggleChat,
    isLoading,
    setLoading,
    selectedPet,
  } = useAppStore();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const agentId = selectedPet || DEFAULT_AGENT_ID;
  const agentName = getAgentLabel(agentId);
  const agentEmoji = getAgentEmoji(agentId);
  const agentRole = getAgentChatRole(agentId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    if (!isChatOpen) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 250);
    return () => window.clearTimeout(timer);
  }, [isChatOpen]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const currentInput = input.trim();
    const userMessage: ChatMessage = {
      role: 'user',
      content: currentInput,
      timestamp: Date.now(),
    };

    addMessage(userMessage);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: `${PAPER_CONTEXT}\n\nCurrent role: ${agentName} ${agentEmoji}\nRole description: ${agentRole}`,
            },
            ...chatMessages.slice(-10).map((message) => ({
              role: message.role,
              content: message.content,
            })),
            { role: 'user', content: currentInput },
          ],
          maxTokens: 400,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`API ${response.status}: ${errorText.substring(0, 120)}`);
      }

      const data = await response.json();
      const assistantContent = data.content || 'I lost my train of thought. Please ask me again.';

      addMessage({
        role: 'assistant',
        content: assistantContent,
        petName: agentId,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      addMessage({
        role: 'assistant',
        content: `The connection had a problem.\n${error?.message || 'Please check the server config.'}`,
        petName: agentId,
        timestamp: Date.now(),
      });
    } finally {
      setLoading(false);
    }
  }, [addMessage, agentEmoji, agentId, agentName, agentRole, chatMessages, input, isLoading, setLoading]);

  if (!isChatOpen) return null;

  return (
    <div
      className="fixed bottom-6 right-5 z-[55] flex h-[500px] w-[380px] flex-col rounded-3xl border border-white/60 bg-white/90 shadow-[0_12px_48px_rgba(0,0,0,0.12)] backdrop-blur-2xl animate-in slide-in-from-bottom-4 fade-in duration-300"
      style={{ pointerEvents: 'auto' }}
    >
      <div className="flex items-center justify-between border-b border-[#F0E8E0] px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#D4845A] to-[#E4946A] shadow-sm">
            <MessageCircle className="h-4 w-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#3A2A1A]">Chat with {agentName}</h3>
            <p className="text-[10px] text-[#8B7355]">{agentRole}</p>
          </div>
          <span className="text-lg">{agentEmoji}</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={clearChat}
            className="rounded-xl p-2 transition-colors hover:bg-[#F0E8E0]"
            title="Clear chat"
          >
            <Trash2 className="h-3.5 w-3.5 text-[#8B7355]" />
          </button>
          <button
            onClick={toggleChat}
            className="rounded-xl p-2 transition-colors hover:bg-[#F0E8E0]"
          >
            <X className="h-3.5 w-3.5 text-[#8B7355]" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {chatMessages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#F0E8E0] to-[#E8DDD0]">
              <span className="text-2xl">{agentEmoji}</span>
            </div>
            <p className="mb-1 text-sm font-semibold text-[#3A2A1A]">{agentName} is ready</p>
            <p className="text-xs leading-relaxed text-[#8B7355]">
              Ask about the paper, the multi-agent system,
              <br />
              or how this 18-agent workflow is organized.
            </p>
          </div>
        )}

        {chatMessages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-200`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
                message.role === 'user'
                  ? 'bg-gradient-to-br from-[#2D5F4A] to-[#3D7F5A] text-white rounded-br-md'
                  : 'bg-[#F7F1EA] text-[#3A2A1A] border border-[#E8DDD0] rounded-bl-md'
              }`}
            >
              {message.role !== 'user' && (
                <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[#8B7355]">
                  <span>{message.petName ? getAgentEmoji(message.petName) : agentEmoji}</span>
                  <span>{message.petName ? getAgentLabel(message.petName) : agentName}</span>
                </div>
              )}
              <div className="whitespace-pre-wrap break-words">{message.content}</div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start animate-in fade-in duration-200">
            <div className="rounded-2xl rounded-bl-md border border-[#E8DDD0] bg-[#F7F1EA] px-3.5 py-2.5 shadow-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">{agentEmoji}</span>
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#D4845A] [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#D4845A] [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#D4845A]" />
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-[#F0E8E0] px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void sendMessage();
              }
            }}
            placeholder={`Message ${agentName}...`}
            className="flex-1 rounded-2xl border border-[#E8DDD0] bg-[#FFFCF8] px-4 py-3 text-sm text-[#3A2A1A] placeholder-[#B8A897] outline-none transition-all focus:border-[#2D5F4A]/40 focus:ring-2 focus:ring-[#2D5F4A]/15"
          />
          <button
            onClick={() => void sendMessage()}
            disabled={!input.trim() || isLoading}
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2D5F4A] to-[#3D7F5A] text-white shadow-md transition-all hover:from-[#245040] hover:to-[#2D6F4A] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
