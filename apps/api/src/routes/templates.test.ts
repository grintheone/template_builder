import PizZip from 'pizzip';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { PdfConverter } from '../services/pdf/converter.js';
import { buildApp } from '../app.js';
import { readConfig } from '../config.js';
import { DocumentStore } from '../storage/documents.js';
import { ReviewStore } from '../storage/reviews.js';
import { createDocxFixture, paragraph } from '../testing/docx-fixture.js';
import { indexDocx } from '../services/docx/indexer.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0)) await fn(); });
async function setup() {
  const base = readConfig({}); mkdirSync(base.STORAGE_DIR, { recursive: true });
  const directory = mkdtempSync(resolve(base.STORAGE_DIR, 'export-test-'));
  const config = { ...base, DATABASE_PATH: resolve(directory, 'app.sqlite'), STORAGE_DIR: resolve(directory, 'files'), SOFFICE_PATH: resolve(directory, 'missing-soffice'), OLLAMA_BASE_URL: 'http://127.0.0.1:1' };
  const original = createDocxFixture({ body: paragraph('Alex Alex 2026-10-28 1200 42'), header: paragraph('Header'), footer: paragraph('Footer') });
  const documents = new DocumentStore(config, 15 * 1024 * 1024); const imported = await documents.import(original); documents.close();
  const block = indexDocx(original).blocks.find((b) => b.section === 'body'); if (!block) throw new Error('Missing block');
  const occurrence = (quote: string, start: number) => ({ id: randomUUID(), blockId: block.id, quote, start, end: start + quote.length });
  const fields = [
    { id: randomUUID(), key: 'name', label: 'Employee', type: 'text' as const, required: true, formatting: {}, occurrences: [occurrence('Alex', 0), occurrence('Alex', 5)] },
    { id: randomUUID(), key: 'date', label: 'Date', type: 'date' as const, required: true, formatting: { dateFormat: 'YYYY-MM-DD' as const }, occurrences: [occurrence('2026-10-28', 10)] },
    { id: randomUUID(), key: 'amount', label: 'Salary', type: 'currency' as const, required: true, formatting: { locale: 'en-US', currency: 'USD', precision: 2 }, occurrences: [occurrence('1200', 21)] },
    { id: randomUUID(), key: 'count', label: 'Count', type: 'number' as const, required: false, formatting: { locale: 'de-DE', precision: 1 }, occurrences: [occurrence('42', 26)] },
  ];
  const review = new ReviewStore(config, 15 * 1024 * 1024);
  await review.save(imported.documentId, { sourceHash: imported.sourceHash, expectedRevision: 0, fields, decisions: [] });
  const published = await review.publish(imported.documentId, imported.sourceHash, 1); review.close();
  const app = buildApp(config); cleanup.push(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const values = { name: 'Иван Петров', date: '2028-02-29', amount: 1234.5, count: 1234.5 };
  const url = `/api/templates/${published.templateId}`;
  const render = (payload: unknown = { versionId: published.versionId, format: 'docx', values }) => app.inject({ method: 'POST', url: `${url}/render`, payload: JSON.stringify(payload), headers: { 'content-type': 'application/json' } });
  return { app, config, published, values, url, render, imported, original, fields };
}
it('lists/searchable metadata, serves latest detail and renders Cyrillic/repeated fields with Ollama offline', async () => {
  const s = await setup();
  const list = await s.app.inject('/api/templates'); expect(list.statusCode).toBe(200); expect(list.json()).toHaveLength(1);
  expect(list.body).not.toContain('occurrences'); expect(list.body).not.toContain(s.config.STORAGE_DIR);
  expect((await s.app.inject(s.url)).json()).toMatchObject({ versionId: s.published.versionId, fields: [{ key: 'name' }, { key: 'date' }, { key: 'amount' }, { key: 'count' }] });
  const result = await s.render(); expect(result.statusCode).toBe(200); expect(result.headers['content-disposition']).toBe('attachment; filename="document.docx"'); expect(result.headers['cache-control']).toBe('no-store');
  const body = indexDocx(result.rawPayload).blocks.find((b) => b.section === 'body')?.text;
  expect(body).toBe('Иван Петров Иван Петров 2028-02-29 $1,234.50 1.234,5');
  const repeated = new PizZip((await s.render()).rawPayload);
  const first = new PizZip(result.rawPayload);
  expect(Object.keys(repeated.files).sort()).toEqual(Object.keys(first.files).sort());
  for (const [path, entry] of Object.entries(first.files)) if (!entry.dir) expect(repeated.file(path)?.asNodeBuffer()).toEqual(entry.asNodeBuffer());
  expect(readFileSync(resolve(s.config.STORAGE_DIR, 'originals', `${s.imported.documentId}.docx`))).toEqual(s.original);
});
it('rejects invalid values, requests, IDs and unavailable PDFs while DOCX still works', async () => {
  const s = await setup();
  for (const values of [{ ...s.values, name: '' }, { ...s.values, date: '2026-02-29' }, { ...s.values, amount: '12' }, { ...s.values, unexpected: 'private' }, { name: 'Name' }]) {
    const response = await s.render({ versionId: s.published.versionId, format: 'docx', values }); expect(response.statusCode).toBe(422); expect(response.body).not.toContain('private');
  }
  expect((await s.render({ format: 'docx', values: s.values })).statusCode).toBe(400);
  expect((await s.render({ versionId: randomUUID(), format: 'docx', values: s.values })).statusCode).toBe(404);
  expect((await s.app.inject('/api/templates/bad')).statusCode).toBe(400);
  expect((await s.app.inject(`/api/templates/${randomUUID()}`)).statusCode).toBe(404);
  const pdf = await s.render({ versionId: s.published.versionId, format: 'pdf', values: s.values }); expect(pdf.statusCode).toBe(503); expect(pdf.json().code).toBe('PDF_UNAVAILABLE'); expect(pdf.body).not.toContain(s.config.STORAGE_DIR);
  expect((await s.render()).statusCode).toBe(200);
  expect((await s.render({ versionId: s.published.versionId, format: 'docx', values: { ...s.values, count: '' } })).statusCode).toBe(200);
});
it('pins rendering to the displayed version even after another version is published; rejects changed files', async () => {
  const s = await setup();
  const review = new ReviewStore(s.config, 15 * 1024 * 1024);
  await review.save(s.imported.documentId, { sourceHash: s.imported.sourceHash, expectedRevision: 1, fields: s.fields.map((f) => ({ ...f, key: `new_${f.key}` })), decisions: [] });
  await review.publish(s.imported.documentId, s.imported.sourceHash, 2); review.close();
  expect((await s.app.inject(s.url)).json().versionNumber).toBe(2);
  expect((await s.app.inject('/api/templates')).json()).toHaveLength(1);
  expect((await s.render()).statusCode).toBe(200);
  const path = resolve(s.config.STORAGE_DIR, 'templates', `${s.published.versionId}.docx`);
  chmodSync(path, 0o600); writeFileSync(path, 'corrupted');
  expect((await s.render()).statusCode).toBe(409);
});

it('streams a successful PDF conversion using the rendered DOCX', async () => {
  const s = await setup();
  const convert = vi.spyOn(PdfConverter.prototype, 'convert').mockImplementation(async (docx) => {
    expect(indexDocx(docx).blocks.some((b) => b.text.includes('Иван Петров'))).toBe(true);
    return Buffer.from('%PDF-1.7\nfixture');
  });
  const response = await s.render({ versionId: s.published.versionId, format: 'pdf', values: s.values });
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toBe('application/pdf');
  expect(response.headers['content-disposition']).toBe('attachment; filename="document.pdf"');
  expect(response.body).toBe('%PDF-1.7\nfixture');
  expect(convert).toHaveBeenCalledOnce();
});
