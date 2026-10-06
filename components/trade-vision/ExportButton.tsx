import React, { useState, useRef, useEffect } from 'react';
import { Download, FileText, FileSpreadsheet, ChevronDown } from 'lucide-react';
import { Trade } from './types';
import { cn } from '@/utils/cn';
import { generateTradePDF, generateTradeExcel } from '../../utils/exportUtils';
import { btnCompact, btnDefault, menuSurface } from './styles';

interface ExportButtonProps {
    trades: Trade[];
}

const menuItem = 'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-surface-secondary focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-primary';

export const ExportButton: React.FC<ExportButtonProps> = ({ trades }) => {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={menuRef}>
            <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                onClick={() => setIsOpen(!isOpen)}
                className={cn(btnDefault, btnCompact)}
            >
                <Download size={12} />
                Export
                <ChevronDown size={12} className={cn("transition-transform", isOpen ? "rotate-180" : "")} />
            </button>

            {isOpen && (
                <div role="menu" className={cn('absolute right-0 top-full z-[100] mt-1 w-52 py-1', menuSurface)}>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                            generateTradePDF(trades);
                            setIsOpen(false);
                        }}
                        className={menuItem}
                    >
                        <FileText size={14} className="shrink-0 text-secondary" />
                        <span className="min-w-0">
                            <span className="block text-xs font-medium text-text">Generate PDF</span>
                            <span className="block text-[10px] text-muted">Tactical Visual Report</span>
                        </span>
                    </button>

                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                            generateTradeExcel(trades);
                            setIsOpen(false);
                        }}
                        className={menuItem}
                    >
                        <FileSpreadsheet size={14} className="shrink-0 text-secondary" />
                        <span className="min-w-0">
                            <span className="block text-xs font-medium text-text">Extract Excel</span>
                            <span className="block text-[10px] text-muted">Raw Data Matrix (.xlsx)</span>
                        </span>
                    </button>
                </div>
            )}
        </div>
    );
};
