import type { EnrichmentRecord } from '@/types/enrichment.types';
import { formatCredits } from '@/utils/formatters';

interface JobRecordDetailProps {
  record: EnrichmentRecord;
}

const RECORD_STATUS_CONFIG: Record<
  EnrichmentRecord['status'],
  { label: string; className: string }
> = {
  success: { label: 'Success', className: 'text-green-700 bg-green-100' },
  failed: { label: 'Failed', className: 'text-red-700 bg-red-100' },
  skipped: { label: 'Skipped', className: 'text-gray-600 bg-gray-100' },
};

export function JobRecordDetail({ record }: JobRecordDetailProps) {
  const statusCfg = RECORD_STATUS_CONFIG[record.status];

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded text-sm bg-gray-50">
      {/* Status badge */}
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusCfg.className}`}
      >
        {statusCfg.label}
      </span>

      {/* Provider */}
      <span className="text-gray-700">{record.providerSlug}</span>

      {/* Credits consumed */}
      <span className="text-gray-500 ml-auto">{formatCredits(record.creditsConsumed)}</span>

      {/* Error reason */}
      {record.errorReason && (
        <span className="text-red-600 text-xs truncate max-w-xs" title={record.errorReason}>
          {record.errorReason}
        </span>
      )}
    </div>
  );
}
