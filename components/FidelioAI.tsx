
import React, { useState, useRef, useEffect } from 'react';
import { Ticker, FuturesTicker } from '../types';
import { generateAIResponse, ChatMessage } from '../services/aiService';
import { Send, Globe, RotateCcw, Loader2 } from 'lucide-react';

interface FidelioAIProps {
  spotData: Record<string, Ticker>;
  futuresData: Record<string, FuturesTicker>;
}

// Role column + message column, shared by every row of the log so the text lines up.
const ROW_GRID = 'grid grid-cols-[56px_minmax(0,1fr)] gap-x-3 border-b border-border px-3 py-2 sm:grid-cols-[72px_minmax(0,1fr)]';
const ROLE_LABEL = 'text-[10px] font-semibold uppercase tracking-wider';

export const FidelioAI: React.FC<FidelioAIProps> = ({ spotData, futuresData }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init',
      role: 'model',
      text: "Identity confirmed. I am Fidelio AI. I have access to real-time market feeds and the entire indexed web via Google Search.\n\nWhat market anomaly shall we analyze today?",
      timestamp: Date.now()
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (text: string = input) => {
    if (!text.trim() || isTyping) return;

    const userMsg: ChatMessage = {
      id: Math.random().toString(36),
      role: 'user',
      text: text,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    // Call Service
    const response = await generateAIResponse(text, { spot: spotData, futures: futuresData });

    const aiMsg: ChatMessage = {
      id: Math.random().toString(36),
      role: 'model',
      text: response.text,
      sources: response.sources,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, aiMsg]);
    setIsTyping(false);
  };

  const QUICK_PROMPTS = [
    "Why is the market moving today?",
    "Analyze BTC funding rates & sentiment",
    "Find recent news about Solana",
    "What macro events are coming this week?"
  ];

  return (
    // Fills the view at every width (flex-1 inside the shell's column, h-full inside a grid cell); only the
    // message log scrolls, so the input bar stays pinned at the bottom.
    <section className="flex w-full flex-1 flex-col bg-surface lg:h-full lg:min-h-0" aria-label="Fidelio.ai Analyst">
       {/* Header */}
       <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border pl-3 pr-1">
          <div className="flex min-w-0 items-baseline gap-2">
             <h2 className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-secondary">Fidelio.ai Analyst</h2>
             <span className="truncate text-[10px] uppercase tracking-wider text-muted">Gemini 2.5 Flash • Search Grounding Enabled</span>
          </div>
          <button
            type="button"
            onClick={() => setMessages([])}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
            title="Reset Session"
            aria-label="Reset Session"
          >
             <RotateCcw size={14} />
          </button>
       </header>

       {/* Intelligence Parameters: one status line */}
       <div
         className="flex h-7 shrink-0 items-center gap-3 overflow-x-auto whitespace-nowrap border-b border-border px-3 text-[11px] text-secondary scrollbar-hide"
         role="group"
         aria-label="Intelligence Parameters"
       >
          <span className="hidden text-[10px] uppercase tracking-wider text-muted md:inline">Intelligence Parameters</span>
          <span className="flex items-center gap-1.5">
             <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" aria-hidden="true"></span>
             Live Feeds
          </span>
          <span className="flex items-center gap-1.5">
             <Globe size={12} className="shrink-0" />
             Google Search
          </span>
          <span className="ml-auto flex items-center gap-1.5">
             <span className="hidden text-[10px] uppercase tracking-wider text-muted sm:inline">Current Context:</span>
             <span className="font-mono text-text">
                {Object.keys(spotData).length} Pairs, {Object.keys(futuresData).length} Contracts
             </span>
          </span>
       </div>

       {/* Messages: flat log rows. The scroller is out of flow so a long log never stretches the page. */}
       <div className="relative min-h-[180px] flex-1">
       <div className="absolute inset-0 overflow-y-auto" ref={scrollRef}>
          {messages.map((msg) => (
             <div key={msg.id} className={`${ROW_GRID} ${msg.role === 'user' ? 'bg-surface-secondary' : 'bg-surface'}`}>
                <div className="min-w-0 pt-px">
                   <div className={`${ROLE_LABEL} ${msg.role === 'model' ? 'text-primary' : 'text-muted'}`}>
                      {msg.role === 'model' ? 'Fidelio' : 'You'}
                   </div>
                   <div className="font-mono text-[10px] text-muted">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                   </div>
                </div>

                <div className="min-w-0">
                   <div className="max-w-[110ch] whitespace-pre-wrap break-words text-xs leading-relaxed text-text">
                      {msg.text}
                   </div>

                   {/* Sources / Grounding */}
                   {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                         {msg.sources.map((src, idx) => (
                            <a
                              key={idx}
                              href={src.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-6 max-w-[260px] items-center gap-1 rounded-sm border border-border px-1.5 text-[10px] text-secondary transition-colors hover:bg-surface-highlight hover:text-primary"
                            >
                               <Globe size={10} className="shrink-0" />
                               <span className="truncate">{src.title}</span>
                            </a>
                         ))}
                      </div>
                   )}
                </div>
             </div>
          ))}

          {isTyping && (
             <div className={`${ROW_GRID} bg-surface`} role="status">
                <div className={`${ROLE_LABEL} pt-px text-primary`}>Fidelio</div>
                <div className="flex h-5 items-center">
                   <Loader2 size={12} className="animate-spin text-secondary" />
                </div>
             </div>
          )}
       </div>
       </div>

       {/* Quick Protocols: suggestion chips */}
       <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-t border-border px-3 scrollbar-hide">
          <span className="mr-1 hidden shrink-0 text-[10px] uppercase tracking-wider text-muted md:inline">Quick Protocols</span>
          {QUICK_PROMPTS.map((prompt, idx) => (
             <button
                key={idx}
                type="button"
                onClick={() => handleSend(prompt)}
                className="h-6 shrink-0 whitespace-nowrap rounded-sm border border-border px-2 text-[11px] text-secondary transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
             >
                {prompt}
             </button>
          ))}
       </div>

       {/* Input Area */}
       <div className="flex h-9 shrink-0 items-center gap-1 border-t border-border pl-3 pr-1">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask Fidelio about markets, news, or technicals..."
            className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-surface-secondary px-2 text-xs text-text outline-none placeholder:text-muted focus:border-primary disabled:opacity-60"
            disabled={isTyping}
          />
          <button
            type="button"
            onClick={() => handleSend()}
            disabled={!input.trim() || isTyping}
            aria-label="Send"
            className="grid h-7 w-9 shrink-0 place-items-center rounded-sm bg-primary text-primary-contrast transition-colors hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
          >
             <Send size={14} />
          </button>
       </div>
       <p className="shrink-0 truncate px-3 pb-1 text-[10px] text-muted">AI can make mistakes. Verify important information.</p>
    </section>
  );
};
