import { z } from 'zod';
import { fieldKeySchema, isXmlText } from './render.js';

export const sourceHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const approvedOccurrenceSchema = z.strictObject({
  id: z.uuid(), blockId: z.string().min(1).max(256), quote: z.string().min(1).max(12000).refine(isXmlText),
  start: z.number().int().nonnegative(), end: z.number().int().positive(),
  provenance: z.strictObject({ analysisJobId: z.uuid(), occurrenceId: z.uuid() }).optional(),
}).refine((o) => o.end > o.start && o.end - o.start === o.quote.length);
const locale = z.string().max(80).refine((value) => { try { return Intl.NumberFormat.supportedLocalesOf([value]).length === 1; } catch { return false; } });
export const formFieldSchema = z.strictObject({
  id: z.uuid(), key: fieldKeySchema, label: z.string().trim().min(1).max(200).refine(isXmlText),
  type: z.enum(['text', 'date', 'number', 'currency']), required: z.boolean(),
  default: z.union([z.string().max(10000).refine(isXmlText), z.number().finite()]).optional(),
  formatting: z.strictObject({ dateFormat: z.literal('YYYY-MM-DD').optional(), locale: locale.optional(), currency: z.string().regex(/^[A-Z]{3}$/).refine((v) => Intl.supportedValuesOf('currency').includes(v)).optional(), precision: z.number().int().min(0).max(6).optional() }),
}).superRefine((field, ctx) => {
  const f = field.formatting;
  const validFormat = field.type === 'text' ? Object.keys(f).length === 0 : field.type === 'date' ? f.dateFormat === 'YYYY-MM-DD' && Object.keys(f).length === 1
    : !!f.locale && f.dateFormat === undefined && (field.type === 'currency' ? !!f.currency : f.currency === undefined);
  const d = field.default;
  const validDefault = d === undefined || (field.type === 'text' ? typeof d === 'string' : field.type === 'date' ? typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d : typeof d === 'number');
  if (!validFormat || !validDefault) ctx.addIssue({ code: 'custom', message: 'Default or formatting does not match field type.' });
});
export const reviewedFieldSchema = formFieldSchema.safeExtend({ occurrences: z.array(approvedOccurrenceSchema).min(1).max(2000) });
export const suggestionDecisionSchema = z.discriminatedUnion('status', [
  z.strictObject({ occurrenceId: z.uuid(), status: z.literal('accepted'), approvedOccurrenceId: z.uuid() }),
  z.strictObject({ occurrenceId: z.uuid(), status: z.literal('rejected') }),
]);
export const reviewSelectionSchema = z.strictObject({
  sourceHash: sourceHashSchema, analysisJobId: z.uuid().optional(),
  fields: z.array(reviewedFieldSchema).max(100), decisions: z.array(suggestionDecisionSchema).max(5000),
}).superRefine((s, ctx) => {
  const unique = (values: string[]) => new Set(values).size === values.length;
  const occurrences = s.fields.flatMap((f) => f.occurrences);
  if (occurrences.length > 2000 || !unique(s.fields.map((f) => f.key)) || !unique([...s.fields.map((f) => f.id), ...occurrences.map((o) => o.id)]) || !unique(s.decisions.map((d) => d.occurrenceId)) || (s.decisions.length > 0 && !s.analysisJobId)) ctx.addIssue({ code: 'custom', message: 'Duplicate identities, keys, missing job or selection limit exceeded.' });
});
export const saveReviewSchema = reviewSelectionSchema.safeExtend({ expectedRevision: z.number().int().nonnegative() });
export const reviewSnapshotSchema = reviewSelectionSchema.safeExtend({ documentId: z.uuid(), revision: z.number().int().nonnegative() });
export const publishRequestSchema = z.strictObject({ sourceHash: sourceHashSchema, reviewRevision: z.number().int().positive() });
export const publishedVersionSchema = z.strictObject({ templateId: z.uuid(), versionId: z.uuid(), versionNumber: z.number().int().positive(), reviewRevision: z.number().int().positive(), sourceHash: sourceHashSchema, createdAt: z.iso.datetime(), fields: z.array(reviewedFieldSchema).min(1).max(100) });
export const reviewErrorSchema = z.strictObject({ code: z.enum(['INVALID_REQUEST', 'NOT_FOUND', 'CONFLICT', 'INVALID_SELECTION', 'UNSAFE_SPAN', 'INVALID_TEMPLATE', 'PUBLICATION_FAILED']), message: z.string().max(300), issues: z.array(z.strictObject({ code: z.string().max(80), fieldId: z.uuid().optional(), occurrenceId: z.uuid().optional() })).max(100) });
export type ReviewedField = z.infer<typeof reviewedFieldSchema>;
export type ApprovedOccurrence = z.infer<typeof approvedOccurrenceSchema>;
export type ReviewSnapshot = z.infer<typeof reviewSnapshotSchema>;
export type SaveReview = z.infer<typeof saveReviewSchema>;
export type PublishedVersion = z.infer<typeof publishedVersionSchema>;
