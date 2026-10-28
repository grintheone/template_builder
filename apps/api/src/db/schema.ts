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

export const analysisJobs = sqliteTable('analysis_jobs', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull().references(() => documents.id),
  sourceHash: text('source_hash').notNull(),
  model: text('model').notNull(),
  status: text('status', { enum: ['pending', 'running', 'done', 'failed'] }).notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
  resultJson: text('result_json'), errorJson: text('error_json'),
});
