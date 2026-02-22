import { useEffect, useRef, useCallback } from 'react';
import { useGridStore } from '@/stores/grid.store';
import { useUIStore } from '@/stores/ui.store';

const AUTO_SAVE_INTERVAL_MS = 30_000;

export function useAutoSave(workspaceId: string | null) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSavingRef = useRef(false);

  const save = useCallback(async () => {
    if (!workspaceId) return;
    if (isSavingRef.current) return;

    const { isDirty, saveChanges } = useGridStore.getState();
    const { isOffline, addToast } = useUIStore.getState();

    if (!isDirty || isOffline) return;

    isSavingRef.current = true;
    try {
      await saveChanges(workspaceId);
    } catch {
      addToast('error', 'Auto-save failed. Your changes are still pending.');
    } finally {
      isSavingRef.current = false;
    }
  }, [workspaceId]);

  useEffect(() => {
    intervalRef.current = setInterval(save, AUTO_SAVE_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [save]);
}
