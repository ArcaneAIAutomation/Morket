import { z } from 'zod';

// --- Request Body Schemas ---

export const createJobBodySchema = z.object({
  records: z.array(z.record(z.string(), z.unknown())).min(1).max(10000),
  fields: z.array(z.enum(['email', 'phone', 'company_info', 'job_title', 'social_profiles', 'address'])).min(1),
  waterfallConfig: z.record(z.string(), z.object({
    providers: z.array(z.string().min(1)).min(1),
  })).optional(),
});

export const createWebhookBodySchema = z.object({
  callbackUrl: z.string().url(),
  eventTypes: z.array(z.string().min(1)).min(1),
});

// --- Param Schemas ---

export const workspaceParamsSchema = z.object({
  id: z.string().uuid(),
});

export const jobParamsSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
});

export const recordParamsSchema = z.object({
  id: z.string().uuid(),
  recordId: z.string().uuid(),
});

export const webhookParamsSchema = z.object({
  id: z.string().uuid(),
  webhookId: z.string().uuid(),
});

export const providerParamsSchema = z.object({
  providerSlug: z.string().min(1),
});

// --- Query Schemas ---

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// --- Inferred Types ---

export type CreateJobBody = z.infer<typeof createJobBodySchema>;
export type CreateWebhookBody = z.infer<typeof createWebhookBodySchema>;
export type WorkspaceParams = z.infer<typeof workspaceParamsSchema>;
export type JobParams = z.infer<typeof jobParamsSchema>;
export type RecordParams = z.infer<typeof recordParamsSchema>;
export type WebhookParams = z.infer<typeof webhookParamsSchema>;
export type ProviderParams = z.infer<typeof providerParamsSchema>;
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
