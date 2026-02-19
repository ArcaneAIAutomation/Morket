import { z } from 'zod';

// --- Request Body Schemas ---

export const addCreditsSchema = z.object({
  amount: z.number().int().min(1),
  description: z.string().min(1),
});

// --- Query Param Schemas ---

export const getTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// --- Param Schemas ---

export const workspaceParamsSchema = z.object({
  id: z.string().uuid(),
});

// --- Inferred Types ---

export type AddCreditsInput = z.infer<typeof addCreditsSchema>;
export type GetTransactionsQuery = z.infer<typeof getTransactionsQuerySchema>;
export type WorkspaceParams = z.infer<typeof workspaceParamsSchema>;
