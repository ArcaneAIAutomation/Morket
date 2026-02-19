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

// --- Inferred Types ---

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type WorkspaceParams = z.infer<typeof workspaceParamsSchema>;
export type MemberParams = z.infer<typeof memberParamsSchema>;
