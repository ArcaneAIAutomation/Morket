import { apiClient } from '@/api/client';
import type { Credential } from '@/types/api.types';

export function getCredentials(workspaceId: string): Promise<Credential[]> {
  return apiClient.get(`/workspaces/${workspaceId}/credentials`);
}

export function createCredential(
  workspaceId: string,
  data: { providerName: string; apiKey: string; apiSecret?: string },
): Promise<Credential> {
  return apiClient.post(`/workspaces/${workspaceId}/credentials`, data);
}

export function deleteCredential(workspaceId: string, credId: string): Promise<void> {
  return apiClient.delete(`/workspaces/${workspaceId}/credentials/${credId}`);
}
