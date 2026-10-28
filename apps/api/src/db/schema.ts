import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Application metadata and immutable imported sources.
export const appMetadata = sqliteTable('app_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  sourcePath: text('source_path').notNull(),
  sourceHash: text('source_hash').notNull(),
  createdAt: text('created_at').notNull(),
});
