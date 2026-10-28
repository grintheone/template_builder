import type { FastifyInstance } from 'fastify';
import { healthResponseSchema, type HealthResponse } from '@studio/shared';

export function registerHealthRoute(app: FastifyInstance, readiness: () => Promise<HealthResponse>) {
  app.get('/api/health', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return healthResponseSchema.parse(await readiness());
  });
}
