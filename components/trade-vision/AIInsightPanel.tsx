import React from 'react';
import { Sparkles, Loader2, BrainCircuit } from 'lucide-react';
import { cn } from '@/utils/cn';

interface AIInsightPanelProps {
  insight: string | null;
  isAnalyzing: boolean;
  onAnalyze: () => void;
}

const AIInsightPanel: React.FC<AIInsightPanelProps> = ({ insight, isAnalyzing, onAnalyze }) => {
  return (
    <div className="bg-gradient-to-r from-purple-500/10 via-indigo-500/10 to-transparent border border-white/5 rounded-2xl p-6 relative overflow-hidden group backdrop-blur-md">
      <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity pointer-events-none">
        <BrainCircuit size={120} strokeWidth={1} />
      </div>

      <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center border border-purple-500/20">
              <Sparkles size={16} className="text-purple-400" />
            </div>
            <h3 className="text-[11px] font-black text-white uppercase tracking-[0.2em]">Fidelio Performance Analyst</h3>
          </div>

          {insight ? (
            <p className="text-sm text-gray-300 leading-relaxed max-w-2xl animate-in fade-in slide-in-from-top-1 font-medium">
              {insight}
            </p>
          ) : (
            <p className="text-sm text-gray-500 italic font-medium">
              Execute analysis to receive an AI-powered correlation review of your current samples.
            </p>
          )}
        </div>

        <button
          onClick={onAnalyze}
          disabled={isAnalyzing}
          className="shrink-0 bg-white/5 hover:bg-white/10 border border-white/10 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-white flex items-center gap-3 transition-all active:scale-95 disabled:opacity-50"
        >
          {isAnalyzing ? <Loader2 size={16} className="animate-spin text-purple-400" /> : <BrainCircuit size={16} className="text-purple-400" />}
          {isAnalyzing ? 'Processing...' : 'Generate Insight'}
        </button>
      </div>
    </div>
  );
};

export default AIInsightPanel;
