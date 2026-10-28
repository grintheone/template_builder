import type { FastifyInstance } from 'fastify';
import { documentIdSchema, saveReviewSchema, publishRequestSchema } from '@studio/shared';
import type { AppConfig } from '../config.js';
import { ReviewStore } from '../storage/reviews.js';
import { ReviewFailure } from '../services/templates/errors.js';
export function registerReviewRoutes(app: FastifyInstance, config: AppConfig, maxBytes: number) {
  const store = new ReviewStore(config, maxBytes);
  app.addHook('onReady', () => store.cleanupOrphans());
  app.addHook('onClose', async () => store.close());
  for (const method of ['GET', 'PUT', 'POST'] as const) app.route<{ Params: { id: string } }>({
    method, url: `/api/documents/:id/${method === 'POST' ? 'publish' : 'fields'}`,
    bodyLimit: 4 * 1024 * 1024,
    handler: async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const id = documentIdSchema.safeParse(request.params.id);
      if (!id.success) throw new ReviewFailure('INVALID_REQUEST', 400, 'Use a valid document ID.');
      if (method === 'GET') return store.get(id.data);
      if (method === 'PUT') {
        const input = saveReviewSchema.safeParse(request.body);
        if (!input.success) throw new ReviewFailure('INVALID_REQUEST', 400, 'Invalid review. Check keys, defaults, formatting and occurrence identities.');
        return store.save(id.data, input.data);
      }
      const input = publishRequestSchema.safeParse(request.body);
      if (!input.success) throw new ReviewFailure('INVALID_REQUEST', 400, 'Use the saved source hash and review revision.');
      return store.publish(id.data, input.data.sourceHash, input.data.reviewRevision);
    },
  });
}
