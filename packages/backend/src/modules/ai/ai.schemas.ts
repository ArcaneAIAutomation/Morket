import { z } from 'zod';

export const workspaceParamsSchema = z.object({
  id: z.string().uuid(),
});

export const recordParamsSchema = z.object({
  id: z.string().uuid(),
  recordId: z.string().uuid(),
});

export const fieldMappingSuggestBodySchema = z.object({
  headers: z.array(z.string().min(1).max(200)).min(1).max(100),
});

export const duplicateDetectBodySchema = z.object({
  fields: z.array(z.string().min(1).max(100)).min(1).max(5),
  threshold: z.number().min(0.5).max(1.0).default(0.8),
  limit: z.number().int().min(1).max(500).default(100),
});

export const nlQueryBodySchema = z.object({
  query: z.string().min(1).max(500),
});

export type FieldMappingSuggestInput = z.infer<typeof fieldMappingSuggestBodySchema>;
export type DuplicateDetectInput = z.infer<typeof duplicateDetectBodySchema>;
export type NLQueryInput = z.infer<typeof nlQueryBodySchema>;
