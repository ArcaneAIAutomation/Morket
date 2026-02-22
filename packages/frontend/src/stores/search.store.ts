import { create } from 'zustand';
import type {
  SearchFilters,
  SearchSort,
  SearchResult,
  FacetBucket,
} from '@/types/search.types';
import * as searchApi from '@/api/search.api';

export interface SearchState {
  // Query state
  query: string;
  filters: SearchFilters;
  sort: SearchSort;
  page: number;
  pageSize: number;

  // Results
  results: SearchResult[];
  totalResults: number;
  totalPages: number;
  facets: Record<string, FacetBucket[]>;
  executionTimeMs: number;

  // Suggestions
  suggestions: string[];
  suggestionsLoading: boolean;

  // Loading
  loading: boolean;
  error: string | null;

  // Actions
  setQuery: (query: string) => void;
  executeSearch: (workspaceId: string) => Promise<void>;
  fetchSuggestions: (workspaceId: string, prefix: string) => Promise<void>;
  toggleFacet: (field: string, value: string) => void;
  setSort: (sort: SearchSort) => void;
  setPage: (page: number) => void;
  clearFilters: () => void;
  reset: () => void;
}

const initialState = {
  query: '',
  filters: {} as SearchFilters,
  sort: { field: '_score' as const, direction: 'desc' as const },
  page: 1,
  pageSize: 20,

  results: [] as SearchResult[],
  totalResults: 0,
  totalPages: 0,
  facets: {} as Record<string, FacetBucket[]>,
  executionTimeMs: 0,

  suggestions: [] as string[],
  suggestionsLoading: false,

  loading: false,
  error: null as string | null,
};

export const useSearchStore = create<SearchState>((set, get) => ({
  ...initialState,

  setQuery: (query) => set({ query }),

  executeSearch: async (workspaceId) => {
    const { query, filters, sort, page, pageSize } = get();
    set({ loading: true, error: null });

    try {
      const response = await searchApi.searchRecords(workspaceId, {
        q: query,
        filters,
        sort,
        page,
        pageSize,
      });

      set({
        results: response.data,
        totalResults: response.meta.total,
        totalPages: response.meta.totalPages,
        facets: response.meta.facets,
        executionTimeMs: response.meta.executionTimeMs,
        loading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  },

  fetchSuggestions: async (workspaceId, prefix) => {
    if (prefix.length < 2) {
      set({ suggestions: [], suggestionsLoading: false });
      return;
    }

    set({ suggestionsLoading: true });

    try {
      const suggestions = await searchApi.fetchSuggestions(workspaceId, prefix);
      set({ suggestions, suggestionsLoading: false });
    } catch {
      set({ suggestions: [], suggestionsLoading: false });
    }
  },

  toggleFacet: (field, value) => {
    const { filters } = get();
    const current = (filters as Record<string, string[] | undefined>)[field] ?? [];
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];

    set({
      filters: { ...filters, [field]: updated.length > 0 ? updated : undefined },
      page: 1, // Reset to first page on filter change
    });
  },

  setSort: (sort) => set({ sort, page: 1 }),

  setPage: (page) => set({ page }),

  clearFilters: () => set({ filters: {}, page: 1 }),

  reset: () => set(initialState),
}));
