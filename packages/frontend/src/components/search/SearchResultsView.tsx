import { useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useSearch } from '@/hooks/useSearch';
import SearchResultCard from './SearchResultCard';
import FacetSidebar from './FacetSidebar';
import SearchPagination from './SearchPagination';
import type { SearchResult, SearchSort } from '@/types/search.types';
import { sanitizeHtml } from '@/utils/sanitize';

const SORT_OPTIONS: { label: string; value: SearchSort }[] = [
  { label: 'Relevance', value: { field: '_score', direction: 'desc' } },
  { label: 'Newest First', value: { field: 'created_at', direction: 'desc' } },
  { label: 'Oldest First', value: { field: 'created_at', direction: 'asc' } },
  { label: 'Name (A-Z)', value: { field: 'name', direction: 'asc' } },
];

export default function SearchResultsView() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const search = useSearch(workspaceId ?? '');

  // Initialize query from URL params on mount
  useEffect(() => {
    const q = searchParams.get('q') ?? '';
    if (q && q !== search.query) {
      search.setQuery(q);
    }
    if (workspaceId) {
      search.executeSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  function handleResultClick(result: SearchResult) {
    if (!workspaceId) return;
    switch (result.document_type) {
      case 'enrichment_record':
        navigate(`/workspaces/${workspaceId}/enrichment-records/${result.record_id}`);
        break;
      case 'contact':
      case 'company':
        navigate(`/workspaces/${workspaceId}/spreadsheet?record=${result.record_id}`);
        break;
      case 'scrape_result':
        navigate(`/workspaces/${workspaceId}/scrape-results/${result.record_id}`);
        break;
    }
  }

  function handleSortChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const option = SORT_OPTIONS[parseInt(e.target.value, 10)];
    if (option) {
      search.setSort(option.value);
      if (workspaceId) search.executeSearch();
    }
  }

  const currentSortIndex = SORT_OPTIONS.findIndex(
    (o) => o.value.field === search.sort.field && o.value.direction === search.sort.direction,
  );

  return (
    <div className="flex gap-6 p-6">
      {/* Facet sidebar */}
      <FacetSidebar
        facets={search.facets}
        filters={search.filters}
        onToggle={search.toggleFacet}
        onClear={search.clearFilters}
      />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Header: result count, execution time, sort */}
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-gray-500">
            {search.loading ? (
              'Searching...'
            ) : (
              <>
                {search.totalResults.toLocaleString()} results
                {search.executionTimeMs > 0 && (
                  <span className="ml-1">({search.executionTimeMs}ms)</span>
                )}
              </>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            Sort by
            <select
              value={currentSortIndex >= 0 ? currentSortIndex : 0}
              onChange={handleSortChange}
              className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {SORT_OPTIONS.map((option, i) => (
                <option key={option.label} value={i}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Loading skeleton */}
        {search.loading && (
          <div className="space-y-3" aria-label="Loading search results">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-4 border border-gray-200 rounded-lg animate-pulse">
                <div className="flex items-start gap-3">
                  <div className="h-6 w-6 bg-gray-200 rounded" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-1/3" />
                    <div className="h-3 bg-gray-200 rounded w-1/2" />
                    <div className="h-3 bg-gray-200 rounded w-1/4" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error state */}
        {!search.loading && search.error && (
          <div className="text-center py-8" role="alert">
            <p className="text-red-500 text-sm">{search.error}</p>
            <button
              onClick={() => search.executeSearch()}
              className="mt-4 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              Retry
            </button>
          </div>
        )}

        {/* Results */}
        {!search.loading && !search.error && search.results.length > 0 && (
          <div className="space-y-3">
            {search.results.map((result) => (
              <SearchResultCard
                key={result.record_id}
                result={result}
                onClick={handleResultClick}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!search.loading && !search.error && search.results.length === 0 && search.query && (
          <div className="text-center py-12">
            <p className="text-gray-500 text-sm">
              No results found for &quot;{sanitizeHtml(search.query)}&quot;
            </p>
            <p className="text-gray-400 text-xs mt-2">
              Try broadening your search or removing some filters
            </p>
          </div>
        )}

        {/* Pagination */}
        {!search.loading && !search.error && search.totalPages > 1 && (
          <SearchPagination
            page={search.page}
            totalPages={search.totalPages}
            totalResults={search.totalResults}
            onPageChange={search.setPage}
          />
        )}
      </div>
    </div>
  );
}
