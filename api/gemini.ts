import { authorized, json } from '../server/auth.js';
import {
  parseMorningCard, parseRacingDigest, parseBackupEntries, parseDRF, syncLiveDataFromWeb, scrapeOTBData,
} from '../server/gemini.js';

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) return json({ error: 'Wrong or missing app password' }, 401);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request body' }, 400);

  const { task, trackName } = body;
  if (body.request !== undefined && (!body.request || typeof body.request !== 'object' || Array.isArray(body.request))) {
    return json({ error: 'Invalid parser input' }, 400);
  }
  const request = body.request ?? {};
  if (typeof request.text === 'string') request.text = request.text.trim();
  const validTasks = ['morning', 'digest', 'entries', 'drf', 'live', 'scrape'];
  if (!validTasks.includes(task)) return json({ error: `Unknown task: ${task}` }, 400);

  const hasPdf = typeof request.pdfData?.data === 'string' && request.pdfData.data.trim().length > 0;
  const hasText = typeof request.text === 'string' && request.text.trim().length > 0;
  if (['digest', 'entries', 'drf'].includes(task) && !hasPdf && !hasText) {
    return json({ error: 'Attach a PDF or paste the card text first' }, 400);
  }
  if (task === 'morning' && !hasPdf && !hasText && !(typeof trackName === 'string' && trackName.trim())) {
    return json({ error: 'Provide a PDF, card text, or track name for a live lookup' }, 400);
  }

  if (!process.env.CHEAPERINFERENCE_API_KEY && !process.env.GEMINI_API_KEY) {
    return json({ error: 'Set CHEAPERINFERENCE_API_KEY or GEMINI_API_KEY on the server' }, 500);
  }
  const needsGemini = task === 'live' || task === 'scrape'
    || (task === 'morning' && !hasPdf && !hasText)
    || (!process.env.CHEAPERINFERENCE_API_KEY && ['morning', 'digest', 'entries', 'drf'].includes(task));
  if (needsGemini && !process.env.GEMINI_API_KEY) {
    return json({ error: 'GEMINI_API_KEY is not set for live web search and OTB scraping' }, 500);
  }

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
