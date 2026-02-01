import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { Trade } from '../components/trade-vision/types';

export const generateTradePDF = (trades: Trade[]) => {
    try {
        const doc = new jsPDF();
        const timestamp = new Date().toLocaleString();

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
        doc.setFont('helvetica', 'bold');
        doc.text('FIDELIO', 40, 22);

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.text('TRADEVISION PRO', 72, 22);

        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(156, 163, 175);
        doc.text('TACTICAL SEEDING PROTOCOL // EVENT LOGS', 40, 30);
        doc.text(`EXTRACTED: ${timestamp}`, 140, 30);

        // Statistics Summary
        const closedTrades = trades.filter(t => t.status !== 'OPEN');
        const winCount = closedTrades.filter(t => t.status === 'WIN').length;
        const lossCount = closedTrades.filter(t => t.status === 'LOSS').length;
        const netPnL = closedTrades.reduce((acc, t) => acc + (t.status === 'WIN' ? (t.returnVal || 0) : -(t.returnVal || 0)), 0);
        const winRate = closedTrades.length > 0 ? ((winCount / closedTrades.length) * 100).toFixed(1) : '0.0';

        doc.setFillColor(248, 250, 252); // Ultra Light Gray
        doc.roundedRect(15, 45, 180, 20, 3, 3, 'F');

        doc.setTextColor(51, 65, 85);
        doc.setFontSize(7);
        doc.text('WIN RATE', 25, 52);
        doc.text('NET YIELD', 70, 52);
        doc.text('TOTAL SAMPLES', 115, 52);
        doc.text('ACTIVE VECTORS', 160, 52);

        doc.setTextColor(245, 158, 11); // Amber
        doc.setFontSize(10);
        doc.text(`${winRate}%`, 25, 60);
        doc.text(`$${netPnL.toLocaleString()}`, 70, 60);
        doc.text(`${closedTrades.length}`, 115, 60);
        doc.text(`${trades.length - closedTrades.length}`, 160, 60);

        // Trade Table
        const tableData = trades.map((t, index) => [
            t.date,
            t.symbol,
            t.side,
            t.status === 'OPEN' ? 'ACTIVE' : t.status,
            `$${t.entry.toLocaleString()}`,
            t.status === 'OPEN' ? 'PENDING' : `$${t.exit?.toLocaleString() || '-'}`,
            t.status === 'OPEN' ? 'PENDING' : `${t.status === 'WIN' ? '+' : '-'}$${(t.returnVal || 0).toLocaleString()}`,
            t.setups.join(', ')
        ]);

        autoTable(doc, {
            startY: 75,
            head: [['DATE', 'SYMBOL', 'SIDE', 'STATUS', 'ENTRY', 'EXIT', 'YIELD', 'SETUP']],
            body: tableData,
            theme: 'grid',
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
        console.error('Tactical PDF Generation Error:', error);
        alert('PDF production failed. Please check the cognitive log (console).');
    }
};

export const generateTradeExcel = (trades: Trade[]) => {
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
        'Yield ($)': t.status === 'OPEN' ? '-' : (t.status === 'WIN' ? t.returnVal : -(t.returnVal || 0)),
        'Yield (%)': t.status === 'OPEN' ? '-' : (t.status === 'WIN' ? t.returnPct : -(t.returnPct || 0)),
        'Setups': t.setups.join(', '),
        'Efficiency': t.efficiency,
        'Emotion': t.emotion || '-',
        'Tags': (t.tags || []).join(', '),
        'Notes': t.notes || ''
    }));

    // Summary Metrics
    const closedTrades = trades.filter(t => t.status !== 'OPEN');
    const winCount = closedTrades.filter(t => t.status === 'WIN').length;
    const netPnL = closedTrades.reduce((acc, t) => acc + (t.status === 'WIN' ? (t.returnVal || 0) : -(t.returnVal || 0)), 0);

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
