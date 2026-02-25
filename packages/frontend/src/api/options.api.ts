import { apiClient } from '@/api/client';
import type { ServiceConfiguration, ConnectionTestResult } from '@/types/api.types';

export function getOptions(workspaceId: string): Promise<ServiceConfiguration[]> {
  return apiClient.get(`/workspaces/${workspaceId}/options`);
}

export function saveOption(
  workspaceId: string,
  serviceKey: string,
  values: Record<string, string>,
): Promise<void> {
  return apiClient.put(`/workspaces/${workspaceId}/options/${serviceKey}`, { values });
}

export function deleteOption(workspaceId: string, serviceKey: string): Promise<void> {
  return apiClient.delete(`/workspaces/${workspaceId}/options/${serviceKey}`);
}

export function testConnection(
  workspaceId: string,
  serviceKey: string,
): Promise<ConnectionTestResult> {
  return apiClient.post(`/workspaces/${workspaceId}/options/${serviceKey}/test`);
}
