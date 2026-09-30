import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { saveSignup, takeAttempt } from '../db/waitlist';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`drizzle/${file}`, 'utf8'));
  const db = { prepare(sql: string) { let values: any[] = []; const query = { bind(...args: any[]) { values = args; return query; }, async run() { return sqlite.prepare(sql).run(...values); }, async first() { return sqlite.prepare(sql).get(...values) || null; } }; return query; } } as unknown as D1Database;
  return { sqlite, db };
}

test('hosted waitlist stores consent and deduplicates emails in SQLite', async () => {
  const {sqlite,db} = database();
  try {
    await saveSignup(db,'reader@example.com','hero');
    await saveSignup(db,'reader@example.com','footer');
    await saveSignup(db,'another@example.com','footer');
    const rows=sqlite.prepare('SELECT * FROM waitlist ORDER BY email').all();
    assert.equal(rows.length,2);assert.equal(rows[1].source,'hero');assert.equal(rows[1].consent,'early-access-v1');
    assert.ok(rows[1].joined_at);assert.ok(rows[1].id);
  } finally {sqlite.close();}
});

test('hosted waitlist rate limit is persistent, expires, and does not store raw IPs', async () => {
  const {sqlite,db}=database();const now=1800000000000;
  try {
    for(let i=0;i<10;i++)assert.equal(await takeAttempt(db,'192.0.2.7',now),true);
    assert.equal(await takeAttempt(db,'192.0.2.7',now),false);
    assert.equal(await takeAttempt(db,'192.0.2.8',now),true);
    assert.equal(await takeAttempt(db,'192.0.2.7',now+3600001),true);
    const rows=sqlite.prepare('SELECT * FROM waitlist_rate_limits').all();
    assert.equal(rows.length,1);assert.match(rows[0].key as string,/^[0-9a-f]{64}$/);
  } finally {sqlite.close();}
});
