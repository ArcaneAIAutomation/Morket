import type { ICellRendererParams } from 'ag-grid-community';
import type { CellEnrichmentStatus, RecordRow } from '@/types/grid.types';
import { sanitizeHtml } from '@/utils/sanitize';

const STATUS_COLORS: Record<CellEnrichmentStatus, string> = {
  enriched: 'bg-green-500',
  pending: 'bg-yellow-400',
  failed: 'bg-red-500',
  empty: 'bg-gray-300',
};

export default function CellRenderer(props: ICellRendererParams) {
  const row = props.data as RecordRow | undefined;
  const field = props.colDef?.field;
  const value = props.value;

  let status: CellEnrichmentStatus = 'empty';
  if (row && field && row._enrichmentStatus?.[field]) {
    status = row._enrichmentStatus[field];
  }

  return (
    <div className="flex items-center gap-1.5 h-full overflow-hidden">
      <span
        className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLORS[status]}`}
        aria-label={`Enrichment status: ${status}`}
      />
      <span className="truncate">{value != null ? sanitizeHtml(String(value)) : ''}</span>
    </div>
  );
}
