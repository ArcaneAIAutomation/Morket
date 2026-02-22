import { apiClient } from '@/api/client';
import type { RecordRow, ColumnDefinition } from '@/types/grid.types';

export function getRecords(workspaceId: string): Promise<RecordRow[]> {
  return apiClient.get(`/workspaces/${workspaceId}/records`);
}

export function createRecord(workspaceId: string, data: Record<string, unknown>): Promise<RecordRow> {
  return apiClient.post(`/workspaces/${workspaceId}/records`, data);
}

export function batchUpdateRecords(
  workspaceId: string,
  records: Array<{ id: string; fields: Record<string, unknown> }>,
): Promise<void> {
  return apiClient.put(`/workspaces/${workspaceId}/records/batch`, { records });
}

export function batchDeleteRecords(workspaceId: string, recordIds: string[]): Promise<void> {
  return apiClient.delete(`/workspaces/${workspaceId}/records/batch`, { data: { recordIds } });
}

export function getColumns(workspaceId: string): Promise<ColumnDefinition[]> {
  return apiClient.get(`/workspaces/${workspaceId}/columns`);
}

export function createColumn(
  workspaceId: string,
  col: Omit<ColumnDefinition, 'id' | 'order'>,
): Promise<ColumnDefinition> {
  return apiClient.post(`/workspaces/${workspaceId}/columns`, col);
}

export function updateColumn(
  workspaceId: string,
  colId: string,
  updates: Partial<ColumnDefinition>,
): Promise<ColumnDefinition> {
  return apiClient.put(`/workspaces/${workspaceId}/columns/${colId}`, updates);
}

export function deleteColumn(workspaceId: string, colId: string): Promise<void> {
  return apiClient.delete(`/workspaces/${workspaceId}/columns/${colId}`);
}
