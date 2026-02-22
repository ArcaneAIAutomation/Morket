import { z } from 'zod';

// --- Request Schemas ---

export const searchQuerySchema = z.object({
  q: z.string().max(500).default(''),
  filters: z.object({
    document_type: z.array(z.enum(['enrichment_record', 'contact', 'company', 'scrape_result'])).optional(),
    provider_slug: z.array(z.string()).optional(),
    enrichment_status: z.array(z.string()).optional(),
    scrape_target_type: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    created_at: z.object({
      gte: z.string().datetime().optional(),
      lte: z.string().datetime().optional(),
    }).optional(),
    updated_at: z.object({
      gte: z.string().datetime().optional(),
      lte: z.string().datetime().optional(),
    }).optional(),
  }).optional().default({}),
  facets: z.array(z.enum([
    'document_type', 'provider_slug', 'enrichment_status', 'scrape_target_type', 'tags',
  ])).optional().default(['document_type', 'provider_slug', 'enrichment_status', 'scrape_target_type', 'tags']),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.object({
    field: z.enum(['_score', 'created_at', 'updated_at', 'name']).default('_score'),
    direction: z.enum(['asc', 'desc']).default('desc'),
  }).optional().default({ field: '_score', direction: 'desc' }),
  fuzziness: z.enum(['0', '1', '2', 'AUTO']).optional().default('AUTO'),
});

export const suggestQuerySchema = z.object({
  q: z.string().min(2).max(100),
});

// --- Response Schemas ---

export const searchResultSchema = z.object({
  record_id: z.string(),
  document_type: z.string(),
  workspace_id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  company: z.string().nullable(),
  job_title: z.string().nullable(),
  location: z.string().nullable(),
  phone: z.string().nullable(),
  domain: z.string().nullable(),
  provider_slug: z.string().nullable(),
  enrichment_status: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  source_url: z.string().nullable(),
  scrape_target_type: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  score: z.number(),
  highlights: z.record(z.array(z.string())).optional(),
});

// --- Params Schemas ---

export const workspaceParamsSchema = z.object({
  id: z.string().uuid(),
});

// --- Inferred Types ---

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type SuggestQuery = z.infer<typeof suggestQuerySchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type WorkspaceParams = z.infer<typeof workspaceParamsSchema>;
