import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  upsertIndexStatus,
  getIndexStatus,
  createReindexJob,
  updateReindexProgress,
  getLatestReindexJob,
  fetchEnrichmentRecord,
  fetchContactCompanyRecord,
  fetchEnrichmentRecordsBatch,
  fetchContactCompanyRecordsBatch,
  fetchScrapeResultsBatch,
} from './search.repository';

const mockQuery = vi.fn();
vi.mock('../../shared/db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  getPool: vi.fn(),
}));

const now = new Date('2024-06-01T12:00:00Z');
const wsId = 'ws-aaaa-bbbb-cccc-dddddddddddd';

// ---------------------------------------------------------------------------
// Sample rows (snake_case — DB shape)
// ---------------------------------------------------------------------------

const indexStatusRow = {
  id: 'idx-1111-2222-3333-444444444444',
  workspace_id: wsId,
  last_indexed_at: now,
  document_count: 42,
  index_version: 2,
  status: 'active',
  error_reason: null,
  created_at: now,
  updated_at: now,
};

const reindexJobRow = {
  id: 'job-1111-2222-3333-444444444444',
  workspace_id: wsId,
  status: 'running',
  total_documents: 100,
  indexed_documents: 50,
  failed_documents: 2,
  started_at: now,
  completed_at: null,
  error_reason: null,
  created_at: now,
};

const enrichmentRow = {
  id: 'er-1111-2222-3333-444444444444',
  workspace_id: wsId,
  job_id: 'ej-1111-2222-3333-444444444444',
  input_data: { email: 'test@example.com' },
  output_data: { name: 'Test User' },
  provider_slug: 'apollo',
  status: 'completed',
  created_at: now,
  updated_at: now,
};

const contactRow = {
  id: 'rec-1111-2222-3333-444444444444',
  workspace_id: wsId,
  name: 'Jane Doe',
  email: 'jane@acme.com',
  company: 'Acme Corp',
  job_title: 'CTO',
  location: 'San Francisco',
  phone: '+1-555-0100',
  domain: 'acme.com',
  tags: ['vip', 'enterprise'],
  created_at: now,
  updated_at: now,
};

const scrapeRow = {
  id: 'sr-1111-2222-3333-444444444444',
  workspace_id: wsId,
  job_id: 'sj-1111-2222-3333-444444444444',
  target_url: 'https://example.com',
  target_type: 'company_website',
  target_domain: 'example.com',
  result_data: { title: 'Example' },
  status: 'completed',
  created_at: now,
  updated_at: now,
};

// ---------------------------------------------------------------------------
// Expected camelCase domain objects
// ---------------------------------------------------------------------------

const expectedIndexStatus = {
  id: indexStatusRow.id,
  workspaceId: wsId,
  lastIndexedAt: now,
  documentCount: 42,
  indexVersion: 2,
  status: 'active',
  errorReason: null,
  createdAt: now,
  updatedAt: now,
};

const expectedReindexJob = {
  id: reindexJobRow.id,
  workspaceId: wsId,
  status: 'running',
  totalDocuments: 100,
  indexedDocuments: 50,
  failedDocuments: 2,
  startedAt: now,
  completedAt: null,
  errorReason: null,
  createdAt: now,
};

const expectedEnrichmentDoc = {
  id: enrichmentRow.id,
  workspaceId: wsId,
  jobId: enrichmentRow.job_id,
  inputData: enrichmentRow.input_data,
  outputData: enrichmentRow.output_data,
  providerSlug: 'apollo',
  status: 'completed',
  createdAt: now,
  updatedAt: now,
};

const expectedContactDoc = {
  id: contactRow.id,
  workspaceId: wsId,
  name: 'Jane Doe',
  email: 'jane@acme.com',
  company: 'Acme Corp',
  jobTitle: 'CTO',
  location: 'San Francisco',
  phone: '+1-555-0100',
  domain: 'acme.com',
  tags: ['vip', 'enterprise'],
  createdAt: now,
  updatedAt: now,
};

const expectedScrapeDoc = {
  id: scrapeRow.id,
  workspaceId: wsId,
  jobId: scrapeRow.job_id,
  targetUrl: 'https://example.com',
  targetType: 'company_website',
  targetDomain: 'example.com',
  resultData: { title: 'Example' },
  status: 'completed',
  createdAt: now,
  updatedAt: now,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('search.repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // upsertIndexStatus
  // -----------------------------------------------------------------------
  describe('upsertIndexStatus', () => {
    it('calls query with INSERT … ON CONFLICT and returns mapped camelCase object', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [indexStatusRow] });

      const result = await upsertIndexStatus(wsId, {
        lastIndexedAt: now,
        documentCount: 42,
        indexVersion: 2,
        status: 'active',
      });

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO search_index_status');
      expect(sql).toContain('ON CONFLICT (workspace_id) DO UPDATE');
      expect(sql).toContain('RETURNING');
      expect(params[0]).toBe(wsId);
      expect(result).toEqual(expectedIndexStatus);
    });

    it('uses defaults when optional fields are omitted', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [indexStatusRow] });

      await upsertIndexStatus(wsId, {});

      const [, params] = mockQuery.mock.calls[0];
      // defaults: lastIndexedAt=null, documentCount=0, indexVersion=1, status='active', errorReason=null
      expect(params).toEqual([wsId, null, 0, 1, 'active', null]);
    });
  });

  // -----------------------------------------------------------------------
  // getIndexStatus
  // -----------------------------------------------------------------------
  describe('getIndexStatus', () => {
    it('returns mapped object when found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [indexStatusRow] });

      const result = await getIndexStatus(wsId);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('SELECT');
      expect(sql).toContain('WHERE workspace_id = $1');
      expect(params).toEqual([wsId]);
      expect(result).toEqual(expectedIndexStatus);
    });

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getIndexStatus('nonexistent');

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // createReindexJob
  // -----------------------------------------------------------------------
  describe('createReindexJob', () => {
    it('inserts with parameterized query and returns mapped object', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [reindexJobRow] });

      const result = await createReindexJob(wsId);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO search_reindex_jobs');
      expect(sql).toContain('RETURNING');
      expect(params).toEqual([wsId]);
      expect(result).toEqual(expectedReindexJob);
    });
  });

  // -----------------------------------------------------------------------
  // updateReindexProgress
  // -----------------------------------------------------------------------
  describe('updateReindexProgress', () => {
    it('builds dynamic SET clauses for provided fields', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [reindexJobRow] });

      const result = await updateReindexProgress(reindexJobRow.id, {
        status: 'completed',
        indexedDocuments: 100,
        completedAt: now,
      });

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('UPDATE search_reindex_jobs');
      expect(sql).toContain('SET');
      expect(sql).toContain('RETURNING');
      // $1 = jobId, then dynamic params
      expect(params[0]).toBe(reindexJobRow.id);
      expect(params).toContain('completed');
      expect(params).toContain(100);
      expect(params).toContain(now);
    });

    it('returns null when no fields are provided', async () => {
      const result = await updateReindexProgress(reindexJobRow.id, {});

      expect(mockQuery).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('returns null when row not found after update', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await updateReindexProgress(reindexJobRow.id, { status: 'failed' });

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // getLatestReindexJob
  // -----------------------------------------------------------------------
  describe('getLatestReindexJob', () => {
    it('queries with ORDER BY created_at DESC LIMIT 1 and returns mapped object', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [reindexJobRow] });

      const result = await getLatestReindexJob(wsId);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('ORDER BY created_at DESC LIMIT 1');
      expect(sql).toContain('WHERE workspace_id = $1');
      expect(params).toEqual([wsId]);
      expect(result).toEqual(expectedReindexJob);
    });

    it('returns null when no jobs exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getLatestReindexJob(wsId);

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // fetchEnrichmentRecord
  // -----------------------------------------------------------------------
  describe('fetchEnrichmentRecord', () => {
    it('returns mapped object when found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [enrichmentRow] });

      const result = await fetchEnrichmentRecord(enrichmentRow.id);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('SELECT');
      expect(sql).toContain('FROM enrichment_records');
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual([enrichmentRow.id]);
      expect(result).toEqual(expectedEnrichmentDoc);
    });

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await fetchEnrichmentRecord('nonexistent');

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // fetchContactCompanyRecord
  // -----------------------------------------------------------------------
  describe('fetchContactCompanyRecord', () => {
    it('returns mapped object when found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [contactRow] });

      const result = await fetchContactCompanyRecord(contactRow.id);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('SELECT');
      expect(sql).toContain('FROM records');
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual([contactRow.id]);
      expect(result).toEqual(expectedContactDoc);
    });

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await fetchContactCompanyRecord('nonexistent');

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // fetchEnrichmentRecordsBatch
  // -----------------------------------------------------------------------
  describe('fetchEnrichmentRecordsBatch', () => {
    it('uses cursor pagination with WHERE id > $2 ORDER BY id ASC LIMIT $3', async () => {
      const cursor = 'cursor-uuid';
      mockQuery.mockResolvedValueOnce({ rows: [enrichmentRow] });

      const result = await fetchEnrichmentRecordsBatch(wsId, cursor, 500);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('WHERE workspace_id = $1 AND id > $2');
      expect(sql).toContain('ORDER BY id ASC');
      expect(sql).toContain('LIMIT $3');
      expect(params).toEqual([wsId, cursor, 500]);
      expect(result.records).toEqual([expectedEnrichmentDoc]);
    });

    it('uses zero UUID as default cursor when null', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [enrichmentRow] });

      await fetchEnrichmentRecordsBatch(wsId, null, 500);

      const [, params] = mockQuery.mock.calls[0];
      expect(params[1]).toBe('00000000-0000-0000-0000-000000000000');
    });

    it('returns nextCursor as last record id when batch equals limit', async () => {
      const rows = [enrichmentRow, { ...enrichmentRow, id: 'er-last' }];
      mockQuery.mockResolvedValueOnce({ rows });

      const result = await fetchEnrichmentRecordsBatch(wsId, null, 2);

      expect(result.nextCursor).toBe('er-last');
    });

    it('returns nextCursor as null when batch is smaller than limit', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [enrichmentRow] });

      const result = await fetchEnrichmentRecordsBatch(wsId, null, 500);

      expect(result.nextCursor).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // fetchContactCompanyRecordsBatch
  // -----------------------------------------------------------------------
  describe('fetchContactCompanyRecordsBatch', () => {
    it('uses cursor pagination and returns mapped records', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [contactRow] });

      const result = await fetchContactCompanyRecordsBatch(wsId, null, 500);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('FROM records');
      expect(sql).toContain('WHERE workspace_id = $1 AND id > $2');
      expect(sql).toContain('ORDER BY id ASC');
      expect(sql).toContain('LIMIT $3');
      expect(params[0]).toBe(wsId);
      expect(result.records).toEqual([expectedContactDoc]);
    });

    it('returns nextCursor as null when batch is smaller than limit', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [contactRow] });

      const result = await fetchContactCompanyRecordsBatch(wsId, null, 500);

      expect(result.nextCursor).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // fetchScrapeResultsBatch
  // -----------------------------------------------------------------------
  describe('fetchScrapeResultsBatch', () => {
    it('uses cursor pagination and returns mapped records', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [scrapeRow] });

      const result = await fetchScrapeResultsBatch(wsId, null, 500);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('FROM scrape_tasks');
      expect(sql).toContain('WHERE workspace_id = $1 AND id > $2');
      expect(sql).toContain('ORDER BY id ASC');
      expect(sql).toContain('LIMIT $3');
      expect(params[0]).toBe(wsId);
      expect(result.records).toEqual([expectedScrapeDoc]);
    });

    it('returns nextCursor as null when batch is smaller than limit', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [scrapeRow] });

      const result = await fetchScrapeResultsBatch(wsId, null, 500);

      expect(result.nextCursor).toBeNull();
    });

    it('returns nextCursor when batch equals limit', async () => {
      const rows = [scrapeRow, { ...scrapeRow, id: 'sr-last' }];
      mockQuery.mockResolvedValueOnce({ rows });

      const result = await fetchScrapeResultsBatch(wsId, null, 2);

      expect(result.nextCursor).toBe('sr-last');
    });
  });
});
