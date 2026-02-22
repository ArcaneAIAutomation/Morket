import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AnalyticsDashboard from './AnalyticsDashboard';
import { useAnalyticsStore } from '@/stores/analytics.store';

// Mock lazy-loaded tab components
vi.mock('@/components/analytics/EnrichmentTab', () => ({
  default: () => <div data-testid="enrichment-tab">EnrichmentTab</div>,
}));
vi.mock('@/components/analytics/ScrapingTab', () => ({
  default: () => <div data-testid="scraping-tab">ScrapingTab</div>,
}));
vi.mock('@/components/analytics/CreditsTab', () => ({
  default: () => <div data-testid="credits-tab">CreditsTab</div>,
}));
vi.mock('@/components/analytics/TimeRangeFilter', () => ({
  default: () => <div data-testid="time-range-filter">TimeRangeFilter</div>,
}));
vi.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: vi.fn(),
}));

const mockSetActiveTab = vi.fn();

vi.mock('@/stores/analytics.store', () => ({
  useAnalyticsStore: vi.fn(),
}));

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/workspaces/ws-1/analytics']}>
      <Routes>
        <Route path="/workspaces/:workspaceId/analytics" element={<AnalyticsDashboard />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (useAnalyticsStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ activeTab: 'enrichment', setActiveTab: mockSetActiveTab }),
  );
});

describe('AnalyticsDashboard', () => {
  it('renders the page title', () => {
    renderDashboard();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
  });

  it('renders the time range filter', () => {
    renderDashboard();
    expect(screen.getByTestId('time-range-filter')).toBeInTheDocument();
  });

  it('renders tab buttons', () => {
    renderDashboard();
    expect(screen.getByRole('tab', { name: 'Enrichment' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Scraping' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Credits' })).toBeInTheDocument();
  });

  it('marks the active tab as selected', () => {
    renderDashboard();
    expect(screen.getByRole('tab', { name: 'Enrichment' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Scraping' })).toHaveAttribute('aria-selected', 'false');
  });

  it('renders the enrichment tab by default', () => {
    renderDashboard();
    expect(screen.getByTestId('enrichment-tab')).toBeInTheDocument();
  });

  it('calls setActiveTab when a tab is clicked', () => {
    renderDashboard();
    fireEvent.click(screen.getByRole('tab', { name: 'Scraping' }));
    expect(mockSetActiveTab).toHaveBeenCalledWith('scraping');
  });

  it('renders scraping tab when active', async () => {
    (useAnalyticsStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ activeTab: 'scraping', setActiveTab: mockSetActiveTab }),
    );
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('scraping-tab')).toBeInTheDocument();
    });
  });

  it('renders credits tab when active', async () => {
    (useAnalyticsStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ activeTab: 'credits', setActiveTab: mockSetActiveTab }),
    );
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('credits-tab')).toBeInTheDocument();
    });
  });
});
