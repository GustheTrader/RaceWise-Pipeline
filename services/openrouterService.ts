// OpenRouter integration for RaceWise AI.
// Uses the OpenAI-compatible Chat Completions endpoint so any model exposed by
// OpenRouter can be swapped in via the LLM_MODEL env var.
import OpenAI from "openai";
import { PipelineResult } from "../types";
import { ParseRequest } from "./geminiService";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = process.env.LLM_MODEL || "google/gemini-2.5-pro";

const getClient = () =>
  new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
    dangerouslyAllowBrowser: true,
    defaultHeaders: {
      "HTTP-Referer": "https://racewise.ai",
      "X-Title": "RaceWise AI",
    },
  });

// Plain JSON Schema (not the @google/genai Type enum) so OpenRouter / OpenAI
// clients can validate the response natively via response_format.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    track: { type: "string" },
    date: { type: "string" },
    races: {
      type: "array",
      items: {
        type: "object",
        properties: {
          number: { type: "integer" },
          distance: { type: "string" },
          surface: { type: "string" },
          horses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                programNumber: { type: "string" },
                fire: { type: "integer" },
                cpr: { type: "integer" },
                fastFig: { type: "integer" },
                consensus: { type: "integer" },
                catboostScore: { type: "number" },
                lightgbmScore: { type: "number" },
                rnnScore: { type: "number" },
                xgboostScore: { type: "number" },
                classToday: { type: "integer" },
                classRecentBest: { type: "integer" },
                jockey: { type: "string" },
                trainer: { type: "string" },
                jockeyWinRate: { type: "number" },
                trainerWinRate: { type: "number" },
                weight: { type: "string" },
                hf: { type: "string" },
                comments: { type: "string" },
                morningLine: { type: "string" },
                liveOdds: { type: "string" },
                pastPerformances: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      date: { type: "string" },
                      finish: { type: "string" },
                      dist: { type: "string" },
                    },
                  },
                },
              },
              required: [
                "name",
                "programNumber",
                "jockey",
                "trainer",
                "weight",
                "morningLine",
              ],
            },
          },
        },
        required: ["number", "horses"],
      },
    },
  },
  required: ["track", "date", "races"],
};

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "racewise_card",
    schema: RESPONSE_SCHEMA,
  },
};

type Content =
  | { type: "text"; text: string }
  | { type: "file"; file: { filename: string; file_data: string } };

const buildContent = (prompt: string, request: ParseRequest): Content[] => {
  const content: Content[] = [{ type: "text", text: prompt }];
  if (request.pdfData) {
    content.push({
      type: "file",
      file: {
        filename: "source.pdf",
        file_data: `data:${request.pdfData.mimeType};base64,${request.pdfData.data}`,
      },
    });
  } else if (request.text) {
    content.push({ type: "text", text: request.text });
  }
  return content;
};

const extractGroundingSources = (message: any) => {
  const annotations = message?.annotations || [];
  return annotations
    .filter((a: any) => a.type === "url_citation" && a.url_citation)
    .map((a: any) => ({
      uri: a.url_citation.url,
      title: a.url_citation.title,
    }));
};

const withOnline = (model: string) =>
  model.endsWith(":online") ? model : `${model}:online`;

const completeJson = async (options: {
  model: string;
  content: Content[] | string;
  maxTokens: number;
  useSchema?: boolean;
}): Promise<{ data: any; message: any }> => {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: options.model,
    messages: [
      {
        role: "user",
        content: options.content as any,
      },
    ],
    response_format: options.useSchema === false
      ? { type: "json_object" }
      : RESPONSE_FORMAT,
    max_tokens: options.maxTokens,
  });

  const message = response.choices[0].message;
  const text = (message.content || "").trim();
  return { data: JSON.parse(text), message };
};

export const parseMorningCard = async (
  request: ParseRequest,
  trackName?: string
): Promise<PipelineResult> => {
  const prompt = `MISSION: ABSOLUTE FULL DAILY CARD EXTRACTION & VERIFICATION.
    Primary Source: ${request.pdfData ? "Uploaded PDF" : "Web Scrape of offtrackbetting.com"}
    Target Track: ${trackName || "Current Card"}

    Requirements:
    1. EXTRACT THE ENTIRE CARD (R1 through FINAL RACE).
    2. MANDATORY FIELDS per Horse: Name, Program Number (PP), Weight (WT), Jockey, Trainer, Morning Line (ML).
    3. If parsing a PDF, match entries against live entries if trackName is provided.
    4. Link Jockeys and Trainers precisely.
    5. For every horse, estimate or find 5 most recent Past Performances.

    DO NOT TRUNCATE. RETURN THE COMPLETE CARD.
    Return strict JSON matching the provided schema.`;

  const liveScrape = !request.pdfData && !request.text && trackName;
  const model = liveScrape ? withOnline(DEFAULT_MODEL) : DEFAULT_MODEL;

  const { data, message } = await completeJson({
    model,
    content: buildContent(prompt, request),
    maxTokens: 65000,
  });

  if (liveScrape) {
    const sources = extractGroundingSources(message);
    if (sources.length) data.groundingSources = sources;
  }
  return data;
};

export const scrapeOTBData = async (trackName: string): Promise<any> => {
  const prompt = `MISSION: DEEP SCRAPE FULL CARD MARKET DATA.
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

  const { data, message } = await completeJson({
    model: withOnline(DEFAULT_MODEL),
    content: prompt,
    maxTokens: 35000,
    useSchema: false,
  });

  const sources = extractGroundingSources(message);
  if (sources.length) data.groundingSources = sources;
  return data;
};

export const parseRacingDigest = async (
  request: ParseRequest
): Promise<PipelineResult> => {
  const prompt = `CRITICAL MISSION: You are parsing a Today's Racing Digest PDF for Rasewiseai.com.
    1. EXTRACT EVERY SINGLE RACE (R1 through the final race of the card).
    2. NO TRUNCATION. If the document has 11, 12, or 15 races, you MUST return all of them.
    3. FOR EVERY HORSE: Extract the "Consensus" rating, Morning Line (ML), Weight (WT), Jockey, and Trainer.
    4. Generate Neural Ensemble Scores (0-100 scale).
    Return strict JSON matching the provided schema.`;

  const { data } = await completeJson({
    model: DEFAULT_MODEL,
    content: buildContent(prompt, request),
    maxTokens: 65000,
  });
  return data;
};

export const parseBackupEntries = async (
  request: ParseRequest
): Promise<PipelineResult> => {
  const prompt = `FULL CARD BACKUP PARSER: Parse all races on this card (R1 to the end). Map every entry to our ensemble pipeline. DO NOT STOP until the entire card is processed. NO TRUNCATION. Ensure ML Odds, Weights, Jockeys, and Trainers are captured.
    Return strict JSON matching the provided schema.`;

  const { data } = await completeJson({
    model: DEFAULT_MODEL,
    content: buildContent(prompt, request),
    maxTokens: 60000,
  });
  return data;
};

export const parseDRF = async (
  request: ParseRequest
): Promise<PipelineResult> => {
  const prompt = `CRITICAL MISSION: You are parsing a Daily Racing Form (DRF) PDF.
    1. EXTRACT EVERY SINGLE RACE (R1 through the final race of the card).
    2. NO TRUNCATION.
    3. FOR EVERY HORSE: Extract Morning Line (ML), Weight (WT), Jockey, and Trainer. Also extract past performance statistics.
    4. Generate Neural Ensemble Scores (0-100 scale).
    Return strict JSON matching the provided schema.`;

  const { data } = await completeJson({
    model: DEFAULT_MODEL,
    content: buildContent(prompt, request),
    maxTokens: 65000,
  });
  return data;
};

export const syncLiveDataFromWeb = async (
  trackHint?: string
): Promise<PipelineResult> => {
  const prompt = `LIVE TRACK SCAN: Fetch the full current race card for ${trackHint || "major tracks"}. Focus on REAL-TIME ODDS shifts and confirm field statistics for EVERY SINGLE RACE scheduled today. DO NOT TRUNCATE. Capture WT, J, T, and ML.
    Return strict JSON matching the provided schema.`;

  const { data, message } = await completeJson({
    model: withOnline(DEFAULT_MODEL),
    content: prompt,
    maxTokens: 40000,
  });

  const sources = extractGroundingSources(message);
  if (sources.length) (data as PipelineResult).groundingSources = sources;
  return data as PipelineResult;
};
