import Fastify from 'fastify';
import type { HealthResponse } from '@studio/shared';
import type { AppConfig } from './config.js';
import { registerHealthRoute } from './routes/health.js';
import { checkReadiness } from './services/readiness.js';

export function buildApp(config: AppConfig, readiness: () => Promise<HealthResponse> = () => checkReadiness(config)) {
  const app = Fastify({ logger: false, bodyLimit: config.MAX_UPLOAD_MB * 1024 * 1024 });
  registerHealthRoute(app, readiness);
  app.setErrorHandler((_error, _request, reply) => {
    reply.code(500).send({ error: 'The local service could not complete the request.' });
  });
  return app;
}
