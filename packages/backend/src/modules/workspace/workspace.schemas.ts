import { z } from 'zod';

// --- Workspace Role Enum ---

export const workspaceRoleEnum = z.enum(['owner', 'admin', 'member', 'viewer']);
export const addMemberRoleEnum = z.enum(['admin', 'member', 'viewer']);

// --- Request Body Schemas ---

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

export const addMemberSchema = z.object({
  email: z.string().email(),
  role: addMemberRoleEnum,
});

export const updateRoleSchema = z.object({
  role: workspaceRoleEnum,
});

// --- Param Schemas ---

export const workspaceParamsSchema = z.object({
  id: z.string().uuid(),
});

export const memberParamsSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});

// --- Options Schemas ---

export const serviceKeyEnum = z.enum([
  'apollo', 'clearbit', 'hunter',
  'scraper',
  'salesforce', 'hubspot',
  'stripe',
  'temporal', 'opensearch', 'redis', 'clickhouse',
]);

export const upsertOptionsSchema = z.object({
  values: z.record(z.string().min(1), z.string()).refine(
    (obj) => Object.keys(obj).length > 0,
    { message: 'At least one configuration value is required' }
  ),
});

export const optionsParamsSchema = z.object({
  id: z.string().uuid(),
  serviceKey: serviceKeyEnum,
});


// --- Inferred Types ---

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type WorkspaceParams = z.infer<typeof workspaceParamsSchema>;
export type MemberParams = z.infer<typeof memberParamsSchema>;
export type ServiceKey = z.infer<typeof serviceKeyEnum>;
export type UpsertOptionsInput = z.infer<typeof upsertOptionsSchema>;
export type OptionsParams = z.infer<typeof optionsParamsSchema>;
