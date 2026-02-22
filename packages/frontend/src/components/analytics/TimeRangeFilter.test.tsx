import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TimeRangeFilter from './TimeRangeFilter';
import { useAnalyticsStore } from '@/stores/analytics.store';

// Mock the store
vi.mock('@/stores/analytics.store', () => ({
  useAnalyticsStore: vi.fn(),
}));

const mockStore = {
  timeRangePreset: '30d' as const,
  customTimeRange: null,
  setTimeRange: vi.fn(),
  setCustomTimeRange: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  (useAnalyticsStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: typeof mockStore) => unknown) => selector(mockStore),
  );
});

describe('TimeRangeFilter', () => {
  it('renders all preset buttons', () => {
    render(<TimeRangeFilter />);
    expect(screen.getByText('24h')).toBeInTheDocument();
    expect(screen.getByText('7d')).toBeInTheDocument();
    expect(screen.getByText('30d')).toBeInTheDocument();
    expect(screen.getByText('90d')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('highlights the active preset', () => {
    render(<TimeRangeFilter />);
    const btn30d = screen.getByText('30d');
    expect(btn30d).toHaveAttribute('aria-pressed', 'true');
    const btn7d = screen.getByText('7d');
    expect(btn7d).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls setTimeRange when a preset is clicked', () => {
    render(<TimeRangeFilter />);
    fireEvent.click(screen.getByText('7d'));
    expect(mockStore.setTimeRange).toHaveBeenCalledWith('7d');
  });

  it('shows date inputs when Custom is clicked', () => {
    render(<TimeRangeFilter />);
    fireEvent.click(screen.getByText('Custom'));
    expect(screen.getByLabelText('Start date')).toBeInTheDocument();
    expect(screen.getByLabelText('End date')).toBeInTheDocument();
  });

  it('validates that both dates are required', () => {
    render(<TimeRangeFilter />);
    fireEvent.click(screen.getByText('Custom'));
    fireEvent.click(screen.getByText('Apply'));
    expect(screen.getByRole('alert')).toHaveTextContent('Both start and end dates are required.');
  });

  it('validates end > start', () => {
    render(<TimeRangeFilter />);
    fireEvent.click(screen.getByText('Custom'));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2025-06-15' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2025-06-10' } });
    fireEvent.click(screen.getByText('Apply'));
    expect(screen.getByRole('alert')).toHaveTextContent('End date must be after start date.');
  });

  it('validates max 365 days', () => {
    render(<TimeRangeFilter />);
    fireEvent.click(screen.getByText('Custom'));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2024-01-01' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2025-06-01' } });
    fireEvent.click(screen.getByText('Apply'));
    expect(screen.getByRole('alert')).toHaveTextContent('Date range cannot exceed 365 days.');
  });

  it('calls setCustomTimeRange with valid dates', () => {
    render(<TimeRangeFilter />);
    fireEvent.click(screen.getByText('Custom'));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2025-06-01' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2025-06-15' } });
    fireEvent.click(screen.getByText('Apply'));
    expect(mockStore.setCustomTimeRange).toHaveBeenCalledWith('2025-06-01', '2025-06-15');
  });
});
