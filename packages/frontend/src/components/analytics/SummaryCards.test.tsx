import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SummaryCards from './SummaryCards';
import type { SummaryCardItem } from './SummaryCards';

const items: SummaryCardItem[] = [
  { label: 'Total', value: 1234, format: 'number' },
  { label: 'Rate', value: 85.3, format: 'percentage' },
  { label: 'Duration', value: 450, format: 'duration' },
  { label: 'Credits', value: 9999, format: 'credits' },
];

describe('SummaryCards', () => {
  it('renders all card labels', () => {
    render(<SummaryCards items={items} />);
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Rate')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Credits')).toBeInTheDocument();
  });

  it('formats number values with locale string', () => {
    render(<SummaryCards items={items} />);
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('formats percentage values', () => {
    render(<SummaryCards items={items} />);
    expect(screen.getByText('85.3%')).toBeInTheDocument();
  });

  it('formats duration in ms', () => {
    render(<SummaryCards items={items} />);
    expect(screen.getByText('450ms')).toBeInTheDocument();
  });

  it('formats duration in seconds when >= 1000ms', () => {
    const longDuration: SummaryCardItem[] = [
      { label: 'Dur', value: 2500, format: 'duration' },
    ];
    render(<SummaryCards items={longDuration} />);
    expect(screen.getByText('2.5s')).toBeInTheDocument();
  });

  it('formats credits with locale string', () => {
    render(<SummaryCards items={items} />);
    expect(screen.getByText('9,999')).toBeInTheDocument();
  });

  it('shows dash for null values', () => {
    const nullItems: SummaryCardItem[] = [
      { label: 'Empty', value: null, format: 'number' },
    ];
    render(<SummaryCards items={nullItems} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows skeleton placeholders when loading', () => {
    render(<SummaryCards items={items} isLoading />);
    const skeletons = screen.getAllByRole('status');
    expect(skeletons).toHaveLength(4);
    // Values should not be rendered
    expect(screen.queryByText('1,234')).not.toBeInTheDocument();
  });
});
