
import { GoogleGenAI, Type } from "@google/genai";
import { PipelineResult, GroundingSource } from "../types";

export interface ParseRequest {
  text?: string;
  pdfData?: {
    data: string;
    mimeType: string;
  };
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    track: { type: Type.STRING },
    date: { type: Type.STRING },
    races: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          number: { type: Type.INTEGER },
          distance: { type: Type.STRING },
          surface: { type: Type.STRING },
          horses: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                programNumber: { type: Type.STRING },
                fire: { type: Type.INTEGER },
                cpr: { type: Type.INTEGER },
                fastFig: { type: Type.INTEGER },
                consensus: { type: Type.INTEGER },
                jockey: { type: Type.STRING },
                trainer: { type: Type.STRING },
                comments: { type: Type.STRING },
                morningLine: { type: Type.STRING, description: "The morning line odds for the horse." },
                liveOdds: { type: Type.STRING, description: "The current live odds for the horse if available from real-time sources." },
                pastPerformances: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      date: { type: Type.STRING },
                      finish: { type: Type.STRING },
                      dist: { type: Type.STRING }
                    }
                  }
                }
              },
              required: ["name", "programNumber"]
            }
          }
        },
        required: ["number", "horses"]
      }
    }
  },
  required: ["track", "date", "races"]
};

// Analyzes the racing digest using gemini-3-pro-preview
export const parseRacingDigest = async (request: ParseRequest): Promise<PipelineResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `Analyze the following Today's Racing Digest document and extract it into a structured JSON format. 
    Focus on extracting Race details, Horse metrics (FIRE, CPR, Fast Fig, Consensus), Horse Identity (Jockey, Trainer), Horse Comments, Morning Line Odds, and exactly the last 5 Past Performances for each horse.
    
    Output the data strictly following this schema:
    - track (string)
    - date (string, YYYY-MM-DD)
    - races (array)`;

  const parts: any[] = [{ text: prompt }];
  
  if (request.pdfData) {
    parts.push({
      inlineData: {
        data: request.pdfData.data,
        mimeType: request.pdfData.mimeType
      }
    });
  } else if (request.text) {
    parts.push({ text: request.text });
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts },
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA
    }
  });

  return JSON.parse(response.text.trim());
};

// Synchronizes live data from web using Google Search grounding
export const syncLiveDataFromWeb = async (trackHint?: string): Promise<PipelineResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const query = trackHint 
    ? `Find today's racing entries, post positions, jockeys, trainers, morning lines, and CRITICALLY the current LIVE ODDS for each horse at ${trackHint}. Access real-time sources like Equibase, OffTrackBetting, or official track live streams to provide the most recent odds updates.`
    : `Find the main horse racing tracks running today (date: ${new Date().toISOString().split('T')[0]}) and extract the full entry card for the most prominent one, including post positions, jockeys, trainers, morning lines, and CURRENT LIVE ODDS for all entries.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: query,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA
    }
  });

  // Extract grounding URLs for compliance with Search Grounding rules
  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const groundingSources: GroundingSource[] = groundingChunks
    .map((chunk: any) => {
      if (chunk.web) return { uri: chunk.web.uri, title: chunk.web.title };
      if (chunk.maps) return { uri: chunk.maps.uri, title: chunk.maps.title };
      return null;
    })
    .filter((s: any): s is GroundingSource => !!s && !!s.uri);

  const parsed = JSON.parse(response.text.trim());
  return {
    ...parsed,
    groundingSources
  };
};
