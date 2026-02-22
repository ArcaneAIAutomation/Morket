import { useEffect, useMemo } from 'react';
import { useJobStore } from '@/stores/job.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useUIStore } from '@/stores/ui.store';
import { useJobPolling } from '@/hooks/useJobPolling';
import { formatNumber, formatCredits, formatPercent } from '@/utils/formatters';
import { JobRow } from './JobRow';

export function JobMonitor() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const jobs = useJobStore((s) => s.jobs);
  const summary = useJobStore((s) => s.summary);
  const isLoading = useJobStore((s) => s.isLoading);
  const fetchJobs = useJobStore((s) => s.fetchJobs);
  const addToast = useUIStore((s) => s.addToast);

  // Start polling for running jobs
  useJobPolling();

  // Fetch jobs on mount
  useEffect(() => {
    if (!activeWorkspaceId) return;
    fetchJobs(activeWorkspaceId).catch(() => {
      addToast('error', 'Failed to load enrichment jobs.');
    });
  }, [activeWorkspaceId, fetchJobs, addToast]);

  // Sort jobs by createdAt descending
  const sortedJobs = useMemo(
    () => [...jobs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [jobs],
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Enrichment Jobs</h1>

      {/* Summary card */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Total Jobs" value={formatNumber(summary.totalJobs)} />
        <SummaryCard label="Records Enriched" value={formatNumber(summary.totalRecordsEnriched)} />
        <SummaryCard label="Credits Consumed" value={formatCredits(summary.totalCreditsConsumed)} />
        <SummaryCard label="Success Rate" value={formatPercent(summary.successRate)} />
      </div>

      {/* Job list */}
      <div className="space-y-2">
        {isLoading && jobs.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : sortedJobs.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No enrichment jobs yet. Select records and run an enrichment to get started.
          </div>
        ) : (
          sortedJobs.map((job) => <JobRow key={job.id} job={job} />)
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-lg font-semibold text-gray-900 mt-1">{value}</p>
    </div>
  );
}
