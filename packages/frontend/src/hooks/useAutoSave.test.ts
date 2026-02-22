import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAutoSave } from './useAutoSave';
import { useGridStore } from '@/stores/grid.store';
import { useUIStore } from '@/stores/ui.store';

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls saveChanges after 30s when dirty', async () => {
    const saveChanges = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useGridStore, 'getState').mockReturnValue({
      ...useGridStore.getState(),
      isDirty: true,
      saveChanges,
    });
    vi.spyOn(useUIStore, 'getState').mockReturnValue({
      ...useUIStore.getState(),
      isOffline: false,
      addToast: vi.fn(),
    });

    renderHook(() => useAutoSave('ws-1'));

    expect(saveChanges).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(saveChanges).toHaveBeenCalledWith('ws-1');
  });

  it('does not call saveChanges when not dirty', async () => {
    const saveChanges = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useGridStore, 'getState').mockReturnValue({
      ...useGridStore.getState(),
      isDirty: false,
      saveChanges,
    });
    vi.spyOn(useUIStore, 'getState').mockReturnValue({
      ...useUIStore.getState(),
      isOffline: false,
      addToast: vi.fn(),
    });

    renderHook(() => useAutoSave('ws-1'));

    await vi.advanceTimersByTimeAsync(30_000);

    expect(saveChanges).not.toHaveBeenCalled();
  });

  it('pauses when offline', async () => {
    const saveChanges = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useGridStore, 'getState').mockReturnValue({
      ...useGridStore.getState(),
      isDirty: true,
      saveChanges,
    });
    vi.spyOn(useUIStore, 'getState').mockReturnValue({
      ...useUIStore.getState(),
      isOffline: true,
      addToast: vi.fn(),
    });

    renderHook(() => useAutoSave('ws-1'));

    await vi.advanceTimersByTimeAsync(30_000);

    expect(saveChanges).not.toHaveBeenCalled();
  });

  it('shows toast on save failure', async () => {
    const saveChanges = vi.fn().mockRejectedValue(new Error('Network error'));
    const addToast = vi.fn();
    vi.spyOn(useGridStore, 'getState').mockReturnValue({
      ...useGridStore.getState(),
      isDirty: true,
      saveChanges,
    });
    vi.spyOn(useUIStore, 'getState').mockReturnValue({
      ...useUIStore.getState(),
      isOffline: false,
      addToast,
    });

    renderHook(() => useAutoSave('ws-1'));

    await vi.advanceTimersByTimeAsync(30_000);

    expect(addToast).toHaveBeenCalledWith('error', 'Auto-save failed. Your changes are still pending.');
  });

  it('does not call saveChanges when workspaceId is null', async () => {
    const saveChanges = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useGridStore, 'getState').mockReturnValue({
      ...useGridStore.getState(),
      isDirty: true,
      saveChanges,
    });

    renderHook(() => useAutoSave(null));

    await vi.advanceTimersByTimeAsync(30_000);

    expect(saveChanges).not.toHaveBeenCalled();
  });

  it('cleans up interval on unmount', async () => {
    const saveChanges = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useGridStore, 'getState').mockReturnValue({
      ...useGridStore.getState(),
      isDirty: true,
      saveChanges,
    });
    vi.spyOn(useUIStore, 'getState').mockReturnValue({
      ...useUIStore.getState(),
      isOffline: false,
      addToast: vi.fn(),
    });

    const { unmount } = renderHook(() => useAutoSave('ws-1'));

    unmount();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(saveChanges).not.toHaveBeenCalled();
  });
});
