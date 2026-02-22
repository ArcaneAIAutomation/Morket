import { apiClient } from '@/api/client';
import type { SearchQuery, SearchResponse, ReindexStatus } from '@/types/search.types';

function basePath(workspaceId: string) {
  return `/workspaces/${workspaceId}/search`;
}

/**
 * Full-text search within a workspace.
 * POST /api/v1/workspaces/:id/search
 */
export function searchRecords(
  workspaceId: string,
  query: SearchQuery,
): Promise<SearchResponse> {
  return apiClient.post(basePath(workspaceId), query);
}

/**
 * Autocomplete suggestions for a prefix.
 * GET /api/v1/workspaces/:id/search/suggest?q={prefix}
 */
export function fetchSuggestions(
  workspaceId: string,
  prefix: string,
): Promise<string[]> {
  return apiClient.get(`${basePath(workspaceId)}/suggest`, {
    params: { q: prefix },
  });
}

/**
 * Trigger a full reindex for a workspace.
 * POST /api/v1/workspaces/:id/search/reindex
 */
export function triggerReindex(workspaceId: string): Promise<ReindexStatus> {
  return apiClient.post(`${basePath(workspaceId)}/reindex`);
}

/**
 * Get the latest reindex job status.
 * GET /api/v1/workspaces/:id/search/reindex/status
 */
export function getReindexStatus(workspaceId: string): Promise<ReindexStatus | null> {
  return apiClient.get(`${basePath(workspaceId)}/reindex/status`);
}
