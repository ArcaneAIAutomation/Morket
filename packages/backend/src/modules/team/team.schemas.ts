import { z } from 'zod';

export const workspaceParamsSchema = z.object({
  id: z.string().uuid(),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const auditFilterQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().max(100).optional(),
  actorId: z.string().uuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

export const inviteBodySchema = z.object({
  email: z.string().email().max(255),
  role: z.enum(['member', 'viewer', 'billing_admin']).default('member'),
});

export const invitationTokenParamsSchema = z.object({
  token: z.string().min(1).max(64),
});

export type InviteInput = z.infer<typeof inviteBodySchema>;
