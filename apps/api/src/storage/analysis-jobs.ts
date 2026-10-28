import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { analysisJobSchema, analysisResultSchema, type AnalysisJob } from '@studio/shared';
import type { AppConfig } from '../config.js';
import { openDatabase } from '../db/index.js';
import { analysisJobs } from '../db/schema.js';
import { AnalysisFailure } from '../services/ai/errors.js';
import type { FieldDetector } from '../services/ai/field-detector.js';
import { DocumentStore } from './documents.js';

export class AnalysisQueueFull extends Error {}
export class AnalysisJobs {
  private database;
  private documents;
  private queue: string[] = [];
  private worker: Promise<void> | undefined;
  private controller: AbortController | undefined;
  private closed = false;
  private admissions = 0;
  constructor(private config: AppConfig, private detector: FieldDetector, maxUploadBytes: number) {
    this.database = openDatabase(config);
    this.documents = new DocumentStore(config, maxUploadBytes);
    this.database.db.update(analysisJobs).set({
      status: 'failed', updatedAt: new Date().toISOString(), resultJson: null,
      errorJson: JSON.stringify(new AnalysisFailure('INTERRUPTED').toJSON()),
    }).where(inArray(analysisJobs.status, ['pending', 'running'])).run();
  }
  async start(documentId: string): Promise<string | undefined> {
    if (this.closed || this.queue.length + this.admissions >= 8) throw new AnalysisQueueFull();
    this.admissions++;
    try { return await this.admit(documentId); }
    finally { this.admissions--; }
  }
  private async admit(documentId: string): Promise<string | undefined> {
    let source: Awaited<ReturnType<DocumentStore['blocks']>>;
    try { source = await this.documents.blocks(documentId); }
    catch { throw new AnalysisFailure('SOURCE_UNAVAILABLE'); }
    if (!source) return undefined;
    if (this.closed) throw new AnalysisQueueFull();
    const active = this.database.db.select().from(analysisJobs)
      .where(inArray(analysisJobs.status, ['pending', 'running'])).all().find((job) => job.documentId === documentId);
    if (active) return active.id;
    const jobId = randomUUID();
    const now = new Date().toISOString();
    this.database.db.insert(analysisJobs).values({ id: jobId, documentId, sourceHash: source.sourceHash, model: this.config.OLLAMA_MODEL, status: 'pending', createdAt: now, updatedAt: now }).run();
    this.queue.push(jobId);
    this.kick();
    return jobId;
  }
  get(jobId: string): AnalysisJob | undefined {
    const row = this.database.db.select().from(analysisJobs).where(eq(analysisJobs.id, jobId)).get();
    if (!row) return undefined;
    return analysisJobSchema.parse({ jobId: row.id, documentId: row.documentId, sourceHash: row.sourceHash, model: row.model, status: row.status,
      createdAt: row.createdAt, updatedAt: row.updatedAt, result: row.resultJson ? JSON.parse(row.resultJson) : null, error: row.errorJson ? JSON.parse(row.errorJson) : null });
  }
  private kick() {
    if (this.worker || this.closed) return;
    // Defer work until after the accepted response, preserving an observable pending state.
    this.worker = new Promise<void>((resolve) => setImmediate(resolve)).then(() => this.drain()).finally(() => {
      this.worker = undefined;
      if (this.queue.length && !this.closed) this.kick();
    });
  }
  private async drain() {
    while (this.queue.length && !this.closed) {
      const id = this.queue.shift();
      if (!id) break;
      const job = this.get(id);
      if (!job) continue;
      this.database.db.update(analysisJobs).set({ status: 'running', updatedAt: new Date().toISOString() }).where(eq(analysisJobs.id, id)).run();
      const controller = new AbortController();
      this.controller = controller;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      try {
        const interrupted = new Promise<never>((_, reject) => {
          onAbort = () => reject(new AnalysisFailure(this.closed ? 'INTERRUPTED' : 'ANALYSIS_TIMEOUT'));
          controller.signal.addEventListener('abort', onAbort, { once: true });
          timer = setTimeout(() => controller.abort(), this.config.ANALYSIS_TIMEOUT_MS);
        });
        const operation = async () => {
          let source: Awaited<ReturnType<DocumentStore['blocks']>>;
          try { source = await this.documents.blocks(job.documentId); }
          catch { throw new AnalysisFailure('SOURCE_UNAVAILABLE'); }
          controller.signal.throwIfAborted();
          if (!source || source.sourceHash !== job.sourceHash) throw new AnalysisFailure('SOURCE_UNAVAILABLE');
          return this.detector.detect(source.blocks, controller.signal);
        };
        const result = analysisResultSchema.parse(await Promise.race([operation(), interrupted]));
        this.database.db.update(analysisJobs).set({ status: 'done', resultJson: JSON.stringify(result), updatedAt: new Date().toISOString() }).where(eq(analysisJobs.id, id)).run();
      } catch (error) {
        const failure = error instanceof AnalysisFailure ? error : new AnalysisFailure('ANALYSIS_FAILED');
        this.database.db.update(analysisJobs).set({ status: 'failed', errorJson: JSON.stringify(failure.toJSON()), updatedAt: new Date().toISOString() }).where(eq(analysisJobs.id, id)).run();
      } finally {
        clearTimeout(timer);
        if (onAbort) controller.signal.removeEventListener('abort', onAbort);
        this.controller = undefined;
      }
    }
  }
  async close() {
    this.closed = true;
    this.controller?.abort();
    await this.worker;
    this.database.db.update(analysisJobs).set({ status: 'failed', errorJson: JSON.stringify(new AnalysisFailure('INTERRUPTED').toJSON()), updatedAt: new Date().toISOString() })
      .where(inArray(analysisJobs.status, ['pending', 'running'])).run();
    this.documents.close();
    this.database.close();
  }
}
