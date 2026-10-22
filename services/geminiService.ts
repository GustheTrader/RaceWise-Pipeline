// Browser side of the Gemini parsers. The prompts and the API key live in server/gemini.ts,
// reached through the api/gemini route.
import { PipelineResult } from '../types';
import { apiPost, MAX_PDF_BYTES } from './api';

export interface ParseRequest {
  text?: string;
  pdfData?: {
    data: string;
    mimeType: string;
  };
}

const run = (task: string, request?: ParseRequest, trackName?: string) => {
  if (request?.pdfData && request.pdfData.data.length * 0.75 > MAX_PDF_BYTES) {
    throw new Error('PDF is over 3.2 MB, the upload limit. Split it or upload fewer pages.');
  }
  return apiPost<any>('/api/gemini', { task, request, trackName });
};

export const parseMorningCard = (request: ParseRequest, trackName?: string): Promise<PipelineResult> =>
  run('morning', request, trackName);
export const parseRacingDigest = (request: ParseRequest): Promise<PipelineResult> => run('digest', request);
export const parseBackupEntries = (request: ParseRequest): Promise<PipelineResult> => run('entries', request);
export const parseDRF = (request: ParseRequest): Promise<PipelineResult> => run('drf', request);
export const syncLiveDataFromWeb = (trackHint?: string): Promise<PipelineResult> => run('live', undefined, trackHint);
export const scrapeOTBData = (trackName: string): Promise<any> => run('scrape', undefined, trackName);
