import React, { useState, useRef, useEffect } from 'react';
import { Download, FileText, FileSpreadsheet, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trade } from './types';
import { cn } from '@/utils/cn';
import { generateTradePDF, generateTradeExcel } from '../../utils/exportUtils';

interface ExportButtonProps {
    trades: Trade[];
}

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
                onClick={() => setIsOpen(!isOpen)}
                className="bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 hover:text-white px-4 py-2 rounded-xl font-bold text-[10px] tracking-widest transition-all flex items-center gap-2 active:scale-95 uppercase h-full"
            >
                <Download size={14} />
                Export
                <ChevronDown size={12} className={cn("transition-transform duration-300", isOpen ? "rotate-180" : "")} />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        className="absolute right-0 mt-2 w-56 bg-gray-950/90 border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-[100] backdrop-blur-3xl"
                    >
                        <div className="p-2 space-y-1">
                            <button
                                onClick={() => {
                                    generateTradePDF(trades);
                                    setIsOpen(false);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors rounded-xl group"
                            >
                                <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center border border-purple-500/20 text-purple-400 group-hover:scale-110 transition-transform">
                                    <FileText size={16} />
                                </div>
                                <div>
                                    <div className="text-[10px] font-black text-white uppercase tracking-widest">Generate PDF</div>
                                    <div className="text-[8px] text-gray-500 uppercase font-bold tracking-tighter">Tactical Visual Report</div>
                                </div>
                            </button>

                            <button
                                onClick={() => {
                                    generateTradeExcel(trades);
                                    setIsOpen(false);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors rounded-xl group"
                            >
                                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 text-emerald-400 group-hover:scale-110 transition-transform">
                                    <FileSpreadsheet size={16} />
                                </div>
                                <div>
                                    <div className="text-[10px] font-black text-white uppercase tracking-widest">Extract Excel</div>
                                    <div className="text-[8px] text-gray-500 uppercase font-bold tracking-tighter">Raw Data Matrix (.xlsx)</div>
                                </div>
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
