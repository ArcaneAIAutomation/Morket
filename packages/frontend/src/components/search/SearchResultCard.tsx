import type { SearchResult } from '@/types/search.types';

const TYPE_ICONS: Record<string, string> = {
  enrichment_record: '🔗',
  contact: '👤',
  company: '🏢',
  scrape_result: '🌐',
};

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-100 text-green-800',
  pending: 'bg-yellow-100 text-yellow-800',
  failed: 'bg-red-100 text-red-800',
};

interface SearchResultCardProps {
  result: SearchResult;
  onClick?: (result: SearchResult) => void;
}

export default function SearchResultCard({ result, onClick }: SearchResultCardProps) {
  const icon = TYPE_ICONS[result.document_type] ?? '📄';
  const displayName = result.name ?? result.email ?? result.company ?? 'Untitled';

  function renderHighlight(field: string, fallback: string | null) {
    const fragments = result.highlights?.[field];
    if (fragments && fragments.length > 0) {
      return (
        <span dangerouslySetInnerHTML={{ __html: fragments[0] }} />
      );
    }
    return <span>{fallback}</span>;
  }

  return (
    <button
      type="button"
      className="w-full text-left p-4 border border-gray-200 rounded-lg hover:border-indigo-300 hover:shadow-sm transition-colors"
      onClick={() => onClick?.(result)}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0" aria-hidden="true">{icon}</span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-medium text-gray-900 truncate">
              {renderHighlight('name', displayName)}
            </h3>

            {result.provider_slug && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                {result.provider_slug}
              </span>
            )}

            {result.enrichment_status && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[result.enrichment_status] ?? 'bg-gray-100 text-gray-800'}`}>
                {result.enrichment_status}
              </span>
            )}
          </div>

          {/* Highlighted fields */}
          <div className="text-sm text-gray-600 space-y-0.5">
            {(result.company || result.highlights?.company) && (
              <p className="truncate">{renderHighlight('company', result.company)}</p>
            )}
            {(result.job_title || result.highlights?.job_title) && (
              <p className="truncate">{renderHighlight('job_title', result.job_title)}</p>
            )}
            {(result.location || result.highlights?.location) && (
              <p className="truncate text-gray-500">{renderHighlight('location', result.location)}</p>
            )}
          </div>

          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
            <span>{result.document_type.replace('_', ' ')}</span>
            <span>{new Date(result.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </button>
  );
}
