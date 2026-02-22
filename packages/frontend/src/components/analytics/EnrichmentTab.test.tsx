import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EnrichmentTab from './EnrichmentTab';
import { useAnalyticsStore } from '@/stores/analytics.store';

// Mock recharts to avoid canvas issues in jsdom
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Line: () => null,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

vi.mock('@/stores/analytics.store', () => ({
  useAnalyticsStore: vi.fn(),
}));

const baseState = {
  enrichmentSummary: null,
  enrichmentByProvider: [],
  enrichmentByField: [],
  enrichmentOverTime: [],
  isLoading: {} as Record<string, boolean>,
  timeRangePreset: '30d',
  customTimeRange: null,
  selectedProvider: null,
  setSelectedProvider: vi.fn(),
};

function setup(overrides: Record<string, unknown> = {}) {
  const state = { ...baseState, ...overrides };
  (useAnalyticsStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: typeof state) => unknown) => selector(state),
  );
}

function renderTab() {
  return render(
    <MemoryRouter initialEntries={['/workspaces/ws-1/analytics']}>
      <Routes>
        <Route path="/workspaces/:workspaceId/analytics" element={<EnrichmentTab />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EnrichmentTab', () => {
  it('shows loading skeletons when data is loading', () => {
    setup({
      isLoading: { enrichmentSummary: true, enrichmentOverTime: true, enrichmentByProvider: true, enrichmentByField: true },
    });
    renderTab();
    const skeletons = screen.getAllByRole('status');
    expect(skeletons.length).toBeGreaterThanOrEqual(4);
  });

  it('shows empty state when no data', () => {
    setup();
    renderTab();
    const emptyMessages = screen.getAllByText('No data for selected period');
    expect(emptyMessages.length).toBeGreaterThanOrEqual(1);
  });

  it('renders summary cards with data', () => {
    setup({
      enrichmentSummary: {
        totalAttempts: 500,
        successRate: 92.5,
        totalCredits: 1200,
        avgDurationMs: 350,
        successCount: 462,
        failureCount: 38,
        skippedCount: 0,
      },
    });
    renderTab();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('92.5%')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByText('350ms')).toBeInTheDocument();
  });

  it('renders charts when time series data exists', () => {
    setup({
      enrichmentOverTime: [
        { timestamp: '2025-01-01', attempts: 10, successes: 8, failures: 2 },
      ],
      enrichmentByProvider: [
        { providerSlug: 'apollo', successCount: 5, failureCount: 1, attempts: 6, successRate: 83.3, avgDurationMs: 200, totalCredits: 6 },
      ],
    });
    renderTab();
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
  });

  it('renders field breakdown table with data', () => {
    setup({
      enrichmentByField: [
        { fieldName: 'email', attempts: 100, successCount: 90, failureCount: 10, successRate: 90.0 },
        { fieldName: 'phone', attempts: 50, successCount: 40, failureCount: 10, successRate: 80.0 },
      ],
    });
    renderTab();
    expect(screen.getByText('email')).toBeInTheDocument();
    expect(screen.getByText('phone')).toBeInTheDocument();
  });

  it('renders Export CSV button', () => {
    setup();
    renderTab();
    expect(screen.getByText('Export CSV')).toBeInTheDocument();
  });
});
