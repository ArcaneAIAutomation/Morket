export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

export function formatCredits(credits: number): string {
  return `${credits.toLocaleString('en-US')} credits`;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
