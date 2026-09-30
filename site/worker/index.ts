import { z } from 'zod';
import { saveSignup, takeAttempt } from '../db/waitlist';
import landingHtml from '../dist/client/index.html';

type Env = { DB: D1Database; ASSETS?: Fetcher };
const signup = z.object({
  email: z.string().trim().max(254).email().transform(value => value.toLowerCase()),
  website: z.string().max(500).default(''),
  consent: z.literal(true),
  source: z.enum(['hero', 'footer']).default('hero'),
});
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com",
};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { ...securityHeaders, 'Cache-Control': 'no-store', ...headers } });

export async function handleWaitlist(request: Request, env: Pick<Env, 'DB'>) {
  if (request.method !== 'POST') return json({ error: 'Use the signup form to join.' }, 405, { Allow: 'POST' });
  if (request.headers.get('Origin') && request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  if (!request.headers.get('Content-Type')?.includes('application/json')) return json({ error: 'Send signup details as JSON.' }, 415);
  if (Number(request.headers.get('Content-Length') || 0) > 4096) return json({ error: 'The signup is too large.' }, 413);
  let raw: string;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'Enter your email address.' }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return json({ error: 'The signup is too large.' }, 413); }
      chunks.push(value);
    }
    const body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    raw = new TextDecoder().decode(body);
  } catch { return json({ error: 'The signup could not be read. Please try again.' }, 400); }
  let input;
  try { input = signup.safeParse(JSON.parse(raw)); }
  catch { return json({ error: 'Enter a valid email address.' }, 400); }
  if (!input.success) return json({ error: 'Enter a valid email address and agree to early-access updates.' }, 400);
  if (input.data.website) return json({ ok: true });
  try {
    const allowed = await takeAttempt(env.DB, request.headers.get('CF-Connecting-IP') || 'unknown', Date.now());
    if (!allowed) return json({ error: 'Too many attempts. Please try again in an hour.' }, 429, { 'Retry-After': '3600' });
    await saveSignup(env.DB, input.data.email, input.data.source);
    return json({ ok: true });
  } catch (error) {
    console.error('Waitlist storage unavailable', error instanceof Error ? error.name : 'UnknownError');
    return json({ error: 'We could not save your email. Please try again shortly.' }, 503);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/waitlist') return handleWaitlist(request, env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
    if (url.pathname === '/') return new Response(request.method === 'HEAD' ? null : landingHtml, { headers: { ...securityHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
