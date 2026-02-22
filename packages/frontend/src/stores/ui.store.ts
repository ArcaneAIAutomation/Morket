import { create } from 'zustand';
import { connectUIStore } from '@/api/client';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  autoDismiss: boolean;
}

const MAX_TOASTS = 5;
const AUTO_DISMISS_MS = 5_000;
const SIDEBAR_KEY = 'morket_sidebarCollapsed';

interface UIState {
  toasts: Toast[];
  isOffline: boolean;
  isSidebarCollapsed: boolean;
  isSidebarOpen: boolean;

  addToast: (type: ToastType, message: string) => void;
  removeToast: (id: string) => void;
  setOffline: (offline: boolean) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

export type { Toast, ToastType };

export const useUIStore = create<UIState>((set, get) => {
  const store: UIState = {
    toasts: [],
    isOffline: false,
    isSidebarCollapsed: localStorage.getItem(SIDEBAR_KEY) === 'true',
    isSidebarOpen: false,

    addToast: (type, message) => {
      const id = crypto.randomUUID();
      const autoDismiss = type !== 'error';
      const toast: Toast = { id, type, message, autoDismiss };

      set((state) => {
        let toasts = [...state.toasts, toast];
        // Enforce max 5 — remove oldest when exceeded
        if (toasts.length > MAX_TOASTS) {
          toasts = toasts.slice(toasts.length - MAX_TOASTS);
        }
        return { toasts };
      });

      // Auto-dismiss success toasts after 5s
      if (autoDismiss) {
        setTimeout(() => {
          get().removeToast(id);
        }, AUTO_DISMISS_MS);
      }
    },

    removeToast: (id) => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    },

    setOffline: (offline) => set({ isOffline: offline }),

    toggleSidebar: () => {
      set((state) => {
        const isSidebarCollapsed = !state.isSidebarCollapsed;
        localStorage.setItem(SIDEBAR_KEY, String(isSidebarCollapsed));
        return { isSidebarCollapsed };
      });
    },

    setSidebarOpen: (open) => set({ isSidebarOpen: open }),
  };

  // Connect to API client so interceptors can fire toasts
  connectUIStore({ addToast: (type: string, message: string) => store.addToast(type as ToastType, message) });

  return store;
});
