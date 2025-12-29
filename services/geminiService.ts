// @google/genai SDK Integration for RaceWise AI
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
                catboostScore: { type: Type.NUMBER },
                lightgbmScore: { type: Type.NUMBER },
                rnnScore: { type: Type.NUMBER },
                xgboostScore: { type: Type.NUMBER },
                classToday: { type: Type.INTEGER },
                classRecentBest: { type: Type.INTEGER },
                jockey: { type: Type.STRING },
                trainer: { type: Type.STRING },
                jockeyWinRate: { type: Type.NUMBER },
                trainerWinRate: { type: Type.NUMBER },
                hf: { type: Type.STRING },
                comments: { type: Type.STRING },
                morningLine: { type: Type.STRING },
                liveOdds: { type: Type.STRING },
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
              required: [
                "name", 
                "programNumber", 
                "jockey", 
                "trainer", 
                "jockeyWinRate", 
                "trainerWinRate", 
                "morningLine", 
                "pastPerformances"
              ]
            }
          }
        },
        required: ["number", "horses"]
      }
    }
  },
  required: ["track", "date", "races"]
};

/**
 * Tool 4: Morning Card Parser
 */
export const parseMorningCard = async (request: ParseRequest): Promise<PipelineResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `MISSION: ABSOLUTE FULL DAILY CARD EXTRACTION. 
    Parse the uploaded entries/PDF to build the baseline race card for RasewiseAI.
    1. EXTRACT THE ENTIRE CARD. If there are 11 or 12 races, you MUST parse every single one.
    2. DO NOT TRUNCATE. Finishing at Race 7 is a CRITICAL FAILURE. 
    3. CAPTURE Program Numbers and Morning Line Odds precisely.
    4. EXTRACT 5 most recent Past Performances (Date, Finish, Distance) for every horse.
    5. Link Jockeys and Trainers to each entry.
    6. Find or estimate Jockey and Trainer Win Rates as percentages (numbers).`;

  const parts: any[] = [{ text: prompt }];
  if (request.pdfData) parts.push({ inlineData: request.pdfData });
  else if (request.text) parts.push({ text: request.text });

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts },
    config: { 
      responseMimeType: "application/json", 
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 50000,
      thinkingConfig: { thinkingBudget: 15000 }
    }
  });

  return JSON.parse(response.text.trim());
};

/**
 * Scrapes current entries and ML odds from OffTrackBetting.com or similar sources.
 * Optimized for full-card dashboard synchronization.
 */
export const scrapeOTBData = async (trackName: string): Promise<any> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const query = `MISSION: SCRAPE FULL CARD MARKET DATA.
    Target: offtrackbetting.com for "${trackName}".
    Requirements:
    1. Retrieve EVERY race scheduled for today at ${trackName} without exception (R1 through FINAL RACE).
    2. Capture EVERY horse name, program number, and morning line (ML) odds.
    3. Format as a master dashboard sync object.
    
    Return strict JSON:
    {
      "track": "${trackName}",
      "scrapedAt": "${new Date().toISOString()}",
      "races": [
        {
          "number": 1,
          "horses": [
            {"program": "1", "name": "HORSE NAME", "ml": "5/2"}
          ]
        }
      ]
    }`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: query,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      maxOutputTokens: 30000,
      thinkingConfig: { thinkingBudget: 10000 }
    }
  });

  const data = JSON.parse(response.text.trim());
  
  // MUST extract URLs from groundingChunks when using googleSearch tool
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (chunks) {
    data.groundingSources = chunks
      .filter((chunk: any) => chunk.web)
      .map((chunk: any) => ({
        uri: chunk.web.uri,
        title: chunk.web.title
      }));
  }

  return data;
};

export const parseRacingDigest = async (request: ParseRequest): Promise<PipelineResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `CRITICAL MISSION: You are parsing a Today's Racing Digest PDF for Rasewiseai.com. 
    1. EXTRACT EVERY SINGLE RACE (R1 through end of card). DO NOT TRUNCATE. 
    2. If the document has 11 races, you MUST return all 11 races in the JSON array.
    3. FOR EVERY HORSE: Extract the "Consensus" rating.
    4. CAPTURE Jockey Win Rate and Trainer Win Rate statistics.
    5. Generate Neural Ensemble Scores (0-100 scale).`;

  const parts: any[] = [{ text: prompt }];
  if (request.pdfData) parts.push({ inlineData: request.pdfData });
  else if (request.text) parts.push({ text: request.text });

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts },
    config: { 
      responseMimeType: "application/json", 
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 60000,
      thinkingConfig: { thinkingBudget: 20000 }
    }
  });

  return JSON.parse(response.text.trim());
};

export const parseBackupEntries = async (request: ParseRequest): Promise<PipelineResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `FULL CARD BACKUP PARSER: Parse all races on this card (R1 to R12+). Map every entry to our ensemble pipeline. Ensure Jockey and Trainer win rates are captured. NO TRUNCATION ALLOWED.`;

  const parts: any[] = [{ text: prompt }];
  if (request.pdfData) parts.push({ inlineData: request.pdfData });
  else if (request.text) parts.push({ text: request.text });

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts },
    config: { 
      responseMimeType: "application/json", 
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 50000,
      thinkingConfig: { thinkingBudget: 15000 }
    }
  });

  return JSON.parse(response.text.trim());
};

export const syncLiveDataFromWeb = async (trackHint?: string): Promise<PipelineResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const query = `LIVE TRACK SCAN: Fetch the full current race card for ${trackHint || 'major tracks'}. Focus on REAL-TIME ODDS shifts and confirm field statistics for EVERY RACE on the card. NO TRUNCATION.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: query,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 40000,
      thinkingConfig: { thinkingBudget: 10000 }
    }
  });

  const data = JSON.parse(response.text.trim()) as PipelineResult;
  
  // MUST extract URLs from groundingChunks when using googleSearch tool
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (chunks) {
    data.groundingSources = chunks
      .filter((chunk: any) => chunk.web)
      .map((chunk: any) => ({
        uri: chunk.web.uri,
        title: chunk.web.title
      }));
  }

  return data;
};