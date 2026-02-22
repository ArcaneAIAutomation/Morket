import { z } from 'zod';

export const workspaceParamsSchema = z.object({
  id: z.string().uuid(),
});

export const workflowParamsSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
});

export const runParamsSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  runId: z.string().uuid(),
});

export const templateParamsSchema = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid(),
});

const nodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['data_source', 'enrichment_step', 'filter', 'output']),
  config: z.record(z.string(), z.unknown()),
  position: z.object({ x: z.number(), y: z.number() }),
});

const edgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
});

export const graphDefinitionSchema = z.object({
  nodes: z.array(nodeSchema).min(1).max(50),
  edges: z.array(edgeSchema).max(100),
});

export const createWorkflowBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  graph: graphDefinitionSchema,
});

export const updateWorkflowBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  graph: graphDefinitionSchema.optional(),
});

export const rollbackBodySchema = z.object({
  version: z.number().int().min(1),
});

export const scheduleBodySchema = z.object({
  cron: z.string().min(1).max(100).nullable(),
  enabled: z.boolean(),
});

export const listRunsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type CreateWorkflowInput = z.infer<typeof createWorkflowBodySchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowBodySchema>;
export type GraphDefinition = z.infer<typeof graphDefinitionSchema>;
