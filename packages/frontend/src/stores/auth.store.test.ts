import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from './auth.store';

vi.mock('@/api/auth.api', () => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  connectAuthStore: vi.fn(),
}));

import * as authApi from '@/api/auth.api';

const mockUser = {
  id: 'u-1',
  email: 'test@example.com',
  displayName: 'Test User',
  createdAt: '2024-01-01T00:00:00Z',
};

describe('auth.store', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
    });
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('stores tokens and user on successful login', async () => {
      vi.mocked(authApi.login).mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        user: mockUser,
      });

      await useAuthStore.getState().login({ email: 'test@example.com', password: 'password123' });

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe('access-123');
      expect(state.refreshToken).toBe('refresh-456');
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
    });

    it('sets isLoading during login and resets on failure', async () => {
      vi.mocked(authApi.login).mockRejectedValue(new Error('Invalid credentials'));

      await expect(
        useAuthStore.getState().login({ email: 'test@example.com', password: 'wrong' }),
      ).rejects.toThrow('Invalid credentials');

      const state = useAuthStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.isAuthenticated).toBe(false);
      expect(state.accessToken).toBeNull();
    });
  });

  describe('register', () => {
    it('stores tokens and user on successful registration', async () => {
      vi.mocked(authApi.register).mockResolvedValue({
        accessToken: 'access-new',
        refreshToken: 'refresh-new',
        user: mockUser,
      });

      await useAuthStore.getState().register({
        email: 'test@example.com',
        password: 'password123',
        displayName: 'Test User',
      });

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe('access-new');
      expect(state.refreshToken).toBe('refresh-new');
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
    });
  });

  describe('logout', () => {
    it('clears all auth state on logout', async () => {
      // Set up authenticated state first
      useAuthStore.setState({
        user: mockUser,
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        isAuthenticated: true,
      });

      vi.mocked(authApi.logout).mockResolvedValue(undefined);

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.accessToken).toBeNull();
      expect(state.refreshToken).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });

    it('clears state even if logout API call fails', async () => {
      useAuthStore.setState({
        user: mockUser,
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        isAuthenticated: true,
      });

      vi.mocked(authApi.logout).mockRejectedValue(new Error('Network error'));

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('setTokens', () => {
    it('updates access and refresh tokens', () => {
      useAuthStore.getState().setTokens({ accessToken: 'new-access', refreshToken: 'new-refresh' });

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe('new-access');
      expect(state.refreshToken).toBe('new-refresh');
    });
  });

  describe('clearAuth', () => {
    it('resets all fields to initial state', () => {
      useAuthStore.setState({
        user: mockUser,
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        isAuthenticated: true,
        isLoading: true,
      });

      useAuthStore.getState().clearAuth();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.accessToken).toBeNull();
      expect(state.refreshToken).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
    });
  });
});
