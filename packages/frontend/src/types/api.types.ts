export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta: Record<string, unknown> | null;
}

export interface ApiError {
  status: number;
  message: string;
  fieldErrors?: Record<string, string>;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMember {
  userId: string;
  email: string;
  displayName: string;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface Credential {
  id: string;
  providerName: string;
  maskedKey: string;
  createdAt: string;
}

export interface BillingInfo {
  creditBalance: number;
  planType: string;
  autoRecharge: boolean;
  creditLimit: number;
}

export interface CreditTransaction {
  id: string;
  type: string;
  amount: number;
  description: string;
  createdAt: string;
}

export interface ServiceConfiguration {
  serviceKey: string;
  serviceGroup: string;
  maskedValues: Record<string, string>;
  status: 'configured' | 'not_configured' | 'error';
  lastTestedAt: string | null;
  updatedAt: string;
}

export interface ConnectionTestResult {
  success: boolean;
  responseTimeMs: number;
  error?: string;
}
