import { expect, it } from 'vitest';
import { saveReviewSchema, reviewedFieldSchema } from './review.js';
const field = { id: '123e4567-e89b-42d3-a456-426614174000', key: 'client_name', label: 'Client', type: 'text', required: true, formatting: {}, occurrences: [{ id: '123e4567-e89b-42d3-a456-426614174001', blockId: 'p', quote: 'Alex', start: 0, end: 4 }] };
it('validates type-specific defaults and explicit formatting', () => {
  expect(reviewedFieldSchema.safeParse(field).success).toBe(true);
  for (const patch of [{ key: 'constructor' }, { key: 'Client Name' }, { default: 4 }, { formatting: { locale: 'bad_locale' } }, { type: 'date', default: '2026-02-30', formatting: { dateFormat: 'YYYY-MM-DD' } }, { type: 'currency', default: 12, formatting: { locale: 'en-US', currency: 'ZZZ' } }]) expect(reviewedFieldSchema.safeParse({ ...field, ...patch }).success).toBe(false);
  for (const patch of [{ type: 'date', default: '2028-02-29', formatting: { dateFormat: 'YYYY-MM-DD' } }, { type: 'currency', default: 12.5, formatting: { locale: 'en-US', currency: 'USD', precision: 2 } }, { type: 'number', default: 0, formatting: { locale: 'de-DE', precision: 6 } }]) expect(reviewedFieldSchema.safeParse({ ...field, ...patch }).success).toBe(true);
});
it('rejects duplicate keys/IDs and unexpected properties', () => {
  const review = { sourceHash: 'a'.repeat(64), expectedRevision: 0, fields: [field], decisions: [] };
  expect(saveReviewSchema.safeParse(review).success).toBe(true);
  expect(saveReviewSchema.safeParse({ ...review, fields: [field, field] }).success).toBe(false);
  expect(saveReviewSchema.safeParse({ ...review, approved: true }).success).toBe(false);
});
