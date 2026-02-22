import { useEffect } from 'react';
import { useUIStore } from '@/stores/ui.store';

export function useOnlineStatus() {
  const setOffline = useUIStore((s) => s.setOffline);

  useEffect(() => {
    // Sync initial state
    setOffline(!navigator.onLine);

    const handleOnline = () => setOffline(false);
    const handleOffline = () => setOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setOffline]);
}
