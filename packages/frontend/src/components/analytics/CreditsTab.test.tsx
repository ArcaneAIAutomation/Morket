import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CreditsTab from './CreditsTab';
import { useAnalyticsStore } from '@/stores/analytics.store';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => null,
  Cell: () => null,
  Area: () => null,
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
  creditSummary: null,
  creditByProvider: [],
  creditBySource: [],
  creditOverTime: [],
  isLoading: {} as Record<string, boolean>,
  timeRangePreset: '30d',
  customTimeRange: null,
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
        <Route path="/workspaces/:workspaceId/analytics" element={<CreditsTab />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CreditsTab', () => {
  it('shows loading skeletons when data is loading', () => {
    setup({
      isLoading: { creditSummary: true, creditOverTime: true, creditBySource: true, creditByProvider: true },
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
      creditSummary: {
        totalDebited: 5000,
        totalRefunded: 200,
        totalToppedUp: 10000,
        netConsumption: 4800,
      },
    });
    renderTab();
    expect(screen.getByText('5,000')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('10,000')).toBeInTheDocument();
    expect(screen.getByText('4,800')).toBeInTheDocument();
  });

  it('renders charts when data exists', () => {
    setup({
      creditOverTime: [
        { timestamp: '2025-01-01', debited: 100, refunded: 10, toppedUp: 500 },
      ],
      creditBySource: [
        { source: 'enrichment', creditsConsumed: 3000, percentageOfTotal: 60 },
      ],
    });
    renderTab();
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
  });

  it('renders provider table with data', () => {
    setup({
      creditByProvider: [
        { providerSlug: 'apollo', creditsConsumed: 2000, percentageOfTotal: 40 },
        { providerSlug: 'clearbit', creditsConsumed: 3000, percentageOfTotal: 60 },
      ],
    });
    renderTab();
    expect(screen.getByText('apollo')).toBeInTheDocument();
    expect(screen.getByText('clearbit')).toBeInTheDocument();
  });

  it('renders Export CSV button', () => {
    setup();
    renderTab();
    expect(screen.getByText('Export CSV')).toBeInTheDocument();
  });
});
