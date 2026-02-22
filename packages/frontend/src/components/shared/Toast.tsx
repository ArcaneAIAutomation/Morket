import { useUIStore } from '@/stores/ui.store';
import type { Toast as ToastType } from '@/stores/ui.store';

const TOAST_COLORS: Record<string, string> = {
  success: 'bg-green-50 border-green-400 text-green-800',
  error: 'bg-red-50 border-red-400 text-red-800',
  warning: 'bg-yellow-50 border-yellow-400 text-yellow-800',
  info: 'bg-blue-50 border-blue-400 text-blue-800',
};

function ToastItem({ toast }: { toast: ToastType }) {
  const removeToast = useUIStore((s) => s.removeToast);
  return (
    <div
      className={`flex items-center justify-between border-l-4 p-3 rounded shadow-md ${TOAST_COLORS[toast.type] ?? ''}`}
      role="alert"
    >
      <span className="text-sm">{toast.message}</span>
      <button
        onClick={() => removeToast(toast.id)}
        className="ml-3 text-lg leading-none opacity-60 hover:opacity-100"
        aria-label="Dismiss notification"
      >
        &times;
      </button>
    </div>
  );
}

export default function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80" aria-live="polite">
      {toasts.map((t) => <ToastItem key={t.id} toast={t} />)}
    </div>
  );
}
