import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SearchBar from './SearchBar';
import { useSearchStore } from '@/stores/search.store';

// Mock the search API
vi.mock('@/api/search.api', () => ({
  searchRecords: vi.fn().mockResolvedValue({ data: [], meta: { total: 0, page: 1, pageSize: 20, totalPages: 0, executionTimeMs: 0, facets: {} } }),
  fetchSuggestions: vi.fn().mockResolvedValue([]),
  triggerReindex: vi.fn(),
  getReindexStatus: vi.fn(),
}));

function renderWithRouter(workspaceId = 'ws-1') {
  return render(
    <MemoryRouter initialEntries={[`/workspaces/${workspaceId}/spreadsheet`]}>
      <Routes>
        <Route path="/workspaces/:workspaceId/*" element={<SearchBar />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SearchBar', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useSearchStore.getState().reset();
  });

  it('renders search input', () => {
    renderWithRouter();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('updates query on input change', () => {
    renderWithRouter();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'test query' } });
    expect(useSearchStore.getState().query).toBe('test query');
  });

  it('shows clear button when input has text', () => {
    renderWithRouter();
    const input = screen.getByRole('combobox');

    // No clear button initially
    expect(screen.queryByLabelText('Clear search')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'test' } });
    expect(screen.getByLabelText('Clear search')).toBeInTheDocument();
  });

  it('clears input when clear button is clicked', () => {
    renderWithRouter();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'test' } });

    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(useSearchStore.getState().query).toBe('');
  });

  it('shows suggestion dropdown when suggestions exist and input is focused', () => {
    useSearchStore.setState({ suggestions: ['Jane Doe', 'Jane Smith'] });
    renderWithRouter();

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('closes dropdown on Escape', () => {
    useSearchStore.setState({ suggestions: ['Jane Doe'] });
    renderWithRouter();

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('navigates suggestions with arrow keys', () => {
    useSearchStore.setState({ suggestions: ['Jane Doe', 'Jane Smith'] });
    renderWithRouter();

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByText('Jane Doe').closest('button')).toHaveClass('bg-indigo-50');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByText('Jane Smith').closest('button')).toHaveClass('bg-indigo-50');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByText('Jane Doe').closest('button')).toHaveClass('bg-indigo-50');
  });

  it('responds to Ctrl+K global shortcut', () => {
    renderWithRouter();
    const input = screen.getByRole('combobox');

    // Blur the input first
    fireEvent.blur(input);

    act(() => {
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    });

    expect(document.activeElement).toBe(input);
  });
});
