import type { FastifyInstance } from 'fastify';
import { DOCX_MIME_TYPE, MAX_VALUES_BYTES, renderValuesSchema } from '@studio/shared';
import { DocxRenderer } from '../services/docx/renderer.js';
import { DocxError } from '../services/docx/errors.js';

export function registerDevRenderRoute(app: FastifyInstance, maxUploadBytes: number) {
  const renderer = new DocxRenderer(maxUploadBytes);
  app.post('/api/dev/render', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!request.isMultipart()) throw new DocxError('INVALID_REQUEST', 'Send multipart/form-data with a template DOCX file and values JSON field.');
    let source: Buffer | undefined;
    let rawValues: string | undefined;
    let invalid = false;
    let valuesTooLarge = false;
    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          // Consume the stream even for an invalid field to avoid stalled multipart parsing.
          const buffer = await part.toBuffer();
          if (part.fieldname !== 'template' || source || !/\.docx$/i.test(part.filename) || /[/\\\0]/.test(part.filename)) invalid = true;
          else source = buffer;
        } else if (part.valueTruncated) {
          valuesTooLarge = true;
        } else if (part.fieldname !== 'values' || rawValues !== undefined || typeof part.value !== 'string') {
          invalid = true;
        } else rawValues = part.value;
      }
    } catch (error) {
      if (error instanceof DocxError || (error as { code?: string }).code?.startsWith('FST_')) throw error;
      throw new DocxError('INVALID_REQUEST', 'The multipart request is invalid or incomplete.');
    }
    if (valuesTooLarge) throw new DocxError('UPLOAD_TOO_LARGE', 'The values JSON exceeds 64 KiB.');
    if (invalid || !source || rawValues === undefined) throw new DocxError('INVALID_REQUEST', 'Upload one .docx file named template and one JSON field named values.');
    if (Buffer.byteLength(rawValues, 'utf8') > MAX_VALUES_BYTES) throw new DocxError('UPLOAD_TOO_LARGE', 'The values JSON exceeds 64 KiB.');
    let values: unknown;
    try { values = JSON.parse(rawValues); } catch { throw new DocxError('INVALID_VALUES', 'Values must be valid JSON.'); }
    if (!renderValuesSchema.safeParse(values).success) throw new DocxError('INVALID_VALUES', 'Values must be an object with snake_case keys and text or finite numbers.');
    const rendered = await renderer.render(source, values);
    return reply.type(DOCX_MIME_TYPE)
      .header('Content-Disposition', 'attachment; filename="rendered.docx"')
      .header('X-Content-Type-Options', 'nosniff')
      .send(rendered);
  });
}
