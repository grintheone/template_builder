import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import PizZip from 'pizzip';
import { expect, it, vi } from 'vitest';
import { analysisJobSchema, documentBlocksSchema, publishedVersionSchema, type SuggestedField } from '@studio/shared';
import { buildApp } from '../app.js';
import { readConfig } from '../config.js';
import { OllamaFieldDetector } from '../services/ai/field-detector.js';
import { indexDocx } from '../services/docx/indexer.js';
import { createStarterFixture, starterFields } from './starter-fixture.js';

it('uploads → detects with mocked Ollama → reviews → publishes → fills → renders after restart with Ollama offline', async () => {
  const base = readConfig({});
  await mkdir(base.STORAGE_DIR, { recursive: true });
  const directory = await mkdtemp(resolve(base.STORAGE_DIR, 'workflow-test-'));
  const config = { ...base, DATABASE_PATH: resolve(directory, 'app.sqlite'), STORAGE_DIR: resolve(directory, 'files') };
  const source = createStarterFixture();
  const sourceHash = createHash('sha256').update(source).digest('hex');
  const chat = vi.fn(async () => {
    const blocks = indexDocx(source).blocks;
    const fields: SuggestedField[] = starterFields.map((field) => ({
      key: field.key, label: field.label, type: field.type, required: true, confidence: 0.95,
      occurrences: blocks.filter((b) => b.text.includes(field.quote) && !b.text.includes('unrelated reference')).map((b) => ({ blockId: b.id, quote: field.quote })),
    }));
    // A hallucinated source quote must survive as unresolved, then be rejected.
    fields.push({ key: 'invented', label: 'Invented', type: 'text', required: false, confidence: 0.1, occurrences: [{ blockId: blocks[0]?.id ?? '', quote: 'Never present' }] });
    return { message: { content: JSON.stringify({ fields }) } };
  });
  let app = buildApp(config, undefined, new OllamaFieldDetector(config, () => ({ chat })));
  try {
    const upload = await app.inject({ method: 'POST', url: '/api/documents', headers: { 'content-type': 'multipart/form-data; boundary=workflow' }, payload: Buffer.concat([
      Buffer.from('--workflow\r\nContent-Disposition: form-data; name="document"; filename="agreement.docx"\r\nContent-Type: application/octet-stream\r\n\r\n'), source, Buffer.from('\r\n--workflow--\r\n'),
    ]) });
    expect(upload.statusCode).toBe(201);
    expect(upload.json().sourceHash).toBe(sourceHash);
    const documentId = upload.json().documentId;
    const url = `/api/documents/${documentId}`;
    const indexed = documentBlocksSchema.parse((await app.inject(`${url}/blocks`)).json());
    expect(indexed.blocks.every((b) => b.supported)).toBe(true);
    const start = await app.inject({ method: 'POST', url: `${url}/analyze` });
    expect(start.statusCode).toBe(202);
    const jobId = start.json().jobId;
    await vi.waitFor(async () => expect((await app.inject(`/api/analysis-jobs/${jobId}`)).json().status).toBe('done'), { timeout: 3000, interval: 10 });
    const job = analysisJobSchema.parse((await app.inject(`/api/analysis-jobs/${jobId}`)).json());
    expect(chat).toHaveBeenCalledTimes(1);
    const fields = [];
    const decisions = [];
    for (const suggestion of job.result?.fields ?? []) {
      const metadata = starterFields.find((f) => f.key === suggestion.key);
      if (!metadata) {
        expect(suggestion.occurrences[0]?.status).toBe('unresolved');
        decisions.push(...suggestion.occurrences.map((o) => ({ occurrenceId: o.id, status: 'rejected' as const })));
        continue;
      }
      const occurrences = suggestion.occurrences.map((o) => {
        expect(o.status).toBe('resolved');
        const id = randomUUID();
        decisions.push({ occurrenceId: o.id, status: 'accepted' as const, approvedOccurrenceId: id });
        return { id, blockId: o.blockId, quote: o.quote, start: o.start, end: o.end, provenance: { analysisJobId: jobId, occurrenceId: o.id } };
      });
      expect(occurrences).toHaveLength(metadata.count);
      fields.push({ id: randomUUID(), key: metadata.key, label: metadata.label, type: metadata.type, required: true, formatting: metadata.formatting, occurrences });
    }
    expect(fields).toHaveLength(6);
    const saved = await app.inject({ method: 'PUT', url: `${url}/fields`, payload: { sourceHash, expectedRevision: 0, analysisJobId: jobId, fields, decisions } });
    expect(saved.statusCode).toBe(200);
    const publication = await app.inject({ method: 'POST', url: `${url}/publish`, payload: { sourceHash, reviewRevision: 1 } });
    expect(publication.statusCode).toBe(200);
    const published = publishedVersionSchema.parse(publication.json());
    await app.close();
    const offline = { detect: vi.fn(async () => { throw new Error('Ollama is offline'); }) };
    app = buildApp(config, undefined, offline);
    const library = await app.inject('/api/templates');
    expect(library.json()).toHaveLength(1);
    const detail = (await app.inject(`/api/templates/${published.templateId}`)).json();
    expect(detail.fields).toHaveLength(6); expect(JSON.stringify(detail)).not.toContain('quote');
    const render = (values: Record<string, unknown>) => app.inject({ method: 'POST', url: `/api/templates/${published.templateId}/render`, payload: { versionId: published.versionId, format: 'docx', values } });
    expect((await render({})).statusCode).toBe(422);
    const values = { employer: 'Example & Co', employee_name: 'Иван Петров 李 😀', agreement_date: '2026-11-01', start_date: '2026-12-01', salary: 6500.5, hours: 32 };
    expect((await render({ ...values, unexpected: 'private' })).statusCode).toBe(422);
    const output = await render(values);
    expect(output.statusCode).toBe(200);
    expect(output.headers['content-disposition']).toBe('attachment; filename="document.docx"');
    expect(output.headers['cache-control']).toBe('no-store');
    const texts = indexDocx(output.rawPayload).blocks.map((b) => b.text);
    expect(texts).toContain('This agreement is made between Example & Co and Иван Петров 李 😀 on 2026-11-01.');
    expect(texts).toContain('Иван Петров 李 😀 will commence employment on 2026-12-01.');
    expect(texts).toContain('The monthly salary is $6,500.50.');
    expect(texts).toContain('Working hours per week: 32.');
    expect(texts).toContain('Example & Co · Employment agreement');
    expect(texts).toContain('Prepared for Иван Петров 李 😀');
    expect(texts).toContain('John Smith is also the author of an unrelated reference; leave this sentence unchanged.');
    expect(texts.join('')).not.toContain('[[');
    const original = new PizZip(source); const result = new PizZip(output.rawPayload);
    for (const path of Object.keys(original.files).filter((p) => !/^word\/(document|header1|footer1)\.xml$/.test(p)))
      expect(result.file(path)?.asNodeBuffer()).toEqual(original.file(path)?.asNodeBuffer());
    const retained = await readFile(resolve(config.STORAGE_DIR, 'originals', `${documentId}.docx`));
    expect(retained).toEqual(source); expect(createHash('sha256').update(retained).digest('hex')).toBe(sourceHash);
    expect(offline.detect).not.toHaveBeenCalled();
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
