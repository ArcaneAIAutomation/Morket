import { useAuthStore } from '@/stores/auth.store';
import { useShallow } from 'zustand/react/shallow';

export function useAuth() {
  return useAuthStore(
    useShallow((s) => ({
      isAuthenticated: s.isAuthenticated,
      user: s.user,
      login: s.login,
      register: s.register,
      logout: s.logout,
      isLoading: s.isLoading,
    })),
  );
}
