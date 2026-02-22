// Search domain types — mirrors backend search schemas and service interfaces

export interface SearchFilters {
  document_type?: ('enrichment_record' | 'contact' | 'company' | 'scrape_result')[];
  provider_slug?: string[];
  enrichment_status?: string[];
  scrape_target_type?: string[];
  tags?: string[];
  created_at?: { gte?: string; lte?: string };
  updated_at?: { gte?: string; lte?: string };
}

export interface SearchSort {
  field: '_score' | 'created_at' | 'updated_at' | 'name';
  direction: 'asc' | 'desc';
}

export interface SearchQuery {
  q: string;
  filters?: SearchFilters;
  facets?: string[];
  page?: number;
  pageSize?: number;
  sort?: SearchSort;
  fuzziness?: '0' | '1' | '2' | 'AUTO';
}

export interface SearchResult {
  record_id: string;
  document_type: string;
  workspace_id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  job_title: string | null;
  location: string | null;
  phone: string | null;
  domain: string | null;
  provider_slug: string | null;
  enrichment_status: string | null;
  tags: string[] | null;
  source_url: string | null;
  scrape_target_type: string | null;
  created_at: string;
  updated_at: string;
  score: number;
  highlights?: Record<string, string[]>;
}

export interface FacetBucket {
  value: string;
  count: number;
}

export interface SearchResponse {
  data: SearchResult[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    executionTimeMs: number;
    facets: Record<string, FacetBucket[]>;
  };
}

export interface SuggestResponse {
  data: string[];
}

export interface ReindexStatus {
  id: string;
  workspaceId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  totalDocuments: number;
  indexedDocuments: number;
  failedDocuments: number;
  startedAt: string | null;
  completedAt: string | null;
  errorReason: string | null;
  createdAt: string;
}
