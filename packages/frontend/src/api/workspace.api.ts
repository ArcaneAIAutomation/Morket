import { apiClient } from '@/api/client';
import type { Workspace } from '@/types/api.types';

export function getWorkspaces(): Promise<Workspace[]> {
  return apiClient.get('/workspaces');
}

export function createWorkspace(name: string): Promise<Workspace> {
  return apiClient.post('/workspaces', { name });
}

export function updateWorkspace(id: string, name: string): Promise<Workspace> {
  return apiClient.put(`/workspaces/${id}`, { name });
}

export function deleteWorkspace(id: string): Promise<void> {
  return apiClient.delete(`/workspaces/${id}`);
}
