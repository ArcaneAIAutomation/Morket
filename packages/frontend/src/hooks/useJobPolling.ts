import { useEffect, useRef } from 'react';
import { useJobStore } from '@/stores/job.store';
import { useGridStore } from '@/stores/grid.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useUIStore } from '@/stores/ui.store';
import type { JobStatus } from '@/types/enrichment.types';

const TERMINAL_STATUSES: Set<JobStatus> = new Set([
  'completed',
  'failed',
  'partially_completed',
  'cancelled',
]);

const STATUS_MESSAGES: Partial<Record<JobStatus, { type: 'success' | 'error' | 'warning'; message: string }>> = {
  completed: { type: 'success', message: 'Enrichment job completed successfully.' },
  failed: { type: 'error', message: 'Enrichment job failed.' },
  partially_completed: { type: 'warning', message: 'Enrichment job partially completed.' },
  cancelled: { type: 'info' as 'warning', message: 'Enrichment job was cancelled.' },
};

/**
 * Starts polling for all running/pending jobs on mount.
 * Detects state transitions to terminal states, fires toasts,
 * fetches job records, and updates grid cells with enrichment results.
 * Stops all polling on unmount.
 */
export function useJobPolling() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const jobs = useJobStore((s) => s.jobs);
  const startPolling = useJobStore((s) => s.startPolling);
  const stopPolling = useJobStore((s) => s.stopPolling);
  const activePollingJobIds = useJobStore((s) => s.activePollingJobIds);
  const fetchJobRecords = useJobStore((s) => s.fetchJobRecords);
  const addToast = useUIStore((s) => s.addToast);
  const bulkUpdateEnrichmentStatus = useGridStore((s) => s.bulkUpdateEnrichmentStatus);

  // Track previous job statuses to detect transitions
  const prevStatusRef = useRef<Map<string, JobStatus>>(new Map());

  // Start polling for running/pending jobs on mount
  useEffect(() => {
    if (!activeWorkspaceId) return;

    for (const job of jobs) {
      const isActive = job.status === 'running' || job.status === 'pending';
      if (isActive && !activePollingJobIds.has(job.id)) {
        startPolling(activeWorkspaceId, job.id);
      }
    }
  }, [activeWorkspaceId, jobs, activePollingJobIds, startPolling]);

  // Detect state transitions → toast + fetch records + update grid
  useEffect(() => {
    if (!activeWorkspaceId) return;

    const prevMap = prevStatusRef.current;

    for (const job of jobs) {
      const prevStatus = prevMap.get(job.id);

      // Only fire on actual transition (not initial load)
      if (prevStatus && prevStatus !== job.status && TERMINAL_STATUSES.has(job.status)) {
        // Show toast
        const msg = STATUS_MESSAGES[job.status];
        if (msg) {
          addToast(msg.type, msg.message);
        }

        // Fetch records and update grid cells
        fetchJobRecords(activeWorkspaceId, job.id)
          .then((records) => {
            const updates = records.map((r) => ({
              recordId: r.id,
              field: r.providerSlug,
              status: r.status === 'success' ? ('enriched' as const) : ('failed' as const),
              value: r.outputData ?? undefined,
            }));
            if (updates.length > 0) {
              bulkUpdateEnrichmentStatus(updates);
            }
          })
          .catch(() => {
            // Silently ignore — records can be fetched later via expand
          });
      }

      prevMap.set(job.id, job.status);
    }
  }, [jobs, activeWorkspaceId, addToast, fetchJobRecords, bulkUpdateEnrichmentStatus]);

  // Stop all polling on unmount
  useEffect(() => {
    return () => {
      const currentPollingIds = useJobStore.getState().activePollingJobIds;
      for (const jobId of currentPollingIds) {
        stopPolling(jobId);
      }
    };
  }, [stopPolling]);
}
