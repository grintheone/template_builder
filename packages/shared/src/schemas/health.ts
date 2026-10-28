import { z } from 'zod';

export const dependencyStatusSchema = z.object({
  available: z.boolean(),
  message: z.string().min(1),
});

export const healthResponseSchema = z.object({
  api: z.object({ available: z.literal(true), message: z.string() }),
  ollama: dependencyStatusSchema.extend({
    endpoint: z.url(),
    model: z.string().min(1),
    modelAvailable: z.boolean(),
  }),
  libreOffice: dependencyStatusSchema.extend({ binary: z.string().min(1) }),
});

export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
