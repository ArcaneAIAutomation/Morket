import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SearchResultsView from './SearchResultsView';
import { useSearchStore } from '@/stores/search.store';
import type { SearchResult } from '@/types/search.types';

// Mock the search API
vi.mock('@/api/search.api', () => ({
  searchRecords: vi.fn().mockResolvedValue({
    data: [],
    meta: { total: 0, page: 1, pageSize: 20, totalPages: 0, executionTimeMs: 0, facets: {} },
  }),
  fetchSuggestions: vi.fn().mockResolvedValue([]),
  triggerReindex: vi.fn(),
  getReindexStatus: vi.fn(),
}));

const mockResult: SearchResult = {
  record_id: 'r1',
  document_type: 'contact',
  workspace_id: 'ws-1',
  name: 'Jane Doe',
  email: 'jane@example.com',
  company: 'Acme Corp',
  job_title: 'Engineer',
  location: 'San Francisco',
  phone: null,
  domain: null,
  provider_slug: 'apollo',
  enrichment_status: 'completed',
  tags: null,
  source_url: null,
  scrape_target_type: null,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
  score: 10.5,
  highlights: { name: ['<mark>Jane</mark> Doe'] },
};

function renderView(wsId = 'ws-1') {
  return render(
    <MemoryRouter initialEntries={[`/workspaces/${wsId}/search?q=Jane`]}>
      <Routes>
        <Route path="/workspaces/:workspaceId/search" element={<SearchResultsView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SearchResultsView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useSearchStore.getState().reset();
  });

  it('shows loading skeleton when loading', () => {
    useSearchStore.setState({ loading: true });
    renderView();
    expect(screen.getByLabelText('Loading search results')).toBeInTheDocument();
  });

  it('renders search results', () => {
    useSearchStore.setState({
      loading: false,
      results: [mockResult],
      totalResults: 1,
      totalPages: 1,
      executionTimeMs: 42,
      facets: { document_type: [{ value: 'contact', count: 1 }] },
    });
    renderView();

    expect(screen.getByText('1 results')).toBeInTheDocument();
    expect(screen.getByText('(42ms)')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('shows empty state when no results', () => {
    useSearchStore.setState({
      loading: false,
      results: [],
      totalResults: 0,
      query: 'nonexistent',
    });
    renderView();

    expect(screen.getByText(/No results found/)).toBeInTheDocument();
    expect(screen.getByText(/Try broadening your search/)).toBeInTheDocument();
  });

  it('shows error state with retry button', () => {
    const executeSearchMock = vi.fn();
    useSearchStore.setState({
      loading: false,
      error: 'Search service unavailable',
      executeSearch: executeSearchMock,
    });
    renderView();

    expect(screen.getByText('Search service unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('hides results and pagination when error is set', () => {
    useSearchStore.setState({
      loading: false,
      error: 'Something went wrong',
      results: [mockResult],
      totalResults: 100,
      totalPages: 5,
      page: 1,
      executeSearch: vi.fn(),
    });
    renderView();

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    // Results should be hidden
    expect(screen.queryByText('Acme Corp')).not.toBeInTheDocument();
    // Pagination should be hidden
    expect(screen.queryByText(/Page 1 of 5/)).not.toBeInTheDocument();
  });

  it('displays network error message', () => {
    useSearchStore.setState({
      loading: false,
      error: 'Unable to connect to the search service. Check your connection and try again.',
      executeSearch: vi.fn(),
    });
    renderView();

    expect(
      screen.getByText('Unable to connect to the search service. Check your connection and try again.'),
    ).toBeInTheDocument();
  });

  it('displays 500 error message', () => {
    useSearchStore.setState({
      loading: false,
      error: 'Search service is unavailable. Please try again later.',
      executeSearch: vi.fn(),
    });
    renderView();

    expect(
      screen.getByText('Search service is unavailable. Please try again later.'),
    ).toBeInTheDocument();
  });

  it('retry button re-executes search', () => {
    const executeSearchMock = vi.fn();
    useSearchStore.setState({
      loading: false,
      error: 'Search failed',
      executeSearch: executeSearchMock,
    });
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(executeSearchMock).toHaveBeenCalledWith('ws-1');
  });

  it('renders sort dropdown with options', () => {
    useSearchStore.setState({ loading: false, results: [mockResult], totalResults: 1 });
    renderView();

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveTextContent('Relevance');
    expect(options[1]).toHaveTextContent('Newest First');
    expect(options[2]).toHaveTextContent('Oldest First');
    expect(options[3]).toHaveTextContent('Name (A-Z)');
  });

  it('renders pagination when multiple pages', () => {
    useSearchStore.setState({
      loading: false,
      results: [mockResult],
      totalResults: 100,
      totalPages: 5,
      page: 1,
    });
    renderView();

    expect(screen.getByText(/Page 1 of 5/)).toBeInTheDocument();
    expect(screen.getByLabelText('Previous page')).toBeDisabled();
    expect(screen.getByLabelText('Next page')).not.toBeDisabled();
  });

  it('renders facet sidebar with checkboxes', () => {
    useSearchStore.setState({
      loading: false,
      results: [mockResult],
      totalResults: 1,
      facets: {
        document_type: [
          { value: 'contact', count: 5 },
          { value: 'company', count: 3 },
        ],
      },
    });
    renderView();

    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(screen.getByLabelText(/contact/)).toBeInTheDocument();
    expect(screen.getByLabelText(/company/)).toBeInTheDocument();
  });

  it('renders highlighted text in result cards', () => {
    useSearchStore.setState({
      loading: false,
      results: [mockResult],
      totalResults: 1,
    });
    renderView();

    // The highlighted name should contain a <mark> tag
    const markElement = document.querySelector('mark');
    expect(markElement).toBeInTheDocument();
    expect(markElement?.textContent).toBe('Jane');
  });
});
