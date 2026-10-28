import type { FastifyInstance } from 'fastify';
import { analysisStartedSchema, documentIdSchema } from '@studio/shared';
import type { AppConfig } from '../config.js';
import { AnalysisJobs, AnalysisQueueFull } from '../storage/analysis-jobs.js';
import { AnalysisFailure } from '../services/ai/errors.js';
import { OllamaFieldDetector, type FieldDetector } from '../services/ai/field-detector.js';

export function registerAnalysisRoutes(app: FastifyInstance, config: AppConfig, maxUploadBytes: number, detector?: FieldDetector) {
  let jobs: AnalysisJobs;
  // Recovery happens on service startup, even if nobody requests analysis afterward.
  app.addHook('onReady', async () => { jobs = new AnalysisJobs(config, detector ?? new OllamaFieldDetector(config), maxUploadBytes); });
  app.addHook('onClose', async () => { await jobs?.close(); });
  app.post<{ Params: { id: string } }>('/api/documents/:id/analyze', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const id = documentIdSchema.safeParse(request.params.id);
    if (!id.success || (request.body !== undefined && request.body !== null)) return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'Use a valid document ID and an empty request body.' });
    try {
      const jobId = await jobs.start(id.data);
      if (!jobId) return reply.code(404).send({ code: 'NOT_FOUND', message: 'The source document was not found.' });
      reply.header('Location', `/api/analysis-jobs/${jobId}`);
      return reply.code(202).send(analysisStartedSchema.parse({ jobId }));
    } catch (error) {
      if (error instanceof AnalysisQueueFull) return reply.code(429).header('Retry-After', '5').send({ code: 'QUEUE_FULL', message: 'The local analysis queue is full. Wait for a job to finish and retry.' });
      if (error instanceof AnalysisFailure) return reply.code(422).send(error.toJSON());
      throw error;
    }
  });
  app.get<{ Params: { jobId: string } }>('/api/analysis-jobs/:jobId', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const id = documentIdSchema.safeParse(request.params.jobId);
    if (!id.success) return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'Use a valid analysis job ID.' });
    const job = jobs.get(id.data);
    if (!job) return reply.code(404).send({ code: 'NOT_FOUND', message: 'The analysis job was not found.' });
    return job;
  });
}
