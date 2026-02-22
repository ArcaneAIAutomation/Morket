import { z } from 'zod';

// Auth schemas
export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(1, 'Display name is required'),
});

// Workspace schemas
export const createWorkspaceSchema = z.object({
  name: z.string().min(1, 'Workspace name is required'),
});

// Member schemas
export const inviteMemberSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
});

// Credential schemas
export const createCredentialSchema = z.object({
  providerName: z.string().min(1, 'Provider is required'),
  apiKey: z.string().min(1, 'API key is required'),
  apiSecret: z.string().optional(),
});

// Billing schemas
export const addCreditsSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
});

// Column schemas
export const createColumnSchema = z.object({
  field: z.string().min(1, 'Field name is required'),
  headerName: z.string().min(1, 'Header name is required'),
  dataType: z.enum(['text', 'number', 'email', 'url', 'date', 'boolean']),
  width: z.number().positive().default(150),
  pinned: z.enum(['left']).nullable().default(null),
  hidden: z.boolean().default(false),
  sortable: z.boolean().default(true),
  filterable: z.boolean().default(true),
  editable: z.boolean().default(true),
  enrichmentField: z.string().nullable().default(null),
  enrichmentProvider: z.string().nullable().default(null),
});

// Enrichment schemas
export const createEnrichmentJobSchema = z.object({
  recordIds: z.array(z.string()).min(1, 'Select at least one record'),
  fields: z.array(z.string()).min(1, 'Select at least one field'),
  waterfallConfig: z
    .record(
      z.object({
        providers: z.array(z.string()).min(1),
      }),
    )
    .nullable(),
});
