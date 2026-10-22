import { createHash, timingSafeEqual } from 'node:crypto';

// The deployed site is public, so every API call must carry the shared app password.
export function authorized(req: Request): boolean {
  const expected = process.env.PIPELINE_APP_PASSWORD;
  const given = req.headers.get('x-app-password');
  if (!expected) throw new Error('PIPELINE_APP_PASSWORD is not set on the server');
  if (!given) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
