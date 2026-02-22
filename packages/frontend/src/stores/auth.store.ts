import { create } from 'zustand';
import type { User, AuthTokens, LoginRequest, RegisterRequest } from '@/types/api.types';
import * as authApi from '@/api/auth.api';
import { connectAuthStore } from '@/api/client';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (req: LoginRequest) => Promise<void>;
  register: (req: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  setTokens: (tokens: AuthTokens) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => {
  const store: AuthState = {
    user: null,
    accessToken: null,
    refreshToken: null,
    isAuthenticated: false,
    isLoading: false,

    login: async (req) => {
      set({ isLoading: true });
      try {
        const result = await authApi.login(req);
        set({
          user: result.user,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch (error) {
        set({ isLoading: false });
        throw error;
      }
    },

    register: async (req) => {
      set({ isLoading: true });
      try {
        const result = await authApi.register(req);
        set({
          user: result.user,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch (error) {
        set({ isLoading: false });
        throw error;
      }
    },

    logout: async () => {
      try {
        await authApi.logout();
      } catch {
        // Ignore logout API errors — clear local state regardless
      }
      get().clearAuth();
    },

    setTokens: (tokens) => {
      set({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
    },

    clearAuth: () => {
      set({
        user: null,
        accessToken: null,
        refreshToken: null,
        isAuthenticated: false,
        isLoading: false,
      });
    },
  };

  // Connect to API client to avoid circular deps
  connectAuthStore({
    getAccessToken: () => get().accessToken,
    getRefreshToken: () => get().refreshToken,
    setTokens: (access, refresh) => set({ accessToken: access, refreshToken: refresh }),
    clearAuth: () => get().clearAuth(),
  });

  return store;
});
