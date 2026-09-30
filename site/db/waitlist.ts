export async function saveSignup(db: D1Database, email: string, source: 'hero' | 'footer') {
  await db.prepare('INSERT INTO waitlist (id, email, joined_at, consent, source) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING')
    .bind(crypto.randomUUID(), email, new Date().toISOString(), 'early-access-v1', source).run();
}

export async function takeAttempt(db: D1Database, ip: string, now: number): Promise<boolean> {
  const hour = Math.floor(now / 3600000);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`proof-waitlist:${hour}:${ip}`));
  const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  // Only a short-lived hash is stored, never the visitor's raw IP address.
  await db.prepare('DELETE FROM waitlist_rate_limits WHERE key IN (SELECT key FROM waitlist_rate_limits WHERE expires_at < ? LIMIT 500)').bind(now).run();
  const result = await db.prepare('INSERT INTO waitlist_rate_limits (key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1 RETURNING attempts').bind(key, (hour + 1) * 3600000).first<{ attempts: number }>();
  return !!result && result.attempts <= 10;
}
