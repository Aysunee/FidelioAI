import React from 'react';
import { Brain, Smile, Frown, Zap, Shield, Target } from 'lucide-react';
import { cn } from '@/utils/cn';
import { DEFAULT_EMOTIONS } from './constants';
import { motion } from 'framer-motion';

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
        <div className={cn("space-y-4", className)}>
            <div className="flex items-center gap-2">
                <Brain size={14} className="text-orange-400 opacity-50" />
                <span className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em]">Psychological State</span>
            </div>

            <div className="grid grid-cols-5 gap-2">
                {DEFAULT_EMOTIONS.map(emotion => {
                    const Icon = emotionIcons[emotion.id] || Brain;
                    const isActive = selectedEmotion === emotion.id;

                    return (
                        <motion.button
                            key={emotion.id}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => onChange(isActive ? '' : emotion.id)}
                            className={cn(
                                "flex flex-col items-center gap-2 p-3 rounded-2xl border transition-all duration-300",
                                isActive
                                    ? `bg-orange-500/20 border-orange-500/40 text-orange-400 shadow-[0_0_15px_rgba(249,115,22,0.15)]`
                                    : "text-gray-600 hover:border-orange-500/20 hover:text-orange-400"
                            )}
                            style={!isActive ? { backgroundColor: 'var(--bg-matrix-slot)', borderColor: 'var(--border-matrix-slot)' } : {}}
                        >
                            <Icon size={16} className={cn(isActive ? "opacity-100" : "opacity-40")} />
                            <span className="text-[8px] font-black uppercase tracking-widest">{emotion.label}</span>
                        </motion.button>
                    );
                })}
            </div>
        </div>
    );
};
