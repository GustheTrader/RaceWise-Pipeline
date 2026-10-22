// Server-side Gemini calls (run in the Vercel functions under api/, never in the browser)
import { GoogleGenAI, Type } from "@google/genai";
import type { PipelineResult } from "../types";

// Flash for now: the current GEMINI_API_KEY is free-tier, which has no Pro quota.
// Set GEMINI_MODEL=gemini-3.1-pro-preview once the key's project has billing.
// gemini-3.8-flash is left out: under load it accepts requests and then never answers.
const GEMINI_MODELS = process.env.GEMINI_MODEL
  ? [process.env.GEMINI_MODEL]
  : ["gemini-3-flash-preview", "gemini-3.6-flash", "gemini-3.5-flash"];

// Stay under the 300s Vercel function limit (vercel.json).
const TOTAL_BUDGET_MS = 280_000;
const ATTEMPT_CAP_MS = 200_000;

const isRetryable = (err: any) => {
  const status = err?.status ?? err?.code;
  return status === 503 || status === 500 || status === 429
    || err?.name === "TimeoutError" || err?.name === "AbortError";
};

// Free-tier Flash often answers 503 "high demand" or hangs; move on to the next model.
const generate = async (ai: GoogleGenAI, params: Omit<Parameters<GoogleGenAI["models"]["generateContent"]>[0], "model">) => {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  for (let i = 0; ; i++) {
    const last = i === GEMINI_MODELS.length - 1;
    const remaining = deadline - Date.now();
    try {
      return await ai.models.generateContent({
        ...params,
        model: GEMINI_MODELS[i],
        config: { ...params.config, abortSignal: AbortSignal.timeout(last ? remaining : Math.min(remaining, ATTEMPT_CAP_MS)) }
      });
    } catch (err: any) {
      if (last || !isRetryable(err) || deadline - Date.now() < 20_000) throw err;
    }
  }
};

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
                weight: { type: Type.STRING, description: "MED/WT/EQP column info" },
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
                "weight",
                "morningLine"
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
 * Tool 4: Morning Card Parser & Web Scraper Hybrid
 */
export const parseMorningCard = async (request: ParseRequest, trackName?: string): Promise<PipelineResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  const prompt = `MISSION: ABSOLUTE FULL DAILY CARD EXTRACTION & VERIFICATION.
    Primary Source: ${request.pdfData ? 'Uploaded PDF' : request.text ? 'Pasted text below' : 'Web search for the live card'}
    Target Track: ${trackName || 'Current Card'}
    
    Requirements:
    1. EXTRACT THE ENTIRE CARD (R1 through FINAL RACE).
    2. MANDATORY FIELDS per Horse: Name, Program Number (PP), Weight (WT), Jockey, Trainer, Morning Line (ML).
    3. If parsing a PDF, match entries against live entries if trackName is provided.
    4. Link Jockeys and Trainers precisely.
    5. For every horse, list up to 5 most recent Past Performances found in the source. Never estimate or invent them; leave the list empty if none are given.
    
    DO NOT TRUNCATE. RETURN THE COMPLETE CARD.`;

  const parts: any[] = [{ text: prompt }];
  const config: any = { 
    responseMimeType: "application/json", 
    responseSchema: RESPONSE_SCHEMA,
    maxOutputTokens: 65000,
    thinkingConfig: { thinkingBudget: 15000 }
  };

  if (!request.pdfData && !request.text && trackName) {
    config.tools = [{ googleSearch: {} }];
  }

  if (request.pdfData) parts.push({ inlineData: request.pdfData });
  else if (request.text) parts.push({ text: request.text });

  const response = await generate(ai, {
    contents: { parts },
    config
  });

  const data = JSON.parse(response.text.trim());
  
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

/**
 * Deep Scraper for offtrackbetting.com
 */
export const scrapeOTBData = async (trackName: string): Promise<any> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const query = `MISSION: DEEP SCRAPE FULL CARD MARKET DATA.
    Target: offtrackbetting.com for "${trackName}".
    Requirements:
    1. Retrieve EVERY scheduled race at ${trackName} for today.
    2. For EVERY Horse capture:
       - Program Number (PP)
       - Name
       - Jockey
       - Trainer
       - Weight (WT)
       - Morning Line (ML) Odds
    3. Return R1 through FINAL RACE. NO TRUNCATION.
    
    Return strict JSON:
    {
      "track": "${trackName}",
      "scrapedAt": "${new Date().toISOString()}",
      "races": [
        {
          "number": 1,
          "horses": [
            {"program": "1", "name": "HORSE NAME", "ml": "5/2", "jockey": "NAME", "trainer": "NAME", "weight": "122"}
          ]
        }
      ]
    }`;

  const response = await generate(ai, {
    contents: query,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      maxOutputTokens: 35000,
      thinkingConfig: { thinkingBudget: 10000 }
    }
  });

  const data = JSON.parse(response.text.trim());
  
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
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = `CRITICAL MISSION: You are parsing a Today's Racing Digest PDF for Rasewiseai.com. 
    1. EXTRACT EVERY SINGLE RACE (R1 through the final race of the card). 
    2. NO TRUNCATION. If the document has 11, 12, or 15 races, you MUST return all of them.
    3. FOR EVERY HORSE: Extract the "Consensus" rating, Morning Line (ML), Weight (WT), Jockey, and Trainer.
    4. Generate Neural Ensemble Scores (0-100 scale).`;

  const parts: any[] = [{ text: prompt }];
  if (request.pdfData) parts.push({ inlineData: request.pdfData });
  else if (request.text?.trim()) parts.push({ text: request.text });
  else throw new Error('Attach a PDF or paste the card text first');

  const response = await generate(ai, {
    contents: { parts },
    config: { 
      responseMimeType: "application/json", 
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 65000,
      thinkingConfig: { thinkingBudget: 15000 }
    }
  });

  return JSON.parse(response.text.trim());
};

export const parseBackupEntries = async (request: ParseRequest): Promise<PipelineResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = `FULL CARD BACKUP PARSER: Parse all races on this card (R1 to the end). Map every entry to our ensemble pipeline. DO NOT STOP until the entire card is processed. NO TRUNCATION. Ensure ML Odds, Weights, Jockeys, and Trainers are captured.`;

  const parts: any[] = [{ text: prompt }];
  if (request.pdfData) parts.push({ inlineData: request.pdfData });
  else if (request.text?.trim()) parts.push({ text: request.text });
  else throw new Error('Attach a PDF or paste the card text first');

  const response = await generate(ai, {
    contents: { parts },
    config: { 
      responseMimeType: "application/json", 
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 60000,
      thinkingConfig: { thinkingBudget: 10000 }
    }
  });

  return JSON.parse(response.text.trim());
};

export const parseDRF = async (request: ParseRequest): Promise<PipelineResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = `CRITICAL MISSION: You are parsing a Daily Racing Form (DRF) PDF.
    1. EXTRACT EVERY SINGLE RACE (R1 through the final race of the card). 
    2. NO TRUNCATION.
    3. FOR EVERY HORSE: Extract Morning Line (ML), Weight (WT), Jockey, and Trainer. Also extract past performance statistics.
    4. Generate Neural Ensemble Scores (0-100 scale).`;

  const parts: any[] = [{ text: prompt }];
  if (request.pdfData) parts.push({ inlineData: request.pdfData });
  else if (request.text?.trim()) parts.push({ text: request.text });
  else throw new Error('Attach a PDF or paste the card text first');

  const response = await generate(ai, {
    contents: { parts },
    config: { 
      responseMimeType: "application/json", 
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 65000,
      thinkingConfig: { thinkingBudget: 15000 }
    }
  });

  return JSON.parse(response.text.trim());
};

export const syncLiveDataFromWeb = async (trackHint?: string): Promise<PipelineResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const query = `LIVE TRACK SCAN: Fetch the full current race card for ${trackHint || 'major tracks'}. Focus on REAL-TIME ODDS shifts and confirm field statistics for EVERY SINGLE RACE scheduled today. DO NOT TRUNCATE. Capture WT, J, T, and ML.`;

  const response = await generate(ai, {
    contents: query,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 40000,
      thinkingConfig: { thinkingBudget: 5000 }
    }
  });

  const data = JSON.parse(response.text.trim()) as PipelineResult;
  
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