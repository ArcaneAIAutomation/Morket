import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ScrapingTab from './ScrapingTab';
import { useAnalyticsStore } from '@/stores/analytics.store';

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
  scrapingSummary: null,
  scrapingByDomain: [],
  scrapingByType: [],
  scrapingOverTime: [],
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
        <Route path="/workspaces/:workspaceId/analytics" element={<ScrapingTab />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ScrapingTab', () => {
  it('shows loading skeletons when data is loading', () => {
    setup({
      isLoading: { scrapingSummary: true, scrapingOverTime: true, scrapingByDomain: true, scrapingByType: true },
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
      scrapingSummary: {
        totalTasks: 300,
        successRate: 88.0,
        completedCount: 264,
        avgDurationMs: 1500,
        failedCount: 36,
      },
    });
    renderTab();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('88.0%')).toBeInTheDocument();
    expect(screen.getByText('264')).toBeInTheDocument();
    expect(screen.getByText('1.5s')).toBeInTheDocument();
  });

  it('renders charts when data exists', () => {
    setup({
      scrapingOverTime: [
        { timestamp: '2025-01-01', attempts: 10, successes: 8, failures: 2 },
      ],
      scrapingByDomain: [
        { domain: 'example.com', tasks: 50, successCount: 45, failureCount: 5, successRate: 90, avgDurationMs: 1000 },
      ],
    });
    renderTab();
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
  });

  it('renders target type table with data', () => {
    setup({
      scrapingByType: [
        { targetType: 'linkedin_profile', tasks: 100, successCount: 90, failureCount: 10, successRate: 90.0 },
      ],
    });
    renderTab();
    expect(screen.getByText('linkedin_profile')).toBeInTheDocument();
  });

  it('renders Export CSV button', () => {
    setup();
    renderTab();
    expect(screen.getByText('Export CSV')).toBeInTheDocument();
  });
});
