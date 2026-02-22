import { useState, useCallback } from 'react';
import type { EnrichmentJob, EnrichmentRecord, JobStatus } from '@/types/enrichment.types';
import { useJobStore } from '@/stores/job.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useUIStore } from '@/stores/ui.store';
import { formatCredits, formatDateTime } from '@/utils/formatters';
import { JobRecordDetail } from './JobRecordDetail';

interface JobRowProps {
  job: EnrichmentJob;
}

const STATUS_CONFIG: Record<JobStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-gray-100 text-gray-700' },
  running: { label: 'Running', className: 'bg-blue-100 text-blue-700' },
  completed: { label: 'Completed', className: 'bg-green-100 text-green-700' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
  partially_completed: { label: 'Partial', className: 'bg-yellow-100 text-yellow-700' },
  cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-500' },
};

export function JobRow({ job }: JobRowProps) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const fetchJobRecords = useJobStore((s) => s.fetchJobRecords);
  const cancelJob = useJobStore((s) => s.cancelJob);
  const addToast = useUIStore((s) => s.addToast);

  const [expanded, setExpanded] = useState(false);
  const [records, setRecords] = useState<EnrichmentRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const progressPercent =
    job.totalRecords > 0
      ? Math.round((job.completedRecords / job.totalRecords) * 100)
      : 0;

  const statusCfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.pending;
  const isRunning = job.status === 'running' || job.status === 'pending';

  const handleToggle = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (!activeWorkspaceId) return;

    setExpanded(true);
    setLoadingRecords(true);
    try {
      const data = await fetchJobRecords(activeWorkspaceId, job.id);
      setRecords(data);
    } catch {
      addToast('error', 'Failed to load job records.');
    } finally {
      setLoadingRecords(false);
    }
  }, [expanded, activeWorkspaceId, fetchJobRecords, job.id, addToast]);

  const handleCancel = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!activeWorkspaceId) return;
      setCancelling(true);
      try {
        await cancelJob(activeWorkspaceId, job.id);
        addToast('info', `Job ${job.id} cancelled.`);
      } catch {
        addToast('error', 'Failed to cancel job.');
      } finally {
        setCancelling(false);
      }
    },
    [activeWorkspaceId, cancelJob, job.id, addToast],
  );

  return (
    <div className="border border-gray-200 rounded-lg bg-white">
      {/* Header row — clickable to expand */}
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        {/* Expand chevron */}
        <span
          className={`text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          ▶
        </span>

        {/* Status badge */}
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusCfg.className}`}
        >
          {statusCfg.label}
        </span>

        {/* Progress bar */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 whitespace-nowrap">
              {job.completedRecords}/{job.totalRecords}
            </span>
          </div>
        </div>

        {/* Credits */}
        <span className="text-xs text-gray-500 whitespace-nowrap">
          {formatCredits(job.estimatedCredits)}
        </span>

        {/* Timestamp */}
        <span className="text-xs text-gray-400 whitespace-nowrap">
          {formatDateTime(job.createdAt)}
        </span>

        {/* Cancel button for running jobs */}
        {isRunning && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            className="px-2 py-1 text-xs font-medium text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </button>

      {/* Expanded record details */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3">
          {loadingRecords ? (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
            </div>
          ) : records.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-2">No record details available.</p>
          ) : (
            <div className="space-y-1">
              {records.map((record) => (
                <JobRecordDetail key={record.id} record={record} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
