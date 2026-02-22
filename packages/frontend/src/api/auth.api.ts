import { apiClient } from '@/api/client';
import type { User, LoginRequest, RegisterRequest } from '@/types/api.types';

export function login(req: LoginRequest): Promise<{ accessToken: string; refreshToken: string; user: User }> {
  return apiClient.post('/auth/login', req);
}

export function register(req: RegisterRequest): Promise<{ accessToken: string; refreshToken: string; user: User }> {
  return apiClient.post('/auth/register', req);
}

export function logout(): Promise<void> {
  return apiClient.post('/auth/logout');
}

export function refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  return apiClient.post('/auth/refresh', { refreshToken });
}
