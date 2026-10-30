import { z } from 'zod';
import { formFieldSchema, publishedVersionSchema, type ReviewedField } from './review.js';
import { isXmlText } from './render.js';

// Public forms contain metadata only; source quotes and disk paths are never needed.
export type FormField = z.infer<typeof formFieldSchema>;
export const templateDetailSchema = publishedVersionSchema.omit({ fields: true }).extend({ title: z.string(), fields: z.array(formFieldSchema).min(1).max(100) });
export type TemplateDetail = z.infer<typeof templateDetailSchema>;
export const templateLibrarySchema = z.array(templateDetailSchema);
export const templateRenderRequestSchema = z.strictObject({ versionId: z.uuid(), format: z.enum(['docx', 'pdf']), values: z.record(z.string(), z.unknown()) });
export const exportErrorSchema = z.object({ code: z.string(), message: z.string() });

export function createFormValuesSchema(fields: readonly (FormField | ReviewedField)[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    let value: z.ZodType;
    if (field.type === 'text') value = z.string().max(10000, 'Use at most 10,000 characters.').refine(isXmlText, 'Use valid document text.').refine((v) => !field.required || v.trim().length > 0, 'This field is required.');
    else if (field.type === 'date') value = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD.').refine((v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Enter a valid calendar date.');
    else value = z.number({ error: 'Enter a valid number.' }).finite();
    shape[field.key] = field.required ? value : z.union([value, z.literal('')]).optional();
  }
  return z.strictObject(shape);
}
export function formatFormValues(fields: readonly FormField[], values: Record<string, unknown>): Record<string, string> {
  const parsed = createFormValuesSchema(fields).parse(values);
  return Object.fromEntries(fields.map((field) => {
    const value = parsed[field.key];
    if (value === undefined || value === '') return [field.key, ''];
    if (field.type === 'text' || field.type === 'date') return [field.key, String(value)];
    const precision = field.formatting.precision;
    return [field.key, new Intl.NumberFormat(field.formatting.locale, {
      style: field.type === 'currency' ? 'currency' : 'decimal',
      ...(field.type === 'currency' ? { currency: field.formatting.currency } : {}),
      ...(precision === undefined ? {} : { minimumFractionDigits: precision, maximumFractionDigits: precision }),
    }).format(value as number)];
  }));
}
