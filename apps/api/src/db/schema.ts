import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Phase 1 metadata only; document and template records arrive in their own phases.
export const appMetadata = sqliteTable('app_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
