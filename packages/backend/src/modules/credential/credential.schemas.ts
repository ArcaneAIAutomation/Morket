import { z } from 'zod';

// --- Request Body Schemas ---

export const storeCredentialSchema = z.object({
  providerName: z.string().min(1),
  key: z.string().min(1),
  secret: z.string().min(1),
});

// --- Param Schemas ---

export const workspaceParamsSchema = z.object({
  id: z.string().uuid(),
});

export const credentialParamsSchema = z.object({
  id: z.string().uuid(),
  credId: z.string().uuid(),
});

// --- Inferred Types ---

export type StoreCredentialInput = z.infer<typeof storeCredentialSchema>;
export type WorkspaceParams = z.infer<typeof workspaceParamsSchema>;
export type CredentialParams = z.infer<typeof credentialParamsSchema>;
