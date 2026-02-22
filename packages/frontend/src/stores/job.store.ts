import { create } from 'zustand';
import type { EnrichmentJob, EnrichmentRecord, JobStatus } from '@/types/enrichment.types';
import * as enrichmentApi from '@/api/enrichment.api';

const POLL_INTERVAL_MS = 5_000;

const TERMINAL_STATUSES: Set<JobStatus> = new Set([
  'completed',
  'failed',
  'partially_completed',
  'cancelled',
]);

/** External map so interval IDs survive across Zustand immutable updates. */
const pollingIntervals = new Map<string, ReturnType<typeof setInterval>>();

function computeSummary(jobs: EnrichmentJob[]) {
  const totalJobs = jobs.length;
  let totalRecordsEnriched = 0;
  let totalCreditsConsumed = 0;
  let totalRecords = 0;

  for (const job of jobs) {
    totalRecordsEnriched += job.completedRecords;
    totalRecords += job.totalRecords;
    if (TERMINAL_STATUSES.has(job.status)) {
      totalCreditsConsumed += job.estimatedCredits;
    }
  }

  const successRate = totalRecords > 0 ? totalRecordsEnriched / totalRecords : 0;

  return { totalJobs, totalRecordsEnriched, totalCreditsConsumed, successRate };
}

interface JobState {
  jobs: EnrichmentJob[];
  activePollingJobIds: Set<string>;
  summary: {
    totalJobs: number;
    totalRecordsEnriched: number;
    totalCreditsConsumed: number;
    successRate: number;
  };
  isLoading: boolean;

  fetchJobs: (workspaceId: string) => Promise<void>;
  fetchJobRecords: (workspaceId: string, jobId: string) => Promise<EnrichmentRecord[]>;
  cancelJob: (workspaceId: string, jobId: string) => Promise<void>;
  startPolling: (workspaceId: string, jobId: string) => void;
  stopPolling: (jobId: string) => void;
}

export const useJobStore = create<JobState>((set, get) => ({
  jobs: [],
  activePollingJobIds: new Set(),
  summary: { totalJobs: 0, totalRecordsEnriched: 0, totalCreditsConsumed: 0, successRate: 0 },
  isLoading: false,

  fetchJobs: async (workspaceId) => {
    set({ isLoading: true });
    try {
      const jobs = await enrichmentApi.getEnrichmentJobs(workspaceId);
      set({ jobs, summary: computeSummary(jobs), isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  fetchJobRecords: async (workspaceId, jobId) => {
    return enrichmentApi.getJobRecords(workspaceId, jobId);
  },

  cancelJob: async (workspaceId, jobId) => {
    await enrichmentApi.cancelEnrichmentJob(workspaceId, jobId);
    get().stopPolling(jobId);
    set((state) => {
      const jobs = state.jobs.map((j) =>
        j.id === jobId ? { ...j, status: 'cancelled' as const } : j,
      );
      return { jobs, summary: computeSummary(jobs) };
    });
  },

  startPolling: (workspaceId, jobId) => {
    // Don't double-poll
    if (pollingIntervals.has(jobId)) return;

    const activePollingJobIds = new Set(get().activePollingJobIds);
    activePollingJobIds.add(jobId);
    set({ activePollingJobIds });

    const intervalId = setInterval(async () => {
      try {
        const job = await enrichmentApi.getEnrichmentJob(workspaceId, jobId);
        set((state) => {
          const jobs = state.jobs.map((j) => (j.id === jobId ? job : j));
          return { jobs, summary: computeSummary(jobs) };
        });

        if (TERMINAL_STATUSES.has(job.status)) {
          get().stopPolling(jobId);
        }
      } catch {
        // Silently ignore polling errors — next tick will retry
      }
    }, POLL_INTERVAL_MS);

    pollingIntervals.set(jobId, intervalId);
  },

  stopPolling: (jobId) => {
    const intervalId = pollingIntervals.get(jobId);
    if (intervalId) {
      clearInterval(intervalId);
      pollingIntervals.delete(jobId);
    }
    set((state) => {
      const activePollingJobIds = new Set(state.activePollingJobIds);
      activePollingJobIds.delete(jobId);
      return { activePollingJobIds };
    });
  },
}));
