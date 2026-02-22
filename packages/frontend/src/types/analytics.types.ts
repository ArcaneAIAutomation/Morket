// Analytics response types — mirrors backend analytics service interfaces

export type TimeRangePreset = '24h' | '7d' | '30d' | '90d';
export type ActiveTab = 'enrichment' | 'scraping' | 'credits';
export type Granularity = 'hour' | 'day' | 'week';

// Enrichment analytics
export interface EnrichmentSummary {
  totalAttempts: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  successRate: number; // 0–100 percentage
  totalCredits: number;
  avgDurationMs: number;
}

export interface ProviderBreakdown {
  providerSlug: string;
  attempts: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDurationMs: number;
  totalCredits: number;
}

export interface FieldBreakdown {
  fieldName: string;
  attempts: number;
  successCount: number;
  failureCount: number;
  successRate: number;
}

export interface TimeSeriesPoint {
  timestamp: string; // ISO 8601
  attempts: number;
  successes: number;
  failures: number;
}

// Scraping analytics
export interface ScrapingSummary {
  totalTasks: number;
  completedCount: number;
  failedCount: number;
  successRate: number;
  avgDurationMs: number;
}

export interface DomainBreakdown {
  domain: string;
  tasks: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDurationMs: number;
}

export interface TargetTypeBreakdown {
  targetType: string;
  tasks: number;
  successCount: number;
  failureCount: number;
  successRate: number;
}

// Credit analytics
export interface CreditSummary {
  totalDebited: number;
  totalRefunded: number;
  totalToppedUp: number;
  netConsumption: number;
}

export interface CreditProviderBreakdown {
  providerSlug: string;
  creditsConsumed: number;
  percentageOfTotal: number;
}

export interface CreditSourceBreakdown {
  source: string; // 'enrichment' | 'scraping' | 'manual'
  creditsConsumed: number;
  percentageOfTotal: number;
}

export interface CreditTimeSeriesPoint {
  timestamp: string;
  debited: number;
  refunded: number;
  toppedUp: number;
}
