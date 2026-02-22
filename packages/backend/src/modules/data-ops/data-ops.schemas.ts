import { z } from 'zod';

export const workspaceParamsSchema = z.object({
  id: z.string().uuid(),
});

// --- Import ---

export const importCommitBodySchema = z.object({
  sessionId: z.string().uuid(),
});

// --- Export ---

export const exportBodySchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
  filters: z.object({
    status: z.string().optional(),
    providerSlug: z.string().optional(),
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
  }).optional(),
  limit: z.number().int().min(1).max(50000).default(10000),
});

// --- Dedup ---

export const dedupScanBodySchema = z.object({
  keyFields: z.array(z.string().min(1).max(100)).min(1).max(5),
});

export const dedupMergeBodySchema = z.object({
  groups: z.array(z.object({
    survivorId: z.string().uuid(),
    duplicateIds: z.array(z.string().uuid()).min(1).max(100),
  })).min(1).max(100),
  strategy: z.enum(['keep_newest', 'keep_most_complete']).default('keep_newest'),
});

// --- Bulk Ops ---

export const bulkDeleteBodySchema = z.object({
  recordIds: z.array(z.string().uuid()).min(1).max(1000),
});

export const bulkReEnrichBodySchema = z.object({
  recordIds: z.array(z.string().uuid()).min(1).max(1000),
  providerSlug: z.string().min(1).max(50),
});

// --- Saved Views ---

export const viewParamsSchema = z.object({
  id: z.string().uuid(),
  viewId: z.string().uuid(),
});

export const createViewBodySchema = z.object({
  name: z.string().min(1).max(100),
  filters: z.record(z.string(), z.unknown()).default({}),
  sortConfig: z.record(z.string(), z.unknown()).default({}),
  columnVisibility: z.record(z.string(), z.boolean()).default({}),
  isDefault: z.boolean().default(false),
});

export const updateViewBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  sortConfig: z.record(z.string(), z.unknown()).optional(),
  columnVisibility: z.record(z.string(), z.boolean()).optional(),
  isDefault: z.boolean().optional(),
});

// --- Activity Log ---

export const activityParamsSchema = z.object({
  id: z.string().uuid(),
  recordId: z.string().uuid(),
});

export const activityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ExportInput = z.infer<typeof exportBodySchema>;
export type DedupScanInput = z.infer<typeof dedupScanBodySchema>;
export type DedupMergeInput = z.infer<typeof dedupMergeBodySchema>;
export type CreateViewInput = z.infer<typeof createViewBodySchema>;
export type UpdateViewInput = z.infer<typeof updateViewBodySchema>;
