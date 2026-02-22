import { apiClient, enrichmentClient } from '@/api/client';
import type { Provider, WaterfallConfig, EnrichmentJob, EnrichmentRecord } from '@/types/enrichment.types';

export function getProviders(): Promise<Provider[]> {
  return apiClient.get('/providers');
}

export function getEnrichmentJobs(workspaceId: string): Promise<EnrichmentJob[]> {
  return apiClient.get(`/workspaces/${workspaceId}/enrichment-jobs`);
}

export function createEnrichmentJob(
  workspaceId: string,
  payload: { recordIds: string[]; fields: string[]; waterfallConfig: WaterfallConfig | null },
): Promise<EnrichmentJob> {
  return enrichmentClient.post(`/workspaces/${workspaceId}/enrichment-jobs`, payload);
}

export function getEnrichmentJob(workspaceId: string, jobId: string): Promise<EnrichmentJob> {
  return apiClient.get(`/workspaces/${workspaceId}/enrichment-jobs/${jobId}`);
}

export function cancelEnrichmentJob(workspaceId: string, jobId: string): Promise<void> {
  return apiClient.post(`/workspaces/${workspaceId}/enrichment-jobs/${jobId}/cancel`);
}

export function getJobRecords(workspaceId: string, jobId: string): Promise<EnrichmentRecord[]> {
  return apiClient.get(`/workspaces/${workspaceId}/enrichment-jobs/${jobId}/records`);
}
