import type { FastifyInstance } from 'fastify';
import { documentIdSchema, documentImportSchema, documentBlocksSchema } from '@studio/shared';
import type { AppConfig } from '../config.js';
import { DocumentStore } from '../storage/documents.js';
import { DocxError } from '../services/docx/errors.js';

export function registerDocumentRoutes(app: FastifyInstance, config: AppConfig, maxUploadBytes: number) {
  let store: DocumentStore | undefined;
  const repository = () => store ??= new DocumentStore(config, maxUploadBytes);
  app.addHook('onClose', async () => store?.close());
  app.post('/api/documents', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!request.isMultipart()) throw new DocxError('INVALID_REQUEST', 'Upload one .docx file in the document field.');
    let source: Buffer | undefined;
    let invalid = false;
    try {
      for await (const part of request.parts()) {
        if (part.type !== 'file') { invalid = true; continue; }
        const buffer = await part.toBuffer();
        if (source || part.fieldname !== 'document' || !/\.docx$/i.test(part.filename) || /[/\\\0]/.test(part.filename)) invalid = true;
        else source = buffer;
      }
    } catch (error) {
      if ((error as { code?: string }).code?.startsWith('FST_')) throw error;
      throw new DocxError('INVALID_REQUEST', 'The multipart upload is invalid or incomplete.');
    }
    if (invalid || !source) throw new DocxError('INVALID_REQUEST', 'Upload one .docx file in the document field, without extra fields.');
    return reply.code(201).send(documentImportSchema.parse(await repository().import(source)));
  });
  app.get<{ Params: { id: string } }>('/api/documents/:id/blocks', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const id = documentIdSchema.safeParse(request.params.id);
    if (!id.success) return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'Use a valid document ID.' });
    const result = await repository().blocks(id.data);
    if (!result) return reply.code(404).send({ code: 'NOT_FOUND', message: 'The source document was not found.' });
    return documentBlocksSchema.parse(result);
  });
}
