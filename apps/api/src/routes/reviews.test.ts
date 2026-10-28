import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, utimesSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { readConfig } from '../config.js';
import { openDatabase } from '../db/index.js';
import { analysisJobs, templateVersions, templates } from '../db/schema.js';
import { DocumentStore } from '../storage/documents.js';
import { ReviewStore } from '../storage/reviews.js';
import { TemplateCompiler } from '../services/docx/compiler.js';
import { compilationCorpus } from '../testing/compilation-corpus.js';
import { indexDocx } from '../services/docx/indexer.js';
import { resolveOccurrence } from '../services/ai/match-resolver.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function setup() {
  const base = readConfig({}); mkdirSync(base.STORAGE_DIR, { recursive: true });
  const directory = mkdtempSync(resolve(base.STORAGE_DIR, 'review-test-'));
  const config = { ...base, DATABASE_PATH: resolve(directory, 'app.sqlite'), STORAGE_DIR: resolve(directory, 'files') };
  const source = compilationCorpus()[0]?.source; if (!source) throw new Error('Fixture missing');
  const store = new DocumentStore(config, 15 * 1024 * 1024); const imported = await store.import(source); store.close();
  const app = buildApp(config); const database = openDatabase(config);
  cleanups.push(async () => { await app.close(); database.close(); rmSync(directory, { recursive: true, force: true }); });
  const block = indexDocx(source).blocks.find((b) => b.section === 'body'); if (!block) throw new Error('No block');
  const field = { id: randomUUID(), key: 'client_name', label: 'Client', type: 'text' as const, required: true, default: 'Sample', formatting: {}, occurrences: [{ id: randomUUID(), blockId: block.id, quote: 'Alex Morgan', start: 8, end: 19 }] };
  const input = { sourceHash: imported.sourceHash, expectedRevision: 0, fields: [field], decisions: [] as { occurrenceId: string; status: 'rejected' | 'accepted'; approvedOccurrenceId?: string }[], analysisJobId: undefined as string | undefined };
  const url = `/api/documents/${imported.documentId}`;
  const save = (payload: unknown = input) => app.inject({ method: 'PUT', url: `${url}/fields`, payload: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
  const publish = (revision = 1) => app.inject({ method: 'POST', url: `${url}/publish`, payload: { sourceHash: imported.sourceHash, reviewRevision: revision } });
  return { config, app, database, source, ...imported, field, input, url, save, publish, block };
}
it('persists review, metadata and immutable versions across restart; concurrent publish is idempotent', async () => {
  const s = await setup();
  expect((await s.app.inject(`${s.url}/fields`)).json()).toMatchObject({ revision: 0, fields: [], decisions: [] });
  const saved = await s.save(); expect(saved.statusCode).toBe(200); expect(saved.headers['cache-control']).toBe('no-store');
  expect((await s.save()).statusCode).toBe(409);
  const results = await Promise.all([s.publish(), s.publish()]);
  expect(results.map((r) => r.statusCode)).toEqual([200, 200]); expect(results[0]?.json()).toEqual(results[1]?.json());
  const first = s.database.db.select().from(templateVersions).get(); if (!first) throw new Error('Version missing');
  const bytes = readFileSync(first.compiledPath);
  s.field.label = 'Renamed client';
  expect((await s.save({ ...s.input, expectedRevision: 1 })).statusCode).toBe(200);
  expect((await s.publish(2)).json()).toMatchObject({ versionNumber: 2, fields: [{ label: 'Renamed client' }] });
  expect(readFileSync(first.compiledPath)).toEqual(bytes);
  expect(JSON.parse(first.schemaJson)[0].label).toBe('Client');
  expect(s.database.db.select().from(templates).all()).toHaveLength(1);
  expect(readFileSync(resolve(s.config.STORAGE_DIR, 'originals', `${s.documentId}.docx`))).toEqual(s.source);
  await s.app.close(); const restarted = buildApp(s.config);
  try { expect((await restarted.inject(`${s.url}/fields`)).json()).toMatchObject({ revision: 2, fields: [{ label: 'Renamed client', default: 'Sample', formatting: {} }] }); }
  finally { await restarted.close(); }
});
it('rejects forged provenance and persists rejection when an accepted AI occurrence is removed', async () => {
  const s = await setup(); const jobId = randomUUID(); const now = new Date().toISOString();
  const o = resolveOccurrence({ blockId: s.block.id, quote: 'Alex Morgan' }, new Map([[s.block.id, s.block]]));
  s.database.db.insert(analysisJobs).values({ id: jobId, documentId: s.documentId, sourceHash: s.sourceHash, model: 'fake', status: 'done', createdAt: now, updatedAt: now, resultJson: JSON.stringify({ fields: [{ key: 'client_name', label: 'Client', type: 'text', required: true, confidence: 1, occurrences: [o] }], warnings: [] }) }).run();
  const approved = { ...s.field.occurrences[0], provenance: { analysisJobId: jobId, occurrenceId: o.id } };
  s.input.analysisJobId = jobId;
  const fields = [{ ...s.field, occurrences: [approved] }];
  const accepted = { occurrenceId: o.id, status: 'accepted', approvedOccurrenceId: approved.id };
  expect((await s.save({ ...s.input, fields, decisions: [accepted] })).statusCode).toBe(200);
  expect((await s.save({ ...s.input, expectedRevision: 1, fields: [], decisions: [] })).statusCode).toBe(422);
  expect((await s.save({ ...s.input, expectedRevision: 1, fields: [], decisions: [{ occurrenceId: o.id, status: 'rejected' }] })).statusCode).toBe(200);
  expect((await s.app.inject(`${s.url}/fields`)).json().decisions).toEqual([{ occurrenceId: o.id, status: 'rejected' }]);
  expect((await s.save({ ...s.input, expectedRevision: 2, decisions: [{ occurrenceId: randomUUID(), status: 'rejected' }] })).statusCode).toBe(422);
});
it('rejects invalid selections, hashes, missing documents, unknown keys and unsaved publication', async () => {
  const s = await setup();
  expect((await s.publish()).statusCode).toBe(409);
  expect((await s.save({ ...s.input, sourceHash: '0'.repeat(64) })).statusCode).toBe(409);
  expect((await s.save({ ...s.input, fields: [{ ...s.field, key: 'constructor' }] })).statusCode).toBe(400);
  expect((await s.save({ ...s.input, fields: [{ ...s.field, occurrences: [{ ...s.field.occurrences[0], blockId: 'missing' }] }] })).statusCode).toBe(422);
  expect((await s.app.inject(`/api/documents/${randomUUID()}/fields`)).statusCode).toBe(404);
  expect((await s.app.inject('/api/documents/bad/fields')).statusCode).toBe(400);
  expect((await s.save()).statusCode).toBe(200);
  expect((await s.publish(2)).statusCode).toBe(409);
});
it('round-trips date/number/currency formatting without interpretation', async () => {
  const s = await setup();
  for (const metadata of [{ type: 'currency', default: 120.5, formatting: { locale: 'de-DE', currency: 'EUR', precision: 4 } }, { type: 'date', default: '2028-02-29', formatting: { dateFormat: 'YYYY-MM-DD' } }, { type: 'number', default: 0, formatting: { locale: 'en-US', precision: 0 } }]) {
    const revision = (await s.app.inject(`${s.url}/fields`)).json().revision;
    const response = await s.save({ ...s.input, expectedRevision: revision, fields: [{ ...s.field, ...metadata }] });
    expect(response.statusCode).toBe(200);
    expect(response.json().fields[0]).toMatchObject(metadata);
  }
});
it('rolls back failed DB publication and cleans the uncommitted file; retry succeeds', async () => {
  const s = await setup(); await s.save();
  s.database.db.run(sql`CREATE TRIGGER fail_publication BEFORE INSERT ON template_versions BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
  const failed = await s.publish(); expect(failed.statusCode).toBe(500); expect(failed.json().code).toBe('PUBLICATION_FAILED');
  expect(s.database.db.select().from(templateVersions).all()).toHaveLength(0);
  expect(s.database.db.select().from(templates).all()).toHaveLength(0);
  expect(readdirSync(resolve(s.config.STORAGE_DIR, 'templates'))).toHaveLength(0);
  s.database.db.run(sql`DROP TRIGGER fail_publication`);
  expect((await s.publish()).statusCode).toBe(200);
});
it('failed writes never commit version rows and errors omit private paths', async () => {
  const s = await setup(); await s.save();
  writeFileSync(resolve(s.config.STORAGE_DIR, 'templates'), 'blocked');
  const result = await s.publish(); expect(result.statusCode).toBe(500);
  expect(result.body).not.toContain(s.config.STORAGE_DIR);
  expect(s.database.db.select().from(templateVersions).all()).toHaveLength(0);
});
it('rechecks revision after compiling and removes losing files', async () => {
  const s = await setup(); await s.save();
  const original = TemplateCompiler.prototype.compile;
  vi.spyOn(TemplateCompiler.prototype, 'compile').mockImplementationOnce(async function (this: TemplateCompiler, ...args) {
    const bytes = await original.apply(this, args);
    expect((await s.save({ ...s.input, expectedRevision: 1 })).statusCode).toBe(200);
    return bytes;
  });
  expect((await s.publish()).statusCode).toBe(409);
  expect(s.database.db.select().from(templateVersions).all()).toHaveLength(0);
  expect(readdirSync(resolve(s.config.STORAGE_DIR, 'templates'))).toHaveLength(0);
});
it('cleans old orphan files only, preserving referenced versions and originals', async () => {
  const s = await setup(); await s.save(); await s.publish();
  const folder = resolve(s.config.STORAGE_DIR, 'templates'); const orphan = resolve(folder, `${randomUUID()}.docx`); const recent = resolve(folder, `${randomUUID()}.docx`);
  writeFileSync(orphan, 'orphan'); writeFileSync(recent, 'in-flight'); const old = new Date(Date.now() - 172800000); utimesSync(orphan, old, old);
  const row = s.database.db.select().from(templateVersions).where(eq(templateVersions.reviewRevision, 1)).get(); if (!row) throw new Error('Missing version');
  utimesSync(row.compiledPath, old, old);
  const store = new ReviewStore(s.config, 15 * 1024 * 1024); try { await store.cleanupOrphans(); } finally { store.close(); }
  expect(readdirSync(folder)).toHaveLength(2); expect(readFileSync(row.compiledPath).length).toBeGreaterThan(0); expect(readFileSync(recent, 'utf8')).toBe('in-flight');
});
