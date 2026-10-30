import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { eq, desc, and } from 'drizzle-orm';
import { templateDetailSchema, reviewedFieldSchema } from '@studio/shared';
import { openDatabase } from '../db/index.js';
import { templateVersions } from '../db/schema.js';
import { localDataPath, type AppConfig } from '../config.js';
import { hashSource } from '../services/docx/compiler.js';
import { ExportFailure } from '../services/templates/export-error.js';

export class TemplateStore {
  private database;
  constructor(private config: AppConfig) { this.database = openDatabase(config); }
  close() { this.database.close(); }
  private metadata(row: typeof templateVersions.$inferSelect) {
    const fields = reviewedFieldSchema.array().parse(JSON.parse(row.schemaJson)).map(({ occurrences: _occurrences, ...field }) => field);
    return templateDetailSchema.parse({ templateId: row.templateId, versionId: row.id, versionNumber: row.versionNumber, reviewRevision: row.reviewRevision, sourceHash: row.sourceHash, createdAt: row.createdAt, title: `Template ${row.templateId.slice(0, 8)}`, fields });
  }
  list() {
    const rows = this.database.db.select().from(templateVersions).orderBy(desc(templateVersions.createdAt), desc(templateVersions.versionNumber)).all();
    const seen = new Set<string>();
    return rows.filter((row) => { if (seen.has(row.templateId)) return false; seen.add(row.templateId); return true; }).map((row) => this.metadata(row));
  }
  get(id: string, versionId?: string) {
    const row = this.database.db.select().from(templateVersions).where(versionId ? and(eq(templateVersions.templateId, id), eq(templateVersions.id, versionId)) : eq(templateVersions.templateId, id)).orderBy(desc(templateVersions.versionNumber)).get();
    if (!row) throw new ExportFailure('NOT_FOUND', 404, 'The published template version was not found.');
    return { row, detail: this.metadata(row) };
  }
  async source(row: typeof templateVersions.$inferSelect) {
    try {
      const expected = localDataPath(resolve(this.config.STORAGE_DIR, 'templates', `${row.id}.docx`));
      if (row.compiledPath !== expected) throw new Error('Invalid path');
      if ((await stat(expected)).size > 100 * 1024 * 1024) throw new Error('File too large');
      const bytes = await readFile(expected);
      if (hashSource(bytes) !== row.compiledHash) throw new Error('Hash mismatch');
      return bytes;
    } catch { throw new ExportFailure('TEMPLATE_UNAVAILABLE', 409, 'The saved template file is missing or changed. Publish a new version from the source review.'); }
  }
}
