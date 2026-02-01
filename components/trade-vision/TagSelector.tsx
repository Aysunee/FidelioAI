import React, { useState } from 'react';
import { X, Plus, Tag } from 'lucide-react';
import { cn } from '@/utils/cn';
import { DEFAULT_TAGS } from './constants';
import { motion, AnimatePresence } from 'framer-motion';

interface TagSelectorProps {
    selectedTags: string[];
    onChange: (tags: string[]) => void;
    className?: string;
}

export const TagSelector: React.FC<TagSelectorProps> = ({ selectedTags = [], onChange, className }) => {
    const [isAdding, setIsAdding] = useState(false);
    const [customTag, setCustomTag] = useState('');

    const toggleTag = (tag: string) => {
        if (selectedTags.includes(tag)) {
            onChange(selectedTags.filter(t => t !== tag));
        } else {
            onChange([...selectedTags, tag]);
        }
    };

    const addCustomTag = () => {
        const trimmed = customTag.trim().toLowerCase();
        if (trimmed && !selectedTags.includes(trimmed)) {
            onChange([...selectedTags, trimmed]);
            setCustomTag('');
            setIsAdding(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCustomTag();
        } else if (e.key === 'Escape') {
            setIsAdding(false);
            setCustomTag('');
        }
    };

    return (
        <div className={cn("space-y-3", className)}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Tag size={14} className="text-purple-400 opacity-50" />
                    <span className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em]">Classification Tags</span>
                </div>
                <button
                    onClick={() => setIsAdding(!isAdding)}
                    className="text-[9px] font-black text-purple-400 hover:text-white transition-all uppercase tracking-[0.2em] flex items-center gap-1 bg-purple-500/10 px-2 py-1 rounded-lg border border-purple-500/20"
                >
                    <Plus size={10} />
                    Custom
                </button>
            </div>

            {/* Default Tags */}
            <div className="flex flex-wrap gap-2">
                {DEFAULT_TAGS.map(tag => (
                    <motion.button
                        key={tag}
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        onClick={() => toggleTag(tag)}
                        className={cn(
                            "text-[9px] font-black px-3 py-1.5 rounded-lg border transition-all uppercase tracking-widest",
                            selectedTags.includes(tag)
                                ? 'bg-purple-500/20 text-purple-400 border-purple-500/30 shadow-[0_0_12px_rgba(168,85,247,0.15)]'
                                : 'text-gray-600 hover:border-purple-500/20 hover:text-purple-400'
                        )}
                        style={!selectedTags.includes(tag) ? { backgroundColor: 'var(--bg-matrix-slot)', borderColor: 'var(--border-matrix-slot)' } : {}}
                    >
                        {tag}
                    </motion.button>
                ))}
            </div>

            {/* Selected Custom Tags */}
            {selectedTags.filter(tag => !DEFAULT_TAGS.includes(tag)).length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
                    {selectedTags
                        .filter(tag => !DEFAULT_TAGS.includes(tag))
                        .map(tag => (
                            <motion.div
                                key={tag}
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                className="flex items-center gap-1 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                            >
                                <span>{tag}</span>
                                <button
                                    onClick={() => onChange(selectedTags.filter(t => t !== tag))}
                                    className="hover:text-white transition-colors"
                                >
                                    <X size={12} />
                                </button>
                            </motion.div>
                        ))}
                </div>
            )}

            {/* Custom Tag Input */}
            <AnimatePresence>
                {isAdding && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="flex gap-2 pt-2">
                            <input
                                type="text"
                                value={customTag}
                                onChange={(e) => setCustomTag(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="CUSTOM TAG NAME..."
                                autoFocus
                                className="flex-1 border rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-wider text-gray-600 placeholder:text-gray-400 focus:outline-none focus:border-purple-500/40 transition-all shadow-sm shadow-black/5"
                                style={{ backgroundColor: 'var(--bg-matrix-slot)', borderColor: 'var(--border-matrix-slot)' }}
                            />
                            <button
                                onClick={addCustomTag}
                                disabled={!customTag.trim()}
                                className="bg-purple-500/20 border border-purple-500/30 text-purple-400 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-purple-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                            >
                                Add
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
