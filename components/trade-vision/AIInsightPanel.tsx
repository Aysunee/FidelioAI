import React from 'react';
import { Sparkles, Loader2, BrainCircuit } from 'lucide-react';
import { cn } from '@/utils/cn';
import { btnCompact, btnDefault, panelHeader, panelTitle } from './styles';

interface AIInsightPanelProps {
  insight: string | null;
  isAnalyzing: boolean;
  onAnalyze: () => void;
}

const AIInsightPanel: React.FC<AIInsightPanelProps> = ({ insight, isAnalyzing, onAnalyze }) => {
  return (
    <section className="flex shrink-0 flex-col bg-surface">
      <header className={panelHeader}>
        <h2 className={cn(panelTitle, 'flex min-w-0 items-center gap-1.5')}>
          <Sparkles size={12} className="shrink-0 text-primary" />
          <span className="truncate">Fidelio Performance Analyst</span>
        </h2>
        <button
          type="button"
          onClick={onAnalyze}
          disabled={isAnalyzing}
          className={cn(btnDefault, btnCompact)}
        >
          {isAnalyzing ? <Loader2 size={12} className="animate-spin text-primary" /> : <BrainCircuit size={12} className="text-primary" />}
          {isAnalyzing ? 'Processing...' : 'Generate Insight'}
        </button>
      </header>

      <div className="max-h-40 overflow-y-auto px-3 py-2 text-xs leading-relaxed">
        {insight ? (
          <p className="max-w-3xl whitespace-pre-line text-text">
            {insight}
          </p>
        ) : (
          <p className="text-muted">
            Execute analysis to receive an AI-powered correlation review of your current samples.
          </p>
        )}
      </div>
    </section>
  );
};

export default AIInsightPanel;
