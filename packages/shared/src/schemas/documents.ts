import { z } from 'zod';

export const documentIdSchema = z.uuid();
export const sourceBlockSchema = z.object({
  id: z.string(), partPath: z.string(), paragraphIndex: z.number().int().nonnegative(),
  section: z.enum(['body', 'header', 'footer']), text: z.string(),
  location: z.string(), supported: z.boolean(), warnings: z.array(z.string()),
  // Offsets are UTF-16 code units, matching JavaScript string slicing.
  spans: z.array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), textNodeIndex: z.number().int().nonnegative() })),
});
export const documentImportSchema = z.object({ documentId: documentIdSchema, sourceHash: z.string().regex(/^[a-f0-9]{64}$/) });
export const documentBlocksSchema = documentImportSchema.extend({ blocks: z.array(sourceBlockSchema), warnings: z.array(z.string()) });
export type SourceBlock = z.infer<typeof sourceBlockSchema>;
