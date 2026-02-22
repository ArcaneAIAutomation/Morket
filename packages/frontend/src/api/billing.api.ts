import { apiClient } from '@/api/client';
import type { BillingInfo, CreditTransaction } from '@/types/api.types';

export function getBilling(workspaceId: string): Promise<BillingInfo> {
  return apiClient.get(`/workspaces/${workspaceId}/billing`);
}

export function addCredits(workspaceId: string, amount: number): Promise<BillingInfo> {
  return apiClient.post(`/workspaces/${workspaceId}/billing/credits`, { amount });
}

export function getTransactions(
  workspaceId: string,
  params?: { page?: number; limit?: number },
): Promise<{ transactions: CreditTransaction[]; total: number }> {
  return apiClient.get(`/workspaces/${workspaceId}/billing/transactions`, { params });
}
