import { registerDocumentRoutes } from './routes/documents.js';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { MAX_VALUES_BYTES } from '@studio/shared';
import { registerDevRenderRoute } from './routes/dev-render.js';
import { DocxError } from './services/docx/errors.js';
import type { HealthResponse } from '@studio/shared';
import type { AppConfig } from './config.js';
import { registerHealthRoute } from './routes/health.js';
import { checkReadiness } from './services/readiness.js';

export function buildApp(config: AppConfig, readiness: () => Promise<HealthResponse> = () => checkReadiness(config)) {
  const maxUploadBytes = Math.max(1, Math.floor(config.MAX_UPLOAD_MB * 1024 * 1024));
  const app = Fastify({ logger: false, bodyLimit: maxUploadBytes });
  app.register(multipart, { limits: {
    fileSize: maxUploadBytes, files: 1, fields: 1, parts: 2,
    fieldSize: MAX_VALUES_BYTES, fieldNameSize: 32, headerPairs: 50,
  } });
  registerHealthRoute(app, readiness);
  registerDevRenderRoute(app, maxUploadBytes);
  registerDocumentRoutes(app, config, maxUploadBytes);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DocxError) {
      return reply.code(error.code === 'UPLOAD_TOO_LARGE' ? 413 : 422).send({ code: error.code, message: error.message });
    }
    const code = (error as { code?: string }).code ?? '';
    if (['FST_REQ_FILE_TOO_LARGE', 'FST_PARTS_LIMIT', 'FST_FILES_LIMIT', 'FST_FIELDS_LIMIT', 'FST_ERR_CTP_BODY_TOO_LARGE'].includes(code)) {
      return reply.code(413).send({ code: 'UPLOAD_TOO_LARGE', message: 'The upload exceeds the configured file or multipart limits.' });
    }
    if ((error as { statusCode?: number }).statusCode === 400 || code.startsWith('FST_INVALID_MULTIPART')) {
      return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The multipart request is invalid.' });
    }
    reply.code(500).send({ error: 'The local service could not complete the request.' });
  });
  return app;
}
