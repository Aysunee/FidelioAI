import React from 'react';
import { Brain, Smile, Frown, Zap, Shield, Target } from 'lucide-react';
import { cn } from '@/utils/cn';
import { DEFAULT_EMOTIONS } from './constants';
import { fieldLabel } from './styles';

interface EmotionSelectorProps {
    selectedEmotion?: string;
    onChange: (emotion: string) => void;
    className?: string;
}

const emotionIcons: Record<string, any> = {
    confident: Smile,
    fearful: Frown,
    greedy: Zap,
    fomo: Target,
    disciplined: Shield,
};

export const EmotionSelector: React.FC<EmotionSelectorProps> = ({ selectedEmotion, onChange, className }) => {
    return (
        <div className={cn("space-y-1.5", className)}>
            <div className={cn(fieldLabel, 'flex items-center gap-1.5')}>
                <Brain size={12} />
                <span>Psychological State</span>
            </div>

            <div className="flex flex-wrap gap-1">
                {DEFAULT_EMOTIONS.map(emotion => {
                    const Icon = emotionIcons[emotion.id] || Brain;
                    const isActive = selectedEmotion === emotion.id;

                    return (
                        <button
                            type="button"
                            aria-pressed={isActive}
                            key={emotion.id}
                            onClick={() => onChange(isActive ? '' : emotion.id)}
                            className={cn(
                                'inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 text-[10px] font-semibold uppercase transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary',
                                isActive
                                    ? 'border-primary bg-primary-soft text-primary'
                                    : 'border-border bg-surface-secondary text-secondary hover:text-text'
                            )}
                        >
                            <Icon size={12} />
                            <span>{emotion.label}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
