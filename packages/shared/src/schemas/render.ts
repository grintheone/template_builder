import { z } from 'zod';

export const MAX_RENDER_FIELDS = 100;
export const MAX_VALUES_BYTES = 64 * 1024;
export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const fieldKeySchema = z.string().max(64).regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/)
  .refine((key) => !['constructor', 'prototype', '__proto__'].includes(key));

// XML 1.0 characters only. Reject instead of silently stripping user values.
export function isXmlText(value: string): boolean {
  return Array.from(value).every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff)
      || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
  });
}

export const renderValuesSchema = z.record(fieldKeySchema, z.union([
  z.string().max(10000).refine(isXmlText),
  z.number().finite(),
])).refine((values) => Object.keys(values).length <= MAX_RENDER_FIELDS);
export type RenderValues = z.infer<typeof renderValuesSchema>;

export const renderErrorCodeSchema = z.enum([
  'INVALID_REQUEST', 'UPLOAD_TOO_LARGE', 'INVALID_DOCX', 'UNSUPPORTED_DOCX',
  'INVALID_TEMPLATE', 'INVALID_VALUES', 'FIELD_MISMATCH',
]);
export const renderErrorSchema = z.object({ code: renderErrorCodeSchema, message: z.string().min(1) });
export type RenderErrorCode = z.infer<typeof renderErrorCodeSchema>;
