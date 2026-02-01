import { Ticker, FuturesTicker } from "../types";

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  sources?: { title: string; uri: string }[];
  timestamp: number;
}

import { API_BASE_URL } from '../utils/config';

export const generateAIResponse = async (
  prompt: string,
  marketContext: { spot: Record<string, Ticker>; futures: Record<string, FuturesTicker> }
): Promise<{ text: string; sources: { title: string; uri: string }[] }> => {

  // 1. Construct Context String
  const topSpot = Object.values(marketContext.spot)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10)
    .map(t => `${t.symbol}: $${t.lastPrice} (${t.priceChangePercent.toFixed(2)}%)`)
    .join(', ');

  const context = `
Top Assets: ${topSpot}
Timestamp: ${new Date().toISOString()}
`;

  try {
    const response = await fetch(`${API_BASE_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, context })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Backend analysis failed');
    }

    const data = await response.json();
    return { text: data.text, sources: data.sources || [] };

  } catch (error: any) {
    console.error("Fidelio AI Error:", error);
    return {
      text: error.message ? `⚠️ ${error.message}` : "⚠️ Connection to Fidelio Core failed.",
      sources: []
    };
  }
};
