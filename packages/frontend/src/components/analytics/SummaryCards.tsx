export type CardFormat = 'number' | 'percentage' | 'duration' | 'credits';

export interface SummaryCardItem {
  label: string;
  value: number | null;
  format: CardFormat;
}

function formatValue(value: number | null, format: CardFormat): string {
  if (value === null || value === undefined) return '—';
  switch (format) {
    case 'percentage':
      return `${value.toFixed(1)}%`;
    case 'duration':
      return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
    case 'credits':
      return value.toLocaleString();
    case 'number':
    default:
      return value.toLocaleString();
  }
}

interface SummaryCardsProps {
  items: SummaryCardItem[];
  isLoading?: boolean;
}

export default function SummaryCards({ items, isLoading }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm"
        >
          <p className="text-xs text-gray-500 uppercase tracking-wide">{item.label}</p>
          {isLoading ? (
            <div className="mt-1 h-7 w-20 bg-gray-200 rounded animate-pulse" role="status">
              <span className="sr-only">Loading</span>
            </div>
          ) : (
            <p className="mt-1 text-2xl font-semibold text-gray-900">
              {formatValue(item.value, item.format)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
