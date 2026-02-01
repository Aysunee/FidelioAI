
import React from 'react';
import { Sparkles, Loader2, BrainCircuit } from 'lucide-react';

interface AIInsightPanelProps {
  insight: string | null;
  isAnalyzing: boolean;
  onAnalyze: () => void;
}

const AIInsightPanel: React.FC<AIInsightPanelProps> = ({ insight, isAnalyzing, onAnalyze }) => {
  return (
    <div className="px-6 pt-6">
      <div className="bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-cyan-500/10 border border-white/5 rounded-2xl p-5 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:opacity-40 transition-opacity">
          <BrainCircuit size={80} strokeWidth={1} />
        </div>
        
        <div className="relative z-10 flex items-start justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={16} className="text-cyan-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">AI Performance Analyst</h3>
            </div>
            
            {insight ? (
              <p className="text-sm text-slate-300 leading-relaxed max-w-2xl animate-in fade-in slide-in-from-top-1">
                {insight}
              </p>
            ) : (
              <p className="text-sm text-slate-500 italic">
                Get an instant AI-powered review of your filtered performance.
              </p>
            )}
          </div>

          <button 
            onClick={onAnalyze}
            disabled={isAnalyzing}
            className="shrink-0 bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2 rounded-xl text-xs font-bold text-white flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
          >
            {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <BrainCircuit size={14} />}
            {isAnalyzing ? 'Analyzing...' : 'Generate Insight'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIInsightPanel;
