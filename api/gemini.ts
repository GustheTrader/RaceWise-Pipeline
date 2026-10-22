import { authorized, json } from '../server/auth.js';
import {
  parseMorningCard, parseRacingDigest, parseBackupEntries, parseDRF, syncLiveDataFromWeb, scrapeOTBData,
} from '../server/gemini.js';

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) return json({ error: 'Wrong or missing app password' }, 401);
  if (!process.env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY is not set on the server' }, 500);

  const { task, request = {}, trackName } = await req.json().catch(() => ({}));
  try {
    switch (task) {
      case 'morning': return json(await parseMorningCard(request, trackName));
      case 'digest': return json(await parseRacingDigest(request));
      case 'entries': return json(await parseBackupEntries(request));
      case 'drf': return json(await parseDRF(request));
      case 'live': return json(await syncLiveDataFromWeb(trackName));
      case 'scrape': return json(await scrapeOTBData(trackName));
      default: return json({ error: `Unknown task: ${task}` }, 400);
    }
  } catch (err: any) {
    return json({ error: err?.message || String(err) }, 502);
  }
}
