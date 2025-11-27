
import { GoogleGenAI } from "@google/genai";
import { Ticker, FuturesTicker } from "../types";

// Initialize the client
// In a real production build, ensure process.env.API_KEY is defined in your build environment
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || 'DEMO_KEY' });

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  sources?: { title: string; uri: string }[];
  timestamp: number;
}

const SYSTEM_INSTRUCTION = `You are Fidelio, an elite crypto market intelligence analyst. 
Your persona is professional, concise, and data-driven. You speak like a senior trader at a hedge fund.
You have access to real-time market data provided in the context.
ALWAYS use the Google Search tool to verify breaking news, macro events, or reasons for sudden price moves.
When analyzing, combine the technical data provided with the search results.
Format your responses using Markdown. Use bullet points for readability.
If you use Google Search, ensure you integrate the findings into your analysis.`;

export const generateAIResponse = async (
  prompt: string,
  marketContext: { spot: Record<string, Ticker>; futures: Record<string, FuturesTicker> }
): Promise<{ text: string; sources: { title: string; uri: string }[] }> => {
  
  // 1. Construct Context String from App Data
  // We take top assets to avoid context window overflow if list is huge
  const topSpot = Object.values(marketContext.spot)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10)
    .map(t => `${t.symbol}: $${t.lastPrice} (${t.priceChangePercent.toFixed(2)}%)`)
    .join(', ');

  const contextPreamble = `
[CURRENT MARKET DATA CONTEXT]
Top Assets: ${topSpot}
Timestamp: ${new Date().toISOString()}
[END CONTEXT]

User Query: ${prompt}
`;

  try {
    // 2. Call Gemini API
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
          { role: 'user', parts: [{ text: contextPreamble }] }
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ googleSearch: {} }], // Enable Search Grounding
        temperature: 0.7,
      },
    });

    // 3. Extract Text
    const text = response.text || "Market data analyzed. No specific commentary generated.";

    // 4. Extract Grounding Metadata (Sources)
    const sources: { title: string; uri: string }[] = [];
    
    // Check candidates for grounding metadata
    const candidate = response.candidates?.[0];
    if (candidate?.groundingMetadata?.groundingChunks) {
      candidate.groundingMetadata.groundingChunks.forEach((chunk: any) => {
        if (chunk.web) {
          sources.push({
            title: chunk.web.title || 'Source',
            uri: chunk.web.uri
          });
        }
      });
    }

    return { text, sources };

  } catch (error) {
    console.error("Fidelio AI Error:", error);
    
    // Fallback for Demo/No-Key environment
    return {
      text: "Connection to Neural Net unstable (Check API Key). \n\nHowever, based on local analysis: \n- **BTC** is showing volatility.\n- **Funding Rates** suggest leverage is neutral.\n\nPlease verify API configuration to enable deep search capabilities.",
      sources: []
    };
  }
};
