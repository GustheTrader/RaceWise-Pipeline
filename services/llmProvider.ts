// Dispatches to the active LLM backend based on the LLM_PROVIDER env var.
//   openrouter (default) → services/openrouterService.ts
//   gemini               → services/geminiService.ts
// All consumers should import from this module rather than a provider file
// directly, so the backend can be swapped without touching callers.
import * as gemini from "./geminiService";
import * as openrouter from "./openrouterService";

const provider = (process.env.LLM_PROVIDER || "openrouter").toLowerCase();
const impl = provider === "gemini" ? gemini : openrouter;

export type { ParseRequest } from "./geminiService";

export const parseMorningCard = impl.parseMorningCard;
export const parseRacingDigest = impl.parseRacingDigest;
export const parseBackupEntries = impl.parseBackupEntries;
export const parseDRF = impl.parseDRF;
export const syncLiveDataFromWeb = impl.syncLiveDataFromWeb;
export const scrapeOTBData = impl.scrapeOTBData;
