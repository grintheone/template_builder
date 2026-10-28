import { expect, it } from 'vitest';
import { documentBlocksSchema, documentIdSchema } from './documents.js';

it('validates source index contracts and rejects unsafe document identifiers', () => {
  expect(documentIdSchema.safeParse('../originals/source.docx').success).toBe(false);
  expect(documentBlocksSchema.safeParse({ documentId: '123', sourceHash: 'bad', blocks: [], warnings: [] }).success).toBe(false);
  expect(documentBlocksSchema.parse({ documentId: 'd4ba38c4-738b-471e-9847-16b144fa0903', sourceHash: 'a'.repeat(64), blocks: [], warnings: [] }).blocks).toEqual([]);
});
