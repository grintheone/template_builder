import { Readable } from 'node:stream';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { documentIdSchema, templateRenderRequestSchema, createFormValuesSchema, formatFormValues, DOCX_MIME_TYPE, MAX_VALUES_BYTES } from '@studio/shared';
import { localDataPath, type AppConfig } from '../config.js';
import { TemplateStore } from '../storage/templates.js';
import { DocxRenderer } from '../services/docx/renderer.js';
import { PdfConverter } from '../services/pdf/converter.js';
import { ExportFailure } from '../services/templates/export-error.js';
import { cleanupExpiredExports } from '../storage/temporary.js';

export function registerTemplateRoutes(app: FastifyInstance, config: AppConfig, maxBytes: number) {
  const store = new TemplateStore(config);
  const renderer = new DocxRenderer(maxBytes);
  const temporary = localDataPath(resolve(config.STORAGE_DIR, 'temporary'));
  const pdf = new PdfConverter(config.SOFFICE_PATH, temporary);
  app.addHook('onReady', () => cleanupExpiredExports(temporary));
  app.addHook('onClose', async () => store.close());
  app.get('/api/templates', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); return store.list(); });
  for (const method of ['GET', 'POST'] as const) app.route<{ Params: { id: string } }>({
    method, url: `/api/templates/:id${method === 'POST' ? '/render' : ''}`, bodyLimit: MAX_VALUES_BYTES,
    handler: async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const id = documentIdSchema.safeParse(request.params.id);
      if (!id.success) throw new ExportFailure('INVALID_REQUEST', 400, 'Use a valid template ID.');
      if (method === 'GET') return store.get(id.data).detail;
      const input = templateRenderRequestSchema.safeParse(request.body);
      if (!input.success) throw new ExportFailure('INVALID_REQUEST', 400, 'Provide a published version ID, docx or pdf format, and field values.');
      const { row, detail } = store.get(id.data, input.data.versionId);
      if (!createFormValuesSchema(detail.fields).safeParse(input.data.values).success) throw new ExportFailure('INVALID_VALUES', 422, 'Check required fields, dates and numeric values. Unknown fields are not allowed.');
      const docx = await renderer.render(await store.source(row), formatFormValues(detail.fields, input.data.values));
      const output = input.data.format === 'pdf' ? await pdf.convert(docx) : docx;
      return reply.type(input.data.format === 'pdf' ? 'application/pdf' : DOCX_MIME_TYPE).header('Content-Disposition', `attachment; filename="document.${input.data.format}"`).header('X-Content-Type-Options', 'nosniff').send(Readable.from([output]));
    },
  });
}
