import { authorized, json } from '../server/auth.js';
import {
  parseMorningCard, parseRacingDigest, parseBackupEntries, parseDRF, syncLiveDataFromWeb, scrapeOTBData,
} from '../server/gemini.js';

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) return json({ error: 'Wrong or missing app password' }, 401);

  const body = await req.json().catch(() => ({}));
  const { task, trackName } = body;
  const request = body.request ?? {};
  const validTasks = ['morning', 'digest', 'entries', 'drf', 'live', 'scrape'];
  if (!validTasks.includes(task)) return json({ error: `Unknown task: ${task}` }, 400);

  const needsGemini = task === 'live' || task === 'scrape'
    || (task === 'morning' && !request.pdfData && !request.text)
    || (!process.env.CHEAPERINFERENCE_API_KEY && ['morning', 'digest', 'entries', 'drf'].includes(task));
  if (needsGemini && !process.env.GEMINI_API_KEY) {
    return json({ error: 'GEMINI_API_KEY is not set for this web-search task' }, 500);
  }
  if (!process.env.CHEAPERINFERENCE_API_KEY && !process.env.GEMINI_API_KEY) {
    return json({ error: 'Set CHEAPERINFERENCE_API_KEY or GEMINI_API_KEY on the server' }, 500);
  }

  try {
    switch (task) {
      case 'morning': return json(await parseMorningCard(request, trackName));
      case 'digest': return json(await parseRacingDigest(request));
      case 'entries': return json(await parseBackupEntries(request));
      case 'drf': return json(await parseDRF(request));
      case 'live': return json(await syncLiveDataFromWeb(trackName));
      case 'scrape': return json(await scrapeOTBData(trackName));
    }
  } catch (err: any) {
    return json({ error: err?.message || String(err) }, 502);
  }
}
