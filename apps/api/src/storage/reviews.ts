import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, eq, desc } from 'drizzle-orm';
import { analysisJobSchema, reviewSnapshotSchema, saveReviewSchema, publishedVersionSchema, type SaveReview, type ReviewSnapshot } from '@studio/shared';
import type { AppConfig } from '../config.js';
import { localDataPath } from '../config.js';
import { openDatabase } from '../db/index.js';
import { documentReviews, templates, templateVersions, analysisJobs } from '../db/schema.js';
import { DocumentStore } from './documents.js';
import { TemplateCompiler, hashSource } from '../services/docx/compiler.js';
import { ReviewFailure } from '../services/templates/errors.js';

const conflict = () => new ReviewFailure('CONFLICT', 409, 'The source or review changed. Reload the saved review before retrying.');
export class ReviewStore {
  private database;
  private documents;
  private compiler;
  constructor(private config: AppConfig, maxBytes: number) {
    this.database = openDatabase(config); this.documents = new DocumentStore(config, maxBytes); this.compiler = new TemplateCompiler(maxBytes);
  }
  close() { this.documents.close(); this.database.close(); }
  private async source(documentId: string) {
    try {
      const source = await this.documents.source(documentId);
      if (!source) throw new ReviewFailure('NOT_FOUND', 404, 'The source document was not found.');
      return source;
    } catch (e) { if (e instanceof ReviewFailure) throw e; throw conflict(); }
  }
  private saved(documentId: string) {
    const row = this.database.db.select().from(documentReviews).where(eq(documentReviews.documentId, documentId)).get();
    return row ? reviewSnapshotSchema.parse(JSON.parse(row.snapshotJson)) : undefined;
  }
  async get(documentId: string): Promise<ReviewSnapshot> {
    const source = await this.source(documentId);
    return this.saved(documentId) ?? { documentId, sourceHash: source.sourceHash, revision: 0, fields: [], decisions: [] };
  }
  private provenance(snapshot: SaveReview | ReviewSnapshot, documentId: string, previous?: ReviewSnapshot) {
    const invalid = () => new ReviewFailure('INVALID_SELECTION', 422, 'Suggestion provenance or decisions are invalid. Use a completed analysis for this document.');
    const occurrences = snapshot.fields.flatMap((f) => f.occurrences);
    const decisions = new Map(snapshot.decisions.map((d) => [d.occurrenceId, d]));
    if (previous?.analysisJobId && snapshot.analysisJobId !== previous.analysisJobId) throw invalid();
    if (previous) for (const decision of previous.decisions) if (!decisions.has(decision.occurrenceId)) throw invalid();
    if (!snapshot.analysisJobId) { if (occurrences.some((o) => o.provenance)) throw invalid(); return; }
    const row = this.database.db.select().from(analysisJobs).where(eq(analysisJobs.id, snapshot.analysisJobId)).get();
    if (!row) throw new ReviewFailure('NOT_FOUND', 404, 'The referenced analysis job was not found.');
    const job = analysisJobSchema.parse({ jobId: row.id, documentId: row.documentId, sourceHash: row.sourceHash, model: row.model, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt, result: row.resultJson ? JSON.parse(row.resultJson) : null, error: row.errorJson ? JSON.parse(row.errorJson) : null });
    if (!job.result || job.status !== 'done' || job.documentId !== documentId || job.sourceHash !== snapshot.sourceHash) throw invalid();
    const suggested = new Map(job.result.fields.flatMap((f) => f.occurrences).map((o) => [o.id, o]));
    const linked = new Set<string>();
    for (const occurrence of occurrences) if (occurrence.provenance) {
      const p = occurrence.provenance; const suggestion = suggested.get(p.occurrenceId); const decision = decisions.get(p.occurrenceId);
      if (p.analysisJobId !== snapshot.analysisJobId || !suggestion || linked.has(p.occurrenceId) || suggestion.blockId !== occurrence.blockId || suggestion.quote !== occurrence.quote || suggestion.status !== 'resolved' || suggestion.start !== occurrence.start || suggestion.end !== occurrence.end || decision?.status !== 'accepted' || decision.approvedOccurrenceId !== occurrence.id) throw invalid();
      linked.add(p.occurrenceId);
    }
    for (const decision of snapshot.decisions) if (!suggested.has(decision.occurrenceId) || (decision.status === 'accepted' && !linked.has(decision.occurrenceId))) throw invalid();
    if (previous) for (const old of previous.fields.flatMap((f) => f.occurrences)) if (old.provenance && !occurrences.some((o) => o.id === old.id && JSON.stringify(o.provenance) === JSON.stringify(old.provenance)) && decisions.get(old.provenance.occurrenceId)?.status !== 'rejected') throw invalid();
  }
  async save(documentId: string, input: SaveReview) {
    const parsed = saveReviewSchema.safeParse(input);
    if (!parsed.success) throw new ReviewFailure('INVALID_REQUEST', 400, 'Invalid review snapshot. Check keys, defaults, formatting and identities.');
    input = parsed.data;
    const source = await this.source(documentId);
    if (source.sourceHash !== input.sourceHash) throw conflict();
    await this.compiler.validate(source.source, input.sourceHash, input.fields);
    return this.database.db.transaction((tx) => {
      const previous = this.saved(documentId);
      if ((previous?.revision ?? 0) !== input.expectedRevision) throw conflict();
      this.provenance(input, documentId, previous);
      const { expectedRevision, ...selection } = input;
      const snapshot = reviewSnapshotSchema.parse({ ...selection, documentId, revision: expectedRevision + 1 });
      const now = new Date().toISOString();
      if (previous) tx.update(documentReviews).set({ revision: snapshot.revision, snapshotJson: JSON.stringify(snapshot), updatedAt: now }).where(and(eq(documentReviews.documentId, documentId), eq(documentReviews.revision, expectedRevision))).run();
      else tx.insert(documentReviews).values({ documentId, revision: snapshot.revision, sourceHash: input.sourceHash, snapshotJson: JSON.stringify(snapshot), createdAt: now, updatedAt: now }).run();
      return snapshot;
    }, { behavior: 'immediate' });
  }
  private version(documentId: string, revision: number) {
    const row = this.database.db.select().from(templateVersions).where(and(eq(templateVersions.documentId, documentId), eq(templateVersions.reviewRevision, revision))).get();
    return row ? publishedVersionSchema.parse({ templateId: row.templateId, versionId: row.id, versionNumber: row.versionNumber, reviewRevision: row.reviewRevision, sourceHash: row.sourceHash, createdAt: row.createdAt, fields: JSON.parse(row.schemaJson) }) : undefined;
  }
  async publish(documentId: string, sourceHash: string, revision: number) {
    const source = await this.source(documentId);
    const review = this.saved(documentId);
    if (source.sourceHash !== sourceHash || !review || review.revision !== revision || review.sourceHash !== sourceHash) throw conflict();
    this.provenance(review, documentId);
    await this.compiler.validate(source.source, sourceHash, review.fields);
    const existing = this.version(documentId, revision);
    if (existing) return existing;
    const compiled = await this.compiler.compile(source.source, sourceHash, review.fields);
    const id = randomUUID(); const directory = localDataPath(resolve(this.config.STORAGE_DIR, 'templates'));
    const path = localDataPath(resolve(directory, `${id}.docx`));
    let written = false;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(path, compiled, { flag: 'wx', mode: 0o400 }); written = true;
      const result = this.database.db.transaction((tx) => {
        if (this.saved(documentId)?.revision !== revision) throw conflict();
        const winner = this.version(documentId, revision);
        if (winner) return { version: winner, ownsFile: false };
        let template = tx.select().from(templates).where(eq(templates.documentId, documentId)).get();
        if (!template) { template = { id: randomUUID(), documentId }; tx.insert(templates).values(template).run(); }
        const latest = tx.select().from(templateVersions).where(eq(templateVersions.templateId, template.id)).orderBy(desc(templateVersions.versionNumber)).get();
        const createdAt = new Date().toISOString(); const versionNumber = (latest?.versionNumber ?? 0) + 1;
        tx.insert(templateVersions).values({ id, templateId: template.id, documentId, versionNumber, reviewRevision: revision, sourceHash, compiledHash: hashSource(compiled), compiledPath: path, schemaJson: JSON.stringify(review.fields), createdAt }).run();
        return { version: publishedVersionSchema.parse({ templateId: template.id, versionId: id, versionNumber, reviewRevision: revision, sourceHash, createdAt, fields: review.fields }), ownsFile: true };
      }, { behavior: 'immediate' });
      if (!result.ownsFile) await unlink(path);
      return result.version;
    } catch (e) {
      if (written) await unlink(path).catch(() => {});
      if (e instanceof ReviewFailure) throw e;
      throw new ReviewFailure('PUBLICATION_FAILED', 500, 'The template could not be saved. Check local storage and retry.');
    }
  }
  // Only UUID-named unpublished compiler files older than a day; never originals.
  // The grace period protects files awaiting commit in another process.
  async cleanupOrphans() {
    const directory = localDataPath(resolve(this.config.STORAGE_DIR, 'templates'));
    const referenced = new Set(this.database.db.select().from(templateVersions).all().map((v) => v.compiledPath));
    const names = await readdir(directory).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return []; throw e; });
    for (const name of names) if (/^[a-f0-9-]{36}\.docx$/.test(name)) {
      const path = localDataPath(resolve(directory, name));
      if (!referenced.has(path) && Date.now() - (await stat(path)).mtimeMs > 86400000) await unlink(path);
    }
  }
}
