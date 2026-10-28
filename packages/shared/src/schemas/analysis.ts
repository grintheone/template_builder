import { z } from 'zod';
import { documentIdSchema } from './documents.js';
import { fieldKeySchema } from './render.js';

export const suggestedOccurrenceSchema = z.strictObject({
  blockId: z.string().min(1).max(256), quote: z.string().min(1).max(12000),
  contextBefore: z.string().max(1000).optional(), contextAfter: z.string().max(1000).optional(),
});
export const suggestedFieldSchema = z.strictObject({
  key: fieldKeySchema, label: z.string().trim().min(1).max(200),
  type: z.enum(['text', 'date', 'number', 'currency']), required: z.boolean(),
  confidence: z.number().min(0).max(1),
  occurrences: z.array(suggestedOccurrenceSchema).min(1).max(100),
});
export const detectorOutputSchema = z.strictObject({ fields: z.array(suggestedFieldSchema).max(100) });
export const resolvedOccurrenceSchema = suggestedOccurrenceSchema.extend({
  id: z.uuid(), status: z.enum(['resolved', 'unresolved']),
  reason: z.enum(['missing_block', 'unsupported_block', 'quote_not_found', 'ambiguous', 'context_mismatch', 'metadata_conflict']).optional(),
  start: z.number().int().nonnegative().optional(), end: z.number().int().positive().optional(),
}).superRefine((value, context) => {
  if (value.status === 'resolved' ? value.reason !== undefined || value.start === undefined || value.end === undefined || value.end <= value.start
    : value.reason === undefined || value.start !== undefined || value.end !== undefined) {
    context.addIssue({ code: 'custom', message: 'Invalid occurrence resolution' });
  }
});
export const analysisResultSchema = z.object({
  fields: z.array(suggestedFieldSchema.omit({ occurrences: true }).extend({ occurrences: z.array(resolvedOccurrenceSchema).min(1).max(1000) })).max(500),
  warnings: z.array(z.string().max(300)).max(502),
});
export const analysisErrorSchema = z.object({
  code: z.enum(['OLLAMA_OFFLINE', 'MODEL_UNAVAILABLE', 'INVALID_AI_OUTPUT', 'ANALYSIS_TIMEOUT', 'ANALYSIS_LIMIT', 'SOURCE_UNAVAILABLE', 'INTERRUPTED', 'ANALYSIS_FAILED']),
  message: z.string().min(1).max(300),
});
export const analysisJobSchema = z.object({
  jobId: z.uuid(), documentId: documentIdSchema, sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.string(), status: z.enum(['pending', 'running', 'done', 'failed']),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  result: analysisResultSchema.nullable(), error: analysisErrorSchema.nullable(),
}).superRefine((job, context) => {
  if (job.status === 'done' ? job.result === null || job.error !== null
    : job.status === 'failed' ? job.error === null || job.result !== null : job.result !== null || job.error !== null) {
    context.addIssue({ code: 'custom', message: 'Invalid job state' });
  }
});
export const analysisStartedSchema = z.object({ jobId: z.uuid() });
export type SuggestedField = z.infer<typeof suggestedFieldSchema>;
export type SuggestedOccurrence = z.infer<typeof suggestedOccurrenceSchema>;
export type ResolvedOccurrence = z.infer<typeof resolvedOccurrenceSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export type AnalysisJob = z.infer<typeof analysisJobSchema>;
export type AnalysisError = z.infer<typeof analysisErrorSchema>;
