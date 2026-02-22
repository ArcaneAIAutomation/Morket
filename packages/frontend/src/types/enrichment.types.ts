export type EnrichmentFieldType = 'email' | 'phone' | 'company_info' | 'job_title' | 'social_profiles' | 'address';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'partially_completed' | 'cancelled';

export interface Provider {
  slug: string;
  displayName: string;
  supportedFields: EnrichmentFieldType[];
  creditCostPerCall: number;
}

export interface WaterfallConfig {
  [field: string]: {
    providers: string[];
  };
}

export interface EnrichmentJob {
  id: string;
  workspaceId: string;
  status: JobStatus;
  requestedFields: EnrichmentFieldType[];
  waterfallConfig: WaterfallConfig | null;
  totalRecords: number;
  completedRecords: number;
  failedRecords: number;
  estimatedCredits: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface EnrichmentRecord {
  id: string;
  jobId: string;
  providerSlug: string;
  creditsConsumed: number;
  status: 'success' | 'failed' | 'skipped';
  errorReason: string | null;
  outputData: Record<string, unknown> | null;
}
