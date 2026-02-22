import { useCallback, useRef } from 'react';
import { useSearchStore } from '@/stores/search.store';

const DEBOUNCE_MS = 200;

/**
 * Custom hook wrapping the search store with debounced suggestion fetching.
 */
export function useSearch(workspaceId: string) {
  const store = useSearchStore();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleQueryChange = useCallback(
    (value: string) => {
      store.setQuery(value);

      // Debounce suggestion fetching
      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (value.length >= 2) {
        debounceRef.current = setTimeout(() => {
          store.fetchSuggestions(workspaceId, value);
        }, DEBOUNCE_MS);
      } else {
        useSearchStore.setState({ suggestions: [], suggestionsLoading: false });
      }
    },
    [workspaceId, store],
  );

  const executeSearch = useCallback(() => {
    store.executeSearch(workspaceId);
  }, [workspaceId, store]);

  const toggleFacet = useCallback(
    (field: string, value: string) => {
      store.toggleFacet(field, value);
      // Auto-execute search after facet toggle
      setTimeout(() => useSearchStore.getState().executeSearch(workspaceId), 0);
    },
    [workspaceId, store],
  );

  const setPage = useCallback(
    (page: number) => {
      store.setPage(page);
      store.executeSearch(workspaceId);
    },
    [workspaceId, store],
  );

  return {
    // State
    query: store.query,
    results: store.results,
    totalResults: store.totalResults,
    totalPages: store.totalPages,
    facets: store.facets,
    executionTimeMs: store.executionTimeMs,
    suggestions: store.suggestions,
    suggestionsLoading: store.suggestionsLoading,
    loading: store.loading,
    error: store.error,
    filters: store.filters,
    sort: store.sort,
    page: store.page,
    pageSize: store.pageSize,

    // Actions
    setQuery: handleQueryChange,
    executeSearch,
    toggleFacet,
    setSort: store.setSort,
    setPage,
    clearFilters: store.clearFilters,
    reset: store.reset,
  };
}
