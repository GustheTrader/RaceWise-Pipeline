import { authorized, json } from '../server/auth.js';

// RaceWise AI's ingest function. It files the card under the app's track/race rows
// (race_data / race_horses) where the site and its chat agents read it.
const DEFAULT_INGEST_URL = 'https://bqvavkzgmznjfirgfyhd.supabase.co/functions/v1/pipeline-ingest';

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) return json({ error: 'Wrong or missing app password' }, 401);
  const key = process.env.PIPELINE_INGEST_KEY;
  if (!key) return json({ error: 'PIPELINE_INGEST_KEY is not set on the server' }, 500);

  const res = await fetch(process.env.PIPELINE_INGEST_URL || DEFAULT_INGEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-pipeline-key': key },
    body: await req.text(),
  });
  return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } });
}
