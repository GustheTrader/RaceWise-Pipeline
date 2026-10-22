import { PipelineResult } from '../types';
import { apiPost } from './api';

export interface PushResult {
  track_name: string;
  race_date: string;
  races: number;
  horses: number;
  errors: string[];
}

/**
 * Sends a scored card to RaceWise AI through the api/ingest route, which holds the upload key.
 * @param result The handicapped pipeline result.
 * @param track Track name to file it under (falls back to the name parsed from the PDF).
 * @param source Which parser produced it (morning_card, digest, entry, drf, live).
 */
export const persistRaceData = (result: PipelineResult, track: string, source: string): Promise<PushResult> =>
  apiPost<PushResult>('/api/ingest', { result, track: track || result.track, source });
