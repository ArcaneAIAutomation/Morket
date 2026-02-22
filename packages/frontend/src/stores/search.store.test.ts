import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSearchStore } from './search.store';

// Mock the search API
vi.mock('@/api/search.api', () => ({
  searchRecords: vi.fn(),
  fetchSuggestions: vi.fn(),
  triggerReindex: vi.fn(),
  getReindexStatus: vi.fn(),
}));

import * as searchApi from '@/api/search.api';

describe('search.store', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useSearchStore.getState().reset();
  });

  it('has correct initial state', () => {
    const state = useSearchStore.getState();
    expect(state.query).toBe('');
    expect(state.filters).toEqual({});
    expect(state.sort).toEqual({ field: '_score', direction: 'desc' });
    expect(state.page).toBe(1);
    expect(state.pageSize).toBe(20);
    expect(state.results).toEqual([]);
    expect(state.totalResults).toBe(0);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.suggestions).toEqual([]);
  });

  it('setQuery updates query', () => {
    useSearchStore.getState().setQuery('test query');
    expect(useSearchStore.getState().query).toBe('test query');
  });

  describe('executeSearch', () => {
    it('sets loading, calls API, and updates results', async () => {
      const mockResponse = {
        data: [{ record_id: 'r1', document_type: 'contact', score: 5 }],
        meta: {
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
          executionTimeMs: 42,
          facets: { document_type: [{ value: 'contact', count: 1 }] },
        },
      };
      (searchApi.searchRecords as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      useSearchStore.getState().setQuery('Jane');
      await useSearchStore.getState().executeSearch('ws-1');

      const state = useSearchStore.getState();
      expect(state.loading).toBe(false);
      expect(state.results).toEqual(mockResponse.data);
      expect(state.totalResults).toBe(1);
      expect(state.totalPages).toBe(1);
      expect(state.executionTimeMs).toBe(42);
      expect(state.facets).toEqual(mockResponse.meta.facets);
      expect(state.error).toBeNull();
    });

    it('sets error on API failure', async () => {
      (searchApi.searchRecords as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error'),
      );

      await useSearchStore.getState().executeSearch('ws-1');

      const state = useSearchStore.getState();
      expect(state.loading).toBe(false);
      expect(state.error).toBe('Network error');
      expect(state.results).toEqual([]);
    });
  });

  describe('fetchSuggestions', () => {
    it('fetches suggestions for prefix >= 2 chars', async () => {
      (searchApi.fetchSuggestions as ReturnType<typeof vi.fn>).mockResolvedValue([
        'Jane Doe',
        'Jane Smith',
      ]);

      await useSearchStore.getState().fetchSuggestions('ws-1', 'Ja');

      const state = useSearchStore.getState();
      expect(state.suggestions).toEqual(['Jane Doe', 'Jane Smith']);
      expect(state.suggestionsLoading).toBe(false);
    });

    it('clears suggestions for prefix < 2 chars', async () => {
      useSearchStore.setState({ suggestions: ['old'] });
      await useSearchStore.getState().fetchSuggestions('ws-1', 'J');

      expect(useSearchStore.getState().suggestions).toEqual([]);
    });

    it('clears suggestions on error', async () => {
      (searchApi.fetchSuggestions as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('fail'),
      );

      await useSearchStore.getState().fetchSuggestions('ws-1', 'Ja');

      expect(useSearchStore.getState().suggestions).toEqual([]);
      expect(useSearchStore.getState().suggestionsLoading).toBe(false);
    });
  });

  describe('toggleFacet', () => {
    it('adds a facet value when not present', () => {
      useSearchStore.getState().toggleFacet('document_type', 'contact');

      const filters = useSearchStore.getState().filters;
      expect(filters.document_type).toEqual(['contact']);
    });

    it('removes a facet value when already present', () => {
      useSearchStore.setState({ filters: { document_type: ['contact', 'company'] } });
      useSearchStore.getState().toggleFacet('document_type', 'contact');

      const filters = useSearchStore.getState().filters;
      expect(filters.document_type).toEqual(['company']);
    });

    it('removes the filter key when last value is toggled off', () => {
      useSearchStore.setState({ filters: { document_type: ['contact'] } });
      useSearchStore.getState().toggleFacet('document_type', 'contact');

      const filters = useSearchStore.getState().filters;
      expect(filters.document_type).toBeUndefined();
    });

    it('resets page to 1 on facet toggle', () => {
      useSearchStore.setState({ page: 5 });
      useSearchStore.getState().toggleFacet('document_type', 'contact');

      expect(useSearchStore.getState().page).toBe(1);
    });
  });

  describe('setSort', () => {
    it('updates sort and resets page', () => {
      useSearchStore.setState({ page: 3 });
      useSearchStore.getState().setSort({ field: 'created_at', direction: 'asc' });

      const state = useSearchStore.getState();
      expect(state.sort).toEqual({ field: 'created_at', direction: 'asc' });
      expect(state.page).toBe(1);
    });
  });

  describe('setPage', () => {
    it('updates page number', () => {
      useSearchStore.getState().setPage(3);
      expect(useSearchStore.getState().page).toBe(3);
    });
  });

  describe('clearFilters', () => {
    it('clears all filters and resets page', () => {
      useSearchStore.setState({
        filters: { document_type: ['contact'], tags: ['vip'] },
        page: 5,
      });
      useSearchStore.getState().clearFilters();

      const state = useSearchStore.getState();
      expect(state.filters).toEqual({});
      expect(state.page).toBe(1);
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', () => {
      useSearchStore.setState({
        query: 'test',
        results: [{ record_id: 'r1' }] as never[],
        totalResults: 100,
        loading: true,
        error: 'some error',
      });

      useSearchStore.getState().reset();

      const state = useSearchStore.getState();
      expect(state.query).toBe('');
      expect(state.results).toEqual([]);
      expect(state.totalResults).toBe(0);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });
  });
});
