import { apiClient } from '@/api/client';
import type { WorkspaceMember, WorkspaceRole } from '@/types/api.types';

export function getMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  return apiClient.get(`/workspaces/${workspaceId}/members`);
}

export function inviteMember(workspaceId: string, email: string, role: WorkspaceRole): Promise<WorkspaceMember> {
  return apiClient.post(`/workspaces/${workspaceId}/members`, { email, role });
}

export function updateMemberRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void> {
  return apiClient.put(`/workspaces/${workspaceId}/members/${userId}/role`, { role });
}

export function removeMember(workspaceId: string, userId: string): Promise<void> {
  return apiClient.delete(`/workspaces/${workspaceId}/members/${userId}`);
}
