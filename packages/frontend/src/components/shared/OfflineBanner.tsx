import { useUIStore } from '@/stores/ui.store';

export default function OfflineBanner() {
  const isOffline = useUIStore((s) => s.isOffline);
  if (!isOffline) return null;
  return (
    <div
      className="bg-yellow-100 border-b border-yellow-300 text-yellow-800 text-sm text-center py-2 px-4"
      role="alert"
    >
      You are offline. Some features are unavailable.
    </div>
  );
}
