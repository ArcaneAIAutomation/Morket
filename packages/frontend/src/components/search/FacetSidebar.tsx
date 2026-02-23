import type { FacetBucket, SearchFilters } from '@/types/search.types';
import { sanitizeHtml } from '@/utils/sanitize';

const FACET_LABELS: Record<string, string> = {
  document_type: 'Document Type',
  provider_slug: 'Provider',
  enrichment_status: 'Status',
  scrape_target_type: 'Target Type',
  tags: 'Tags',
};

interface FacetSidebarProps {
  facets: Record<string, FacetBucket[]>;
  filters: SearchFilters;
  onToggle: (field: string, value: string) => void;
  onClear: () => void;
}

export default function FacetSidebar({ facets, filters, onToggle, onClear }: FacetSidebarProps) {
  const hasActiveFilters = Object.values(filters).some(
    (v) => Array.isArray(v) && v.length > 0,
  );

  return (
    <aside className="w-64 flex-shrink-0" aria-label="Search filters">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700">Filters</h2>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-indigo-600 hover:text-indigo-800"
          >
            Clear all
          </button>
        )}
      </div>

      {Object.entries(facets).map(([field, buckets]) => {
        if (!buckets || buckets.length === 0) return null;

        const activeValues = (filters as Record<string, string[] | undefined>)[field] ?? [];

        return (
          <fieldset key={field} className="mb-4">
            <legend className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
              {FACET_LABELS[field] ?? field}
            </legend>
            <div className="space-y-1">
              {buckets.map((bucket) => {
                const isActive = activeValues.includes(bucket.value);
                return (
                  <label
                    key={bucket.value}
                    className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 hover:text-gray-900"
                  >
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={() => onToggle(field, bucket.value)}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="truncate flex-1">{sanitizeHtml(bucket.value.replace('_', ' '))}</span>
                    <span className="text-xs text-gray-400">{bucket.count}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </aside>
  );
}
