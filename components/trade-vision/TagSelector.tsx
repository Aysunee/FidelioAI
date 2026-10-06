import React, { useState } from 'react';
import { X, Plus, Tag } from 'lucide-react';
import { cn } from '@/utils/cn';
import { DEFAULT_TAGS } from './constants';
import { badge, badgeInfo, btnCompact, btnDefault, btnGhost, fieldLabel, inputBase } from './styles';

interface TagSelectorProps {
    selectedTags: string[];
    onChange: (tags: string[]) => void;
    className?: string;
}

const chip = 'inline-flex h-6 items-center rounded-sm border px-2 text-[10px] font-semibold uppercase transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';

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
            // Only close the tag input, not the surrounding modal.
            e.stopPropagation();
            setIsAdding(false);
            setCustomTag('');
        }
    };

    return (
        <div className={cn("space-y-1.5", className)}>
            <div className="flex items-center justify-between gap-2">
                <div className={cn(fieldLabel, 'flex items-center gap-1.5')}>
                    <Tag size={12} />
                    <span>Classification Tags</span>
                </div>
                <button
                    type="button"
                    onClick={() => setIsAdding(!isAdding)}
                    className={cn(btnGhost, btnCompact, 'gap-1 text-primary hover:text-primary')}
                >
                    <Plus size={12} />
                    Custom
                </button>
            </div>

            {/* Default Tags */}
            <div className="flex flex-wrap gap-1">
                {DEFAULT_TAGS.map(tag => (
                    <button
                        type="button"
                        aria-pressed={selectedTags.includes(tag)}
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className={cn(
                            chip,
                            selectedTags.includes(tag)
                                ? 'border-primary bg-primary-soft text-primary'
                                : 'border-border bg-surface-secondary text-secondary hover:text-text'
                        )}
                    >
                        {tag}
                    </button>
                ))}
            </div>

            {/* Selected Custom Tags */}
            {selectedTags.filter(tag => !DEFAULT_TAGS.includes(tag)).length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {selectedTags
                        .filter(tag => !DEFAULT_TAGS.includes(tag))
                        .map(tag => (
                            <div
                                key={tag}
                                className={cn(badge, badgeInfo, 'h-6')}
                            >
                                <span>{tag}</span>
                                <button
                                    type="button"
                                    aria-label={`${tag} etiketini kaldır`}
                                    onClick={() => onChange(selectedTags.filter(t => t !== tag))}
                                    className="opacity-70 transition-opacity hover:opacity-100"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                </div>
            )}

            {/* Custom Tag Input */}
            {isAdding && (
                <div className="flex gap-1">
                    <input
                        type="text"
                        value={customTag}
                        onChange={(e) => setCustomTag(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="CUSTOM TAG NAME..."
                        aria-label="Custom tag name"
                        autoFocus
                        className={cn(inputBase, 'flex-1 uppercase')}
                    />
                    <button
                        type="button"
                        onClick={addCustomTag}
                        disabled={!customTag.trim()}
                        className={btnDefault}
                    >
                        Add
                    </button>
                </div>
            )}
        </div>
    );
};
