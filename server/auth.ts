import { timingSafeEqual } from 'node:crypto';

// The deployed site is public, so every API call must carry the shared app password.
export function authorized(req: Request): boolean {
  const expected = process.env.PIPELINE_APP_PASSWORD;
  const given = req.headers.get('x-app-password');
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
