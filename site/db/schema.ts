import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const waitlist = sqliteTable('waitlist', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  joinedAt: text('joined_at').notNull(),
  consent: text('consent').notNull(),
  source: text('source').notNull(),
}, table => [uniqueIndex('idx_waitlist_email').on(table.email)]);
export const rateLimits = sqliteTable('waitlist_rate_limits', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
