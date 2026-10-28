import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

export const documentReviews = sqliteTable('document_reviews', {
  documentId: text('document_id').primaryKey().references(() => documents.id),
  sourceHash: text('source_hash').notNull(), revision: integer('revision').notNull(),
  snapshotJson: text('snapshot_json').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});
export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(), documentId: text('document_id').notNull().unique().references(() => documents.id),
});
export const templateVersions = sqliteTable('template_versions', {
  id: text('id').primaryKey(), templateId: text('template_id').notNull().references(() => templates.id),
  documentId: text('document_id').notNull().references(() => documents.id),
  versionNumber: integer('version_number').notNull(), reviewRevision: integer('review_revision').notNull(),
  sourceHash: text('source_hash').notNull(), compiledHash: text('compiled_hash').notNull(), compiledPath: text('compiled_path').notNull(),
  schemaJson: text('schema_json').notNull(), createdAt: text('created_at').notNull(),
}, (t) => [uniqueIndex('version_number_unique').on(t.templateId, t.versionNumber), uniqueIndex('review_publication_unique').on(t.documentId, t.reviewRevision)]);
