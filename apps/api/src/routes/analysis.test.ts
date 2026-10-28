import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analysisJobSchema, type AnalysisJob } from '@studio/shared';
import { buildApp } from '../app.js';
import { readConfig } from '../config.js';
import { openDatabase } from '../db/index.js';
import { analysisJobs } from '../db/schema.js';
import { DocumentStore } from '../storage/documents.js';
import { createDocxFixture, paragraph } from '../testing/docx-fixture.js';
import { OllamaFieldDetector, type FieldDetector } from '../services/ai/field-detector.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function setup(detector?: FieldDetector, timeout = 10000) {
  const base = readConfig({});
  mkdirSync(base.STORAGE_DIR, { recursive: true });
  const directory = mkdtempSync(resolve(base.STORAGE_DIR, 'analysis-test-'));
  const config = { ...base, ANALYSIS_TIMEOUT_MS: timeout, DATABASE_PATH: resolve(directory, 'app.sqlite'), STORAGE_DIR: resolve(directory, 'files') };
  const documents = new DocumentStore(config, 15 * 1024 * 1024);
  const source = createDocxFixture({ body: paragraph('John Smith and John Smith') });
  const imported = await documents.import(source);
  documents.close();
  const app = buildApp(config, undefined, detector);
  cleanup.push(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  return { app, config, source, ...imported };
}
async function poll(app: ReturnType<typeof buildApp>, jobId: string) {
  let job: AnalysisJob | undefined;
  await vi.waitFor(async () => {
    const response = await app.inject(`/api/analysis-jobs/${jobId}`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    job = analysisJobSchema.parse(response.json());
    expect(['done', 'failed']).toContain(job.status);
  }, { timeout: 3000, interval: 10 });
  if (!job) throw new Error('No job returned');
  return job;
}
const never: FieldDetector = { detect: async () => new Promise(() => {}) };

describe('durable analysis jobs API', () => {
  it('returns accepted then persists exact suggestions, source hash and immutable bytes across restart', async () => {
    const base = readConfig({});
    const client = { chat: vi.fn(async (request) => {
      const blocks = JSON.parse(request.messages[1].content).untrustedDocumentBlocks;
      return { message: { content: JSON.stringify({ fields: [{ key: 'employee_name', label: 'Employee', type: 'text', required: true, confidence: 0.95,
        occurrences: [{ blockId: blocks[0].blockId, quote: 'John Smith', contextBefore: '', contextAfter: ' and John Smith' }] }] }) } };
    }) };
    const detector = new OllamaFieldDetector(base, () => client);
    const { app, documentId, sourceHash, source, config } = await setup(detector);
    const response = await app.inject({ method: 'POST', url: `/api/documents/${documentId}/analyze` });
    expect(response.statusCode).toBe(202);
    const { jobId } = response.json();
    expect(response.headers.location).toBe(`/api/analysis-jobs/${jobId}`);
    const job = await poll(app, jobId);
    expect(job).toMatchObject({ status: 'done', documentId, sourceHash, model: base.OLLAMA_MODEL, error: null });
    expect(job.result?.fields[0]?.occurrences[0]).toMatchObject({ status: 'resolved', start: 0, end: 10 });
    expect(readFileSync(resolve(config.STORAGE_DIR, 'originals', `${documentId}.docx`))).toEqual(source);
    await app.close();
    const restarted = buildApp(config, undefined, never);
    try { expect((await restarted.inject(`/api/analysis-jobs/${jobId}`)).json()).toEqual(job); }
    finally { await restarted.close(); }
  });
  it('deduplicates active requests and cancels in-flight work on shutdown', async () => {
    const { app, documentId, config } = await setup(never);
    const start = () => app.inject({ method: 'POST', url: `/api/documents/${documentId}/analyze` });
    const first = await start();
    expect((await start()).json()).toEqual(first.json());
    await vi.waitFor(async () => expect((await app.inject(`/api/analysis-jobs/${first.json().jobId}`)).json().status).toBe('running'));
    await app.close();
    const restarted = buildApp(config);
    try {
      const result = (await restarted.inject(`/api/analysis-jobs/${first.json().jobId}`)).json();
      expect(result).toMatchObject({ status: 'failed', error: { code: 'INTERRUPTED' } });
    } finally { await restarted.close(); }
  });
  it('marks both pending and running records failed at startup without replaying source data', async () => {
    const { app, config, documentId, sourceHash } = await setup(never);
    await app.ready(); await app.close();
    const database = openDatabase(config);
    const ids = [randomUUID(), randomUUID()];
    ids.forEach((id, index) => { database.db.insert(analysisJobs).values({ id, documentId, sourceHash, model: config.OLLAMA_MODEL, status: index ? 'running' : 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).run(); });
    database.close();
    const detector = { detect: vi.fn() };
    const restarted = buildApp(config, undefined, detector);
    try {
      for (const id of ids) expect((await restarted.inject(`/api/analysis-jobs/${id}`)).json()).toMatchObject({ status: 'failed', error: { code: 'INTERRUPTED' } });
      expect(detector.detect).not.toHaveBeenCalled();
    } finally { await restarted.close(); }
  });
  it('times out, aborts the client and continues processing later jobs', async () => {
    let aborted = false;
    const detector: FieldDetector = { detect: vi.fn().mockImplementationOnce(async (_blocks, signal: AbortSignal) => {
      signal.addEventListener('abort', () => { aborted = true; });
      return new Promise(() => {});
    }).mockResolvedValue({ fields: [], warnings: [] }) };
    const { app, documentId } = await setup(detector, 50);
    const first = (await app.inject({ method: 'POST', url: `/api/documents/${documentId}/analyze` })).json().jobId;
    expect(await poll(app, first)).toMatchObject({ status: 'failed', result: null, error: { code: 'ANALYSIS_TIMEOUT' } });
    expect(aborted).toBe(true);
    const second = (await app.inject({ method: 'POST', url: `/api/documents/${documentId}/analyze` })).json().jobId;
    expect(second).not.toBe(first);
    expect(await poll(app, second)).toMatchObject({ status: 'done' });
  });
  it('reports offline and missing models without leaking client errors', async () => {
    const base = readConfig({});
    const detector = new OllamaFieldDetector(base, () => ({ chat: async () => { throw new Error('sensitive document contents'); } }));
    const { app, documentId } = await setup(detector);
    const response = await app.inject({ method: 'POST', url: `/api/documents/${documentId}/analyze` });
    const job = await poll(app, response.json().jobId);
    expect(job).toMatchObject({ status: 'failed', error: { code: 'OLLAMA_OFFLINE' } });
    expect(JSON.stringify(job)).not.toContain('sensitive');
  });
  it('rejects invalid and missing IDs and unexpected analysis bodies', async () => {
    const { app, documentId } = await setup(never);
    expect((await app.inject('/api/analysis-jobs/bad')).statusCode).toBe(400);
    expect((await app.inject(`/api/analysis-jobs/${randomUUID()}`)).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/documents/bad/analyze' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/documents/${randomUUID()}/analyze` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/documents/${documentId}/analyze`, payload: { model: 'remote' } })).statusCode).toBe(400);
  });
  it('bounds the queue to eight pending jobs and runs only one detector at a time', async () => {
    const detector = { detect: vi.fn(never.detect) };
    const { app, config, documentId } = await setup(detector);
    await app.inject({ method: 'POST', url: `/api/documents/${documentId}/analyze` });
    await vi.waitFor(() => expect(detector.detect).toHaveBeenCalledTimes(1));
    const store = new DocumentStore(config, 15 * 1024 * 1024);
    try {
      for (let index = 0; index < 9; index++) {
        const { documentId: id } = await store.import(createDocxFixture());
        const result = await app.inject({ method: 'POST', url: `/api/documents/${id}/analyze` });
        expect(result.statusCode).toBe(index < 8 ? 202 : 429);
      }
    } finally { store.close(); }
    expect(detector.detect).toHaveBeenCalledTimes(1);
  });
});
