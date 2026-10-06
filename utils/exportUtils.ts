// jspdf, jspdf-autotable and xlsx are loaded on demand (dynamic import) so they stay out of the
// journal chunk until the user actually exports something.
import type { jsPDF } from 'jspdf';
import { Trade } from '../components/trade-vision/types';
import {
    formatPrice,
    formatSignedUsd,
    getClosedTrades,
    getSignedPct,
    getSignedPnl
} from '../components/trade-vision/tradeMath';

// jsPDF's built-in Helvetica (WinAnsiEncoding) has no ş, ğ, ı, İ, Ş, Ğ glyphs.
// A Unicode TTF is fetched from a CDN at export time; if that fails we transliterate.
const FONT_SOURCES = [
    {
        name: 'Roboto',
        normal: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/roboto@0.2.3/Roboto_400Regular.ttf',
        bold: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/roboto@0.2.3/Roboto_700Bold.ttf'
    },
    {
        name: 'DejaVuSans',
        normal: 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf',
        bold: 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf'
    }
];

type LoadedFont = { name: string; normal: string; bold: string | null };

let fontPromise: Promise<LoadedFont | null> | null = null;

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
    }
    return btoa(binary);
};

const fetchFontBase64 = async (url: string): Promise<string> => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
    try {
        const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
        if (!response.ok) throw new Error(`Font indirilemedi (${response.status})`);
        return arrayBufferToBase64(await response.arrayBuffer());
    } finally {
        if (timer) clearTimeout(timer);
    }
};

const loadUnicodeFont = (): Promise<LoadedFont | null> => {
    if (!fontPromise) {
        fontPromise = (async () => {
            if (typeof fetch === 'undefined' || typeof btoa === 'undefined') return null;
            for (const source of FONT_SOURCES) {
                try {
                    const normal = await fetchFontBase64(source.normal);
                    let bold: string | null = null;
                    try {
                        bold = await fetchFontBase64(source.bold);
                    } catch { /* bold is optional */ }
                    return { name: source.name, normal, bold };
                } catch (err) {
                    console.warn(`[PDF] ${source.name} fontu yüklenemedi:`, err);
                }
            }
            return null;
        })().then(font => {
            if (!font) fontPromise = null; // allow a retry on the next export
            return font;
        });
    }
    return fontPromise;
};

const registerFont = (doc: jsPDF, font: LoadedFont): boolean => {
    try {
        doc.addFileToVFS(`${font.name}-normal.ttf`, font.normal);
        doc.addFont(`${font.name}-normal.ttf`, font.name, 'normal');
        const boldFile = `${font.name}-bold.ttf`;
        doc.addFileToVFS(boldFile, font.bold || font.normal);
        doc.addFont(boldFile, font.name, 'bold');
        doc.setFont(font.name, 'normal');
        return true;
    } catch (err) {
        console.warn('[PDF] font kaydedilemedi, Helvetica kullanılacak:', err);
        return false;
    }
};

// Fallback for Helvetica: keep ç/ö/ü (present in WinAnsi), map the rest to ASCII.
const transliterateTurkish = (text: string) =>
    text
        .replace(/ş/g, 's').replace(/Ş/g, 'S')
        .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
        .replace(/ı/g, 'i').replace(/İ/g, 'I');

const STATUS_LABELS: Record<Trade['status'], string> = {
    WIN: 'KAZANÇ',
    LOSS: 'KAYIP',
    OPEN: 'AÇIK'
};

export const generateTradePDF = async (trades: Trade[]) => {
    try {
        const [{ jsPDF: JsPDF }, { default: autoTable }] = await Promise.all([
            import('jspdf'),
            import('jspdf-autotable')
        ]);
        const doc = new JsPDF();
        const font = await loadUnicodeFont();
        const unicode = font ? registerFont(doc, font) : false;
        const fontName = unicode && font ? font.name : 'helvetica';
        const t = (text: string) => (unicode ? text : transliterateTurkish(text));
        const timestamp = new Date().toLocaleString('tr-TR');

        // Branding & Header
        doc.setFillColor(0, 0, 0); // Black as per image
        doc.rect(0, 0, 210, 40, 'F');

        // Draw Logo
        try {
            doc.addImage('/logo.png', 'PNG', 15, 10, 20, 20);
        } catch (e) {
            doc.setDrawColor(168, 85, 247);
            doc.setLineWidth(0.5);
            doc.circle(25, 20, 10, 'D');
        }

        doc.setTextColor(168, 85, 247); // Vibrant Purple 
        doc.setFontSize(22);
        doc.setFont(fontName, 'bold');
        doc.text('FIDELIO', 40, 22);

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.text('TRADEVISION PRO', 72, 22);

        doc.setFontSize(8);
        doc.setFont(fontName, 'normal');
        doc.setTextColor(156, 163, 175);
        doc.text(t('İŞLEM GÜNLÜĞÜ RAPORU'), 40, 30);
        doc.text(t(`OLUŞTURULMA: ${timestamp}`), 140, 30);

        // Statistics Summary (OPEN trades have no realised P&L)
        const closedTrades = getClosedTrades(trades);
        const winCount = closedTrades.filter(tr => tr.status === 'WIN').length;
        const netPnL = closedTrades.reduce((acc, tr) => acc + getSignedPnl(tr), 0);
        const winRate = closedTrades.length > 0
            ? ((winCount / closedTrades.length) * 100).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
            : '0,0';

        doc.setFillColor(248, 250, 252); // Ultra Light Gray
        doc.roundedRect(15, 45, 180, 20, 3, 3, 'F');

        doc.setTextColor(51, 65, 85);
        doc.setFontSize(7);
        doc.text(t('KAZANMA ORANI'), 25, 52);
        doc.text(t('NET K/Z'), 70, 52);
        doc.text(t('KAPALI İŞLEM'), 115, 52);
        doc.text(t('AÇIK İŞLEM'), 160, 52);

        doc.setTextColor(245, 158, 11); // Amber
        doc.setFontSize(10);
        doc.text(`%${winRate}`, 25, 60);
        doc.text(formatSignedUsd(netPnL), 70, 60);
        doc.text(`${closedTrades.length}`, 115, 60);
        doc.text(`${trades.length - closedTrades.length}`, 160, 60);

        // Trade Table
        const tableData = trades.map(tr => [
            tr.date,
            tr.symbol,
            tr.side,
            STATUS_LABELS[tr.status] || tr.status,
            formatPrice(tr.entry),
            tr.status === 'OPEN' ? 'BEKLİYOR' : formatPrice(tr.exit),
            tr.status === 'OPEN' ? 'BEKLİYOR' : formatSignedUsd(getSignedPnl(tr)),
            tr.setups.join(', ')
        ].map(cell => t(String(cell))));

        autoTable(doc, {
            startY: 75,
            head: [['TARİH', 'SEMBOL', 'YÖN', 'DURUM', 'GİRİŞ', 'ÇIKIŞ', 'K/Z', 'STRATEJİ'].map(t)],
            body: tableData,
            theme: 'grid',
            styles: {
                font: fontName
            },
            headStyles: {
                fillColor: [79, 70, 229],
                textColor: 255,
                fontSize: 8,
                fontStyle: 'bold',
                halign: 'center'
            },
            bodyStyles: {
                fontSize: 7,
                textColor: [30, 41, 59],
                halign: 'center'
            },
            columnStyles: {
                0: { cellWidth: 25 },
                7: { halign: 'left' }
            },
            alternateRowStyles: {
                fillColor: [248, 250, 252]
            }
        });

        doc.save(`TradeVision_Report_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
        console.error('PDF oluşturma hatası:', error);
        if (typeof window !== 'undefined') {
            window.alert('PDF oluşturulamadı. Ayrıntılar için tarayıcı konsoluna bakın.');
        }
    }
};

export const generateTradeExcel = async (trades: Trade[]) => {
    let XLSX: typeof import('xlsx');
    try {
        XLSX = await import('xlsx');
    } catch (error) {
        console.error('Excel modülü yüklenemedi:', error);
        if (typeof window !== 'undefined') {
            window.alert('Excel dosyası oluşturulamadı. Bağlantınızı kontrol edip tekrar deneyin.');
        }
        return;
    }

    // Main Data
    const data = trades.map(t => ({
        'Date': t.date,
        'Time': t.time || '-',
        'Symbol': t.symbol,
        'Side': t.side,
        'Status': t.status,
        'Entry': t.entry,
        'Exit': t.exit || '-',
        'Size': t.size,
        // returnVal / returnPct are already signed (negative = loss)
        'Yield ($)': t.status === 'OPEN' ? '-' : getSignedPnl(t),
        'Yield (%)': t.status === 'OPEN' ? '-' : getSignedPct(t),
        'Setups': t.setups.join(', '),
        'Efficiency': t.efficiency,
        'Emotion': t.emotion || '-',
        'Tags': (t.tags || []).join(', '),
        'Notes': t.notes || ''
    }));

    // Summary Metrics
    const closedTrades = getClosedTrades(trades);
    const winCount = closedTrades.filter(t => t.status === 'WIN').length;
    const netPnL = closedTrades.reduce((acc, t) => acc + getSignedPnl(t), 0);

    const summary = [
        { 'Metric': 'Total Trades', 'Value': trades.length },
        { 'Metric': 'Closed Trades', 'Value': closedTrades.length },
        { 'Metric': 'Open Trades', 'Value': trades.length - closedTrades.length },
        { 'Metric': 'Wins', 'Value': winCount },
        { 'Metric': 'Losses', 'Value': closedTrades.length - winCount },
        { 'Metric': 'Win Rate', 'Value': `${closedTrades.length > 0 ? ((winCount / closedTrades.length) * 100).toFixed(2) : 0}%` },
        { 'Metric': 'Net P&L', 'Value': netPnL }
    ];

    const workbook = XLSX.utils.book_new();

    // Trades Worksheet
    const tradesSheet = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, tradesSheet, 'Trade Log');

    // Summary Worksheet
    const summarySheet = XLSX.utils.json_to_sheet(summary);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Global Metrics');

    XLSX.writeFile(workbook, `TradeVision_Data_${new Date().toISOString().split('T')[0]}.xlsx`);
};
