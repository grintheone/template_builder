import { describe, expect, it } from 'vitest';
import { analysisJobSchema, detectorOutputSchema, resolvedOccurrenceSchema } from './analysis.js';

const field = { key: 'client_name', label: 'Client', type: 'text', required: true, confidence: 0.9, occurrences: [{ blockId: 'word/document.xml::p-0', quote: 'John' }] };
const occurrence = { ...field.occurrences[0], id: 'a0c36e22-b44e-4a13-9583-2d0d456d1e3d' };
describe('analysis contracts', () => {
  it('accepts exact candidate metadata and empty suggestions', () => {
    expect(detectorOutputSchema.safeParse({ fields: [field] }).success).toBe(true);
    expect(detectorOutputSchema.safeParse({ fields: [] }).success).toBe(true);
  });
  it.each([
    { ...field, key: 'Client Name' }, { ...field, confidence: 1.1 }, { ...field, confidence: -1 },
    { ...field, type: 'html' }, { ...field, occurrences: [] }, { ...field, rewrittenBody: 'replacement' },
    { ...field, occurrences: [{ blockId: 'one', quote: '' }] }, { ...field, key: 'constructor' },
  ])('rejects invalid or extra model content', (value) => {
    expect(detectorOutputSchema.safeParse({ fields: [value] }).success).toBe(false);
  });
  it('distinguishes evidence from verified locations', () => {
    expect(resolvedOccurrenceSchema.safeParse({ ...occurrence, status: 'resolved', start: 0, end: 4 }).success).toBe(true);
    expect(resolvedOccurrenceSchema.safeParse({ ...occurrence, status: 'resolved' }).success).toBe(false);
    expect(resolvedOccurrenceSchema.safeParse({ ...occurrence, status: 'unresolved', reason: 'ambiguous' }).success).toBe(true);
    expect(resolvedOccurrenceSchema.safeParse({ ...occurrence, status: 'unresolved', reason: 'ambiguous', start: 0, end: 4 }).success).toBe(false);
  });
  it('requires a result only for completed jobs and an error only for failed jobs', () => {
    const job = { jobId: occurrence.id, documentId: occurrence.id, sourceHash: 'a'.repeat(64), model: 'qwen3:8b', createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z', status: 'pending', result: null, error: null };
    expect(analysisJobSchema.safeParse(job).success).toBe(true);
    expect(analysisJobSchema.safeParse({ ...job, status: 'done' }).success).toBe(false);
    expect(analysisJobSchema.safeParse({ ...job, status: 'done', result: { fields: [], warnings: [] } }).success).toBe(true);
    expect(analysisJobSchema.safeParse({ ...job, status: 'failed' }).success).toBe(false);
    expect(analysisJobSchema.safeParse({ ...job, status: 'failed', error: { code: 'INTERRUPTED', message: 'Retry' } }).success).toBe(true);
  });
});
