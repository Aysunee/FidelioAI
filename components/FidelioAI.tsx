
import React, { useState, useRef, useEffect } from 'react';
import { Ticker, FuturesTicker } from '../types';
import { Card } from './ui/Card';
import { generateAIResponse, ChatMessage } from '../services/aiService';
import { Send, Bot, User, Sparkles, Globe, RotateCcw, Search } from 'lucide-react';

interface FidelioAIProps {
  spotData: Record<string, Ticker>;
  futuresData: Record<string, FuturesTicker>;
}

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
    <div className="h-full grid grid-cols-1 lg:grid-cols-12 gap-6">
       
       {/* Left Panel: Context & Quick Actions */}
       <div className="lg:col-span-3 flex flex-col gap-4">
          <Card title="Intelligence Parameters" className="shrink-0">
             <div className="p-4 space-y-4">
                <div className="flex items-center gap-3 text-sm text-secondary">
                    <div className="flex items-center gap-2">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        Live Feeds
                    </div>
                    <div className="w-[1px] h-4 bg-border"></div>
                    <div className="flex items-center gap-2">
                        <Globe size={12} />
                        Google Search
                    </div>
                </div>
                
                <div className="text-xs text-secondary bg-surface-secondary p-3 rounded-lg border border-border">
                    Current Context:
                    <div className="font-mono text-primary mt-1">
                        {Object.keys(spotData).length} Pairs, {Object.keys(futuresData).length} Contracts
                    </div>
                </div>
             </div>
          </Card>

          <Card title="Quick Protocols" className="flex-1">
             <div className="p-4 flex flex-col gap-2">
                {QUICK_PROMPTS.map((prompt, idx) => (
                    <button
                        key={idx}
                        onClick={() => handleSend(prompt)}
                        className="text-left text-xs font-medium p-3 rounded-lg bg-surface-secondary hover:bg-surface-highlight border border-transparent hover:border-primary/30 transition-all flex items-center justify-between group"
                    >
                        {prompt}
                        <Search size={12} className="opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                    </button>
                ))}
             </div>
          </Card>
       </div>

       {/* Right Panel: Chat Interface */}
       <div className="lg:col-span-9 h-full min-h-[500px]">
          <Card className="h-full flex flex-col" noPadding>
              {/* Header */}
              <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface-secondary/20">
                  <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center text-brand shadow-[0_0_15px_rgba(247,166,0,0.2)]">
                          <Sparkles size={18} />
                      </div>
                      <div>
                          <h2 className="font-display font-bold text-text">Fidelio.ai Analyst</h2>
                          <div className="text-[10px] text-secondary uppercase tracking-wider">Gemini 2.5 Flash • Search Grounding Enabled</div>
                      </div>
                  </div>
                  <button 
                    onClick={() => setMessages([])} 
                    className="p-2 hover:bg-surface-secondary rounded-full text-secondary hover:text-text transition-colors"
                    title="Reset Session"
                  >
                      <RotateCcw size={16} />
                  </button>
              </div>

              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-surface" ref={scrollRef}>
                  {messages.map((msg) => (
                      <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''} animate-in fade-in slide-in-from-bottom-2`}>
                          {/* Avatar */}
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${
                              msg.role === 'model' 
                                ? 'bg-surface-secondary border-brand/20 text-brand' 
                                : 'bg-primary/10 border-primary/20 text-primary'
                          }`}>
                              {msg.role === 'model' ? <Bot size={16} /> : <User size={16} />}
                          </div>

                          {/* Bubble */}
                          <div className={`flex flex-col max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                              <div className={`px-5 py-3.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap shadow-sm ${
                                  msg.role === 'user' 
                                    ? 'bg-primary text-black font-medium rounded-tr-sm' 
                                    : 'bg-surface-secondary text-text border border-border rounded-tl-sm'
                              }`}>
                                  {msg.text}
                              </div>
                              
                              {/* Sources / Grounding */}
                              {msg.sources && msg.sources.length > 0 && (
                                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                                      {msg.sources.map((src, idx) => (
                                          <a 
                                            key={idx} 
                                            href={src.uri} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-2 text-[10px] bg-surface-highlight hover:bg-surface-secondary border border-border rounded-lg px-3 py-2 text-secondary hover:text-primary transition-colors truncate"
                                          >
                                              <Globe size={10} className="shrink-0" />
                                              <span className="truncate">{src.title}</span>
                                          </a>
                                      ))}
                                  </div>
                              )}
                              
                              <span className="text-[10px] text-secondary mt-1 opacity-50 px-1">
                                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                          </div>
                      </div>
                  ))}

                  {isTyping && (
                      <div className="flex gap-4 animate-pulse">
                          <div className="w-8 h-8 rounded-full bg-surface-secondary border border-brand/20 flex items-center justify-center text-brand">
                              <Bot size={16} />
                          </div>
                          <div className="bg-surface-secondary px-4 py-3 rounded-2xl rounded-tl-sm flex gap-1 items-center border border-border">
                              <div className="w-1.5 h-1.5 bg-secondary/50 rounded-full animate-bounce"></div>
                              <div className="w-1.5 h-1.5 bg-secondary/50 rounded-full animate-bounce delay-75"></div>
                              <div className="w-1.5 h-1.5 bg-secondary/50 rounded-full animate-bounce delay-150"></div>
                          </div>
                      </div>
                  )}
              </div>

              {/* Input Area */}
              <div className="p-4 bg-surface border-t border-border">
                  <div className="relative flex items-center">
                      <input 
                        type="text" 
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="Ask Fidelio about markets, news, or technicals..."
                        className="w-full bg-surface-secondary hover:bg-surface-highlight focus:bg-surface-highlight border border-border focus:border-brand/50 rounded-xl pl-4 pr-12 py-3.5 text-sm text-text outline-none transition-all shadow-inner"
                        disabled={isTyping}
                      />
                      <button 
                        onClick={() => handleSend()}
                        disabled={!input.trim() || isTyping}
                        className="absolute right-2 p-2 bg-brand hover:bg-brand/90 text-white rounded-lg disabled:opacity-50 disabled:bg-secondary/20 transition-all shadow-lg shadow-brand/20 active:scale-95"
                      >
                          <Send size={16} />
                      </button>
                  </div>
                  <div className="text-center mt-2">
                       <p className="text-[10px] text-secondary/40">AI can make mistakes. Verify important information.</p>
                  </div>
              </div>
          </Card>
       </div>
    </div>
  );
};
