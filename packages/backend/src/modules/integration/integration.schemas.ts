import { z } from 'zod';

export const workspaceParamsSchema = z.object({
  id: z.string().uuid(),
});

export const integrationParamsSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1).max(50),
});

export const connectBodySchema = z.object({
  successRedirectUrl: z.string().url(),
});

export const fieldMappingsBodySchema = z.object({
  mappings: z.array(z.object({
    morketField: z.string().min(1).max(100),
    crmField: z.string().min(1).max(100),
    direction: z.enum(['push', 'pull', 'both']).default('both'),
  })).min(1).max(50),
});

export const pushBodySchema = z.object({
  entity: z.string().min(1).max(50),
  records: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).min(1).max(200),
});

export const pullBodySchema = z.object({
  entity: z.string().min(1).max(50),
  limit: z.number().int().min(1).max(200).default(100),
});

export const syncHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export type ConnectInput = z.infer<typeof connectBodySchema>;
export type FieldMappingsInput = z.infer<typeof fieldMappingsBodySchema>;
export type PushInput = z.infer<typeof pushBodySchema>;
export type PullInput = z.infer<typeof pullBodySchema>;
