import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReindexJob } from './search.repository';

// ---------------------------------------------------------------------------
// Mock setup — must be before imports that use the mocked modules
// ---------------------------------------------------------------------------

const mockIndicesCreate = vi.fn();
const mockIndicesDelete = vi.fn();
const mockBulk = vi.fn();
const mockSearch = vi.fn();
const mockClusterHealth = vi.fn();
const mockCatIndices = vi.fn();

vi.mock('./opensearch/client', () => ({
  getOpenSearch: () => ({
    indices: {
      create: mockIndicesCreate,
      delete: mockIndicesDelete,
    },
    bulk: mockBulk,
    search: mockSearch,
    cluster: {
      health: mockClusterHealth,
    },
    cat: {
      indices: mockCatIndices,
    },
  }),
}));

vi.mock('./mappings/workspace-index.v1', () => ({
  getWorkspaceIndexName: (id: string) => `morket-workspace-${id}`,
  WORKSPACE_INDEX_MAPPING_V1: { settings: {}, mappings: {} },
}));

const mockCreateReindexJob = vi.fn();
const mockUpdateReindexProgress = vi.fn();
const mockGetLatestReindexJob = vi.fn();
const mockUpsertIndexStatus = vi.fn();
const mockFetchEnrichmentRecordsBatch = vi.fn();
const mockFetchContactCompanyRecordsBatch = vi.fn();
const mockFetchScrapeResultsBatch = vi.fn();

vi.mock('./search.repository', () => ({
  createReindexJob: (...args: unknown[]) => mockCreateReindexJob(...args),
  updateReindexProgress: (...args: unknown[]) => mockUpdateReindexProgress(...args),
  getLatestReindexJob: (...args: unknown[]) => mockGetLatestReindexJob(...args),
  upsertIndexStatus: (...args: unknown[]) => mockUpsertIndexStatus(...args),
  fetchEnrichmentRecordsBatch: (...args: unknown[]) => mockFetchEnrichmentRecordsBatch(...args),
  fetchContactCompanyRecordsBatch: (...args: unknown[]) => mockFetchContactCompanyRecordsBatch(...args),
  fetchScrapeResultsBatch: (...args: unknown[]) => mockFetchScrapeResultsBatch(...args),
}));

const mockPoolQuery = vi.fn();
const mockPoolRelease = vi.fn();
const mockPoolConnect = vi.fn();

vi.mock('../../shared/db', () => ({
  getPool: () => ({
    connect: mockPoolConnect,
  }),
}));

vi.mock('../../shared/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import {
  createSearchService,
  transformEnrichmentRecord,
  transformContactCompanyRecord,
  transformScrapeResult,
  type SearchCache,
} from './search.service';
import { searchQuerySchema } from './search.schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const wsId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const now = new Date('2024-06-01T12:00:00Z');

function makeMockCache(): SearchCache {
  return { get: vi.fn().mockReturnValue(null), set: vi.fn(), invalidateWorkspace: vi.fn() };
}

function makeMockPoolClient() {
  mockPoolQuery.mockReset();
  mockPoolRelease.mockReset();
  const client = { query: mockPoolQuery, release: mockPoolRelease };
  mockPoolConnect.mockResolvedValue(client);
  return client;
}

const baseReindexJob: ReindexJob = {
  id: 'job-1111',
  workspaceId: wsId,
  status: 'pending',
  totalDocuments: 0,
  indexedDocuments: 0,
  failedDocuments: 0,
  startedAt: null,
  completedAt: null,
  errorReason: null,
  createdAt: now,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('search.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // createWorkspaceIndex
  // =========================================================================
  describe('createWorkspaceIndex', () => {
    it('creates index with correct name and mapping', async () => {
      mockIndicesCreate.mockResolvedValueOnce({});
      const svc = createSearchService(makeMockCache());

      await svc.createWorkspaceIndex(wsId);

      expect(mockIndicesCreate).toHaveBeenCalledOnce();
      const call = mockIndicesCreate.mock.calls[0][0];
      expect(call.index).toBe(`morket-workspace-${wsId}`);
      expect(call.body).toEqual({ settings: {}, mappings: {} });
    });

    it('ignores 400 error (index already exists)', async () => {
      mockIndicesCreate.mockRejectedValueOnce({ statusCode: 400 });
      const svc = createSearchService(makeMockCache());

      await expect(svc.createWorkspaceIndex(wsId)).resolves.toBeUndefined();
    });

    it('throws on non-400 errors', async () => {
      const err = { statusCode: 500, message: 'Internal' };
      mockIndicesCreate.mockRejectedValueOnce(err);
      const svc = createSearchService(makeMockCache());

      await expect(svc.createWorkspaceIndex(wsId)).rejects.toEqual(err);
    });
  });

  // =========================================================================
  // deleteWorkspaceIndex
  // =========================================================================
  describe('deleteWorkspaceIndex', () => {
    it('deletes index with correct name', async () => {
      mockIndicesDelete.mockResolvedValueOnce({});
      const svc = createSearchService(makeMockCache());

      await svc.deleteWorkspaceIndex(wsId);

      expect(mockIndicesDelete).toHaveBeenCalledOnce();
      expect(mockIndicesDelete.mock.calls[0][0].index).toBe(`morket-workspace-${wsId}`);
    });

    it('ignores 404 error (index does not exist)', async () => {
      mockIndicesDelete.mockRejectedValueOnce({ statusCode: 404 });
      const svc = createSearchService(makeMockCache());

      await expect(svc.deleteWorkspaceIndex(wsId)).resolves.toBeUndefined();
    });

    it('throws on non-404 errors', async () => {
      const err = { statusCode: 500, message: 'Internal' };
      mockIndicesDelete.mockRejectedValueOnce(err);
      const svc = createSearchService(makeMockCache());

      await expect(svc.deleteWorkspaceIndex(wsId)).rejects.toEqual(err);
    });
  });

  // =========================================================================
  // reindexWorkspace
  // =========================================================================
  describe('reindexWorkspace', () => {
    function setupHappyPath(cache: SearchCache) {
      const client = makeMockPoolClient();
      // BEGIN, advisory lock, COMMIT all succeed
      mockPoolQuery.mockResolvedValue({ rows: [] });

      mockCreateReindexJob.mockResolvedValue({ ...baseReindexJob });
      mockUpdateReindexProgress.mockResolvedValue({ ...baseReindexJob, status: 'running', startedAt: now });

      // delete + create index succeed
      mockIndicesDelete.mockResolvedValue({});
      mockIndicesCreate.mockResolvedValue({});

      // All three sources return empty batches (no records)
      mockFetchEnrichmentRecordsBatch.mockResolvedValue({ records: [], nextCursor: null });
      mockFetchContactCompanyRecordsBatch.mockResolvedValue({ records: [], nextCursor: null });
      mockFetchScrapeResultsBatch.mockResolvedValue({ records: [], nextCursor: null });

      // Final progress update
      mockUpdateReindexProgress.mockResolvedValue({ ...baseReindexJob, status: 'completed' });
      mockUpsertIndexStatus.mockResolvedValue({});

      return client;
    }

    it('acquires advisory lock via pg_advisory_xact_lock', async () => {
      const cache = makeMockCache();
      setupHappyPath(cache);
      const svc = createSearchService(cache);

      await svc.reindexWorkspace(wsId);

      // Expect BEGIN, advisory lock, COMMIT
      const queries = mockPoolQuery.mock.calls.map((c) => c[0]);
      expect(queries[0]).toBe('BEGIN');
      expect(queries[1]).toContain('pg_advisory_xact_lock');
      expect(queries[1]).toContain("hashtext('reindex:'");
    });

    it('creates reindex job and marks as running', async () => {
      const cache = makeMockCache();
      setupHappyPath(cache);
      const svc = createSearchService(cache);

      await svc.reindexWorkspace(wsId);

      expect(mockCreateReindexJob).toHaveBeenCalledWith(wsId, expect.anything());
      expect(mockUpdateReindexProgress).toHaveBeenCalledWith(
        baseReindexJob.id,
        expect.objectContaining({ status: 'running' }),
        expect.anything(),
      );
    });

    it('deletes and recreates workspace index', async () => {
      const cache = makeMockCache();
      setupHappyPath(cache);
      const svc = createSearchService(cache);

      await svc.reindexWorkspace(wsId);

      expect(mockIndicesDelete).toHaveBeenCalledOnce();
      expect(mockIndicesCreate).toHaveBeenCalledOnce();
      // delete is called before create
      const deleteOrder = mockIndicesDelete.mock.invocationCallOrder[0];
      const createOrder = mockIndicesCreate.mock.invocationCallOrder[0];
      expect(deleteOrder).toBeLessThan(createOrder);
    });

    it('reads records in batches from all three sources', async () => {
      const cache = makeMockCache();
      setupHappyPath(cache);
      const svc = createSearchService(cache);

      await svc.reindexWorkspace(wsId);

      expect(mockFetchEnrichmentRecordsBatch).toHaveBeenCalled();
      expect(mockFetchContactCompanyRecordsBatch).toHaveBeenCalled();
      expect(mockFetchScrapeResultsBatch).toHaveBeenCalled();
    });

    it('bulk indexes documents to OpenSearch', async () => {
      const cache = makeMockCache();
      makeMockPoolClient();
      mockPoolQuery.mockResolvedValue({ rows: [] });
      mockCreateReindexJob.mockResolvedValue({ ...baseReindexJob });
      mockUpdateReindexProgress.mockResolvedValue({ ...baseReindexJob, status: 'running', startedAt: now });
      mockIndicesDelete.mockResolvedValue({});
      mockIndicesCreate.mockResolvedValue({});

      // Return one enrichment record, then empty
      const enrichRec = {
        id: 'er-1',
        workspaceId: wsId,
        jobId: 'ej-1',
        inputData: {},
        outputData: { name: 'Test' },
        providerSlug: 'apollo',
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      };
      mockFetchEnrichmentRecordsBatch
        .mockResolvedValueOnce({ records: [enrichRec], nextCursor: null })
      mockFetchContactCompanyRecordsBatch.mockResolvedValue({ records: [], nextCursor: null });
      mockFetchScrapeResultsBatch.mockResolvedValue({ records: [], nextCursor: null });

      mockBulk.mockResolvedValue({ body: { errors: false, items: [] } });
      mockUpdateReindexProgress.mockResolvedValue({ ...baseReindexJob, status: 'completed' });
      mockUpsertIndexStatus.mockResolvedValue({});

      const svc = createSearchService(cache);
      await svc.reindexWorkspace(wsId);

      expect(mockBulk).toHaveBeenCalledOnce();
      const bulkBody = mockBulk.mock.calls[0][0].body;
      // bulk body alternates action + doc
      expect(bulkBody[0]).toEqual(
        expect.objectContaining({ index: expect.objectContaining({ _index: `morket-workspace-${wsId}` }) }),
      );
    });

    it('updates progress after completion', async () => {
      const cache = makeMockCache();
      setupHappyPath(cache);
      const svc = createSearchService(cache);

      await svc.reindexWorkspace(wsId);

      // The final updateReindexProgress call should have status completed or failed
      const lastCall = mockUpdateReindexProgress.mock.calls[mockUpdateReindexProgress.mock.calls.length - 1];
      expect(lastCall[1]).toEqual(expect.objectContaining({
        status: expect.stringMatching(/completed|failed/),
        completedAt: expect.any(Date),
      }));
    });

    it('handles partial failures (some bulk items fail)', async () => {
      const cache = makeMockCache();
      makeMockPoolClient();
      mockPoolQuery.mockResolvedValue({ rows: [] });
      mockCreateReindexJob.mockResolvedValue({ ...baseReindexJob });
      mockUpdateReindexProgress.mockResolvedValue({ ...baseReindexJob, status: 'running', startedAt: now });
      mockIndicesDelete.mockResolvedValue({});
      mockIndicesCreate.mockResolvedValue({});

      const enrichRec = {
        id: 'er-1', workspaceId: wsId, jobId: 'ej-1', inputData: {},
        outputData: { name: 'Test' }, providerSlug: 'apollo', status: 'completed',
        createdAt: now, updatedAt: now,
      };
      const enrichRec2 = { ...enrichRec, id: 'er-2' };
      mockFetchEnrichmentRecordsBatch.mockResolvedValueOnce({ records: [enrichRec, enrichRec2], nextCursor: null });
      mockFetchContactCompanyRecordsBatch.mockResolvedValue({ records: [], nextCursor: null });
      mockFetchScrapeResultsBatch.mockResolvedValue({ records: [], nextCursor: null });

      // One item succeeds, one fails
      mockBulk.mockResolvedValue({
        body: {
          errors: true,
          items: [
            { index: { _id: 'er-1', status: 200 } },
            { index: { _id: 'er-2', status: 400, error: { type: 'mapper_parsing_exception' } } },
          ],
        },
      });

      mockUpdateReindexProgress.mockResolvedValue({ ...baseReindexJob, status: 'completed', failedDocuments: 1 });
      mockUpsertIndexStatus.mockResolvedValue({});

      const svc = createSearchService(cache);
      const job = await svc.reindexWorkspace(wsId);

      // Final update should reflect partial failure
      const lastProgressCall = mockUpdateReindexProgress.mock.calls[mockUpdateReindexProgress.mock.calls.length - 1];
      expect(lastProgressCall[1].failedDocuments).toBe(1);
      expect(lastProgressCall[1].indexedDocuments).toBe(1);
      expect(lastProgressCall[1].status).toBe('completed');
    });

    it('marks job as failed when all documents fail', async () => {
      const cache = makeMockCache();
      makeMockPoolClient();
      mockPoolQuery.mockResolvedValue({ rows: [] });
      mockCreateReindexJob.mockResolvedValue({ ...baseReindexJob });
      mockUpdateReindexProgress.mockResolvedValue({ ...baseReindexJob, status: 'running', startedAt: now });
      mockIndicesDelete.mockResolvedValue({});
      mockIndicesCreate.mockResolvedValue({});

      const enrichRec = {
        id: 'er-1', workspaceId: wsId, jobId: 'ej-1', inputData: {},
        outputData: { name: 'Test' }, providerSlug: 'apollo', status: 'completed',
        createdAt: now, updatedAt: now,
      };
      mockFetchEnrichmentRecordsBatch.mockResolvedValueOnce({ records: [enrichRec], nextCursor: null });
      mockFetchContactCompanyRecordsBatch.mockResolvedValue({ records: [], nextCursor: null });
      mockFetchScrapeResultsBatch.mockResolvedValue({ records: [], nextCursor: null });

      // All items fail
      mockBulk.mockResolvedValue({
        body: {
          errors: true,
          items: [
            { index: { _id: 'er-1', status: 400, error: { type: 'mapper_parsing_exception' } } },
          ],
        },
      });

      mockUpdateReindexProgress.mockResolvedValue({ ...baseReindexJob, status: 'failed' });
      mockUpsertIndexStatus.mockResolvedValue({});

      const svc = createSearchService(cache);
      await svc.reindexWorkspace(wsId);

      const lastProgressCall = mockUpdateReindexProgress.mock.calls[mockUpdateReindexProgress.mock.calls.length - 1];
      expect(lastProgressCall[1].status).toBe('failed');
      expect(lastProgressCall[1].indexedDocuments).toBe(0);
      expect(lastProgressCall[1].failedDocuments).toBe(1);
    });

    it('invalidates cache after completion', async () => {
      const cache = makeMockCache();
      setupHappyPath(cache);
      const svc = createSearchService(cache);

      await svc.reindexWorkspace(wsId);

      expect(cache.invalidateWorkspace).toHaveBeenCalledWith(wsId);
    });

    it('releases pool client on transaction error', async () => {
      const client = makeMockPoolClient();
      mockPoolQuery.mockRejectedValueOnce(new Error('lock failed'));
      const svc = createSearchService(makeMockCache());

      await expect(svc.reindexWorkspace(wsId)).rejects.toThrow('lock failed');
      expect(mockPoolRelease).toHaveBeenCalledOnce();
    });

    it('rolls back transaction on error', async () => {
      makeMockPoolClient();
      // BEGIN succeeds, advisory lock fails
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(new Error('lock conflict')); // advisory lock

      const svc = createSearchService(makeMockCache());

      await expect(svc.reindexWorkspace(wsId)).rejects.toThrow('lock conflict');

      const queries = mockPoolQuery.mock.calls.map((c) => c[0]);
      expect(queries).toContain('ROLLBACK');
    });
  });

  // =========================================================================
  // getReindexStatus
  // =========================================================================
  describe('getReindexStatus', () => {
    it('returns mapped status from repository', async () => {
      const job: ReindexJob = {
        id: 'job-1',
        workspaceId: wsId,
        status: 'completed',
        totalDocuments: 100,
        indexedDocuments: 98,
        failedDocuments: 2,
        startedAt: now,
        completedAt: new Date('2024-06-01T12:05:00Z'),
        errorReason: '2 documents failed to index',
        createdAt: now,
      };
      mockGetLatestReindexJob.mockResolvedValueOnce(job);
      const svc = createSearchService(makeMockCache());

      const result = await svc.getReindexStatus(wsId);

      expect(mockGetLatestReindexJob).toHaveBeenCalledWith(wsId);
      expect(result).toEqual({
        id: 'job-1',
        workspaceId: wsId,
        status: 'completed',
        totalDocuments: 100,
        indexedDocuments: 98,
        failedDocuments: 2,
        startedAt: now,
        completedAt: new Date('2024-06-01T12:05:00Z'),
        errorReason: '2 documents failed to index',
        createdAt: now,
      });
    });

    it('returns null when no job exists', async () => {
      mockGetLatestReindexJob.mockResolvedValueOnce(null);
      const svc = createSearchService(makeMockCache());

      const result = await svc.getReindexStatus(wsId);

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // transformEnrichmentRecord
  // =========================================================================
  describe('transformEnrichmentRecord', () => {
    it('maps enrichment record fields correctly', () => {
      const rec = {
        id: 'er-1',
        workspaceId: wsId,
        jobId: 'ej-1',
        inputData: { email: 'test@example.com' },
        outputData: { name: 'Jane Doe', email: 'jane@acme.com', company: 'Acme', job_title: 'CTO', location: 'NYC', phone: '+1-555', domain: 'acme.com' },
        providerSlug: 'apollo',
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      };

      const doc = transformEnrichmentRecord(rec);

      expect(doc.document_type).toBe('enrichment_record');
      expect(doc.record_id).toBe('er-1');
      expect(doc.workspace_id).toBe(wsId);
      expect(doc.name).toBe('Jane Doe');
      expect(doc.email).toBe('jane@acme.com');
      expect(doc.company).toBe('Acme');
      expect(doc.job_title).toBe('CTO');
      expect(doc.provider_slug).toBe('apollo');
      expect(doc.enrichment_status).toBe('completed');
      expect(doc.enrichment_fields).toEqual(['name', 'email', 'company', 'job_title', 'location', 'phone', 'domain']);
      expect(doc.created_at).toBe(now.toISOString());
      expect(doc.updated_at).toBe(now.toISOString());
    });

    it('handles null outputData', () => {
      const rec = {
        id: 'er-2',
        workspaceId: wsId,
        jobId: 'ej-1',
        inputData: {},
        outputData: null,
        providerSlug: 'clearbit',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };

      const doc = transformEnrichmentRecord(rec);

      expect(doc.name).toBeNull();
      expect(doc.email).toBeNull();
      expect(doc.enrichment_fields).toEqual([]);
    });
  });

  // =========================================================================
  // transformContactCompanyRecord
  // =========================================================================
  describe('transformContactCompanyRecord', () => {
    it('sets document_type to "company" when company field is present', () => {
      const rec = {
        id: 'rec-1',
        workspaceId: wsId,
        name: 'Acme Corp',
        email: null,
        company: 'Acme Corp',
        jobTitle: null,
        location: 'San Francisco',
        phone: null,
        domain: 'acme.com',
        tags: ['enterprise'],
        createdAt: now,
        updatedAt: now,
      };

      const doc = transformContactCompanyRecord(rec);

      expect(doc.document_type).toBe('company');
      expect(doc.record_id).toBe('rec-1');
      expect(doc.tags).toEqual(['enterprise']);
    });

    it('sets document_type to "contact" when company field is null', () => {
      const rec = {
        id: 'rec-2',
        workspaceId: wsId,
        name: 'Jane Doe',
        email: 'jane@example.com',
        company: null,
        jobTitle: 'Engineer',
        location: null,
        phone: '+1-555-0100',
        domain: null,
        tags: null,
        createdAt: now,
        updatedAt: now,
      };

      const doc = transformContactCompanyRecord(rec);

      expect(doc.document_type).toBe('contact');
      expect(doc.name).toBe('Jane Doe');
      expect(doc.email).toBe('jane@example.com');
      expect(doc.job_title).toBe('Engineer');
      expect(doc.provider_slug).toBeNull();
      expect(doc.enrichment_status).toBeNull();
    });
  });

  // =========================================================================
  // transformScrapeResult
  // =========================================================================
  describe('transformScrapeResult', () => {
    it('maps scrape result fields correctly', () => {
      const rec = {
        id: 'sr-1',
        workspaceId: wsId,
        jobId: 'sj-1',
        targetUrl: 'https://example.com/about',
        targetType: 'company_website',
        targetDomain: 'example.com',
        resultData: { name: 'Example Inc', email: 'info@example.com', company: 'Example Inc' },
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      };

      const doc = transformScrapeResult(rec);

      expect(doc.document_type).toBe('scrape_result');
      expect(doc.record_id).toBe('sr-1');
      expect(doc.workspace_id).toBe(wsId);
      expect(doc.name).toBe('Example Inc');
      expect(doc.domain).toBe('example.com');
      expect(doc.source_url).toBe('https://example.com/about');
      expect(doc.scrape_target_type).toBe('company_website');
      expect(doc.created_at).toBe(now.toISOString());
    });

    it('handles null resultData', () => {
      const rec = {
        id: 'sr-2',
        workspaceId: wsId,
        jobId: 'sj-1',
        targetUrl: null,
        targetType: null,
        targetDomain: null,
        resultData: null,
        status: 'failed',
        createdAt: now,
        updatedAt: now,
      };

      const doc = transformScrapeResult(rec);

      expect(doc.name).toBeNull();
      expect(doc.email).toBeNull();
      expect(doc.domain).toBeNull();
      expect(doc.source_url).toBeNull();
      expect(doc.scrape_target_type).toBeNull();
    });
  });

  // =========================================================================
  // suggest
  // =========================================================================
  describe('suggest', () => {
    const prefix = 'jan';

    function makeHits(sources: Array<Record<string, unknown>>) {
      return {
        body: {
          hits: {
            total: { value: sources.length },
            hits: sources.map((s, i) => ({ _source: s, _score: 10 - i })),
          },
        },
      };
    }

    it('returns cached result on cache hit', async () => {
      const cache = makeMockCache();
      const cached = ['Jane Doe', 'Janice Brown'];
      (cache.get as ReturnType<typeof vi.fn>).mockReturnValueOnce(cached);
      const svc = createSearchService(cache);

      const result = await svc.suggest(wsId, prefix);

      expect(result).toBe(cached);
      expect(cache.get).toHaveBeenCalledWith(`search:${wsId}:suggest:${prefix}`);
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('queries OpenSearch on cache miss and caches result', async () => {
      const cache = makeMockCache();
      mockSearch.mockResolvedValueOnce(makeHits([
        { name: 'Jane Doe', company: 'Acme', job_title: 'CTO' },
      ]));
      const svc = createSearchService(cache);

      const result = await svc.suggest(wsId, prefix);

      expect(mockSearch).toHaveBeenCalledOnce();
      const searchCall = mockSearch.mock.calls[0][0];
      expect(searchCall.index).toBe(`morket-workspace-${wsId}`);
      // Verify workspace scoping
      expect(searchCall.body.query.bool.filter).toEqual([{ term: { workspace_id: wsId } }]);
      // Verify _source fields
      expect(searchCall.body._source).toEqual(['name', 'company', 'job_title']);
      // Verify size
      expect(searchCall.body.size).toBe(50);
      // Result should contain all three field values
      expect(result).toEqual(expect.arrayContaining(['Jane Doe', 'Acme', 'CTO']));
      // Should cache with 30s TTL
      expect(cache.set).toHaveBeenCalledWith(
        `search:${wsId}:suggest:${prefix}`,
        expect.any(Array),
        30_000,
      );
    });

    it('deduplicates suggestions case-insensitively', async () => {
      const cache = makeMockCache();
      mockSearch.mockResolvedValueOnce(makeHits([
        { name: 'Jane Doe', company: 'Acme', job_title: null },
        { name: 'jane doe', company: 'ACME', job_title: null },
        { name: 'JANE DOE', company: 'acme', job_title: null },
      ]));
      const svc = createSearchService(cache);

      const result = await svc.suggest(wsId, prefix);

      // Should have exactly 2 unique suggestions (Jane Doe, Acme) — no duplicates
      expect(result).toHaveLength(2);
      const lowerResult = result.map((s) => s.toLowerCase());
      expect(new Set(lowerResult).size).toBe(2);
    });

    it('sorts by document frequency descending', async () => {
      const cache = makeMockCache();
      mockSearch.mockResolvedValueOnce(makeHits([
        { name: 'Rare Name', company: 'Common Corp', job_title: 'Common Corp' },
        { name: 'Another', company: 'Common Corp', job_title: null },
        { name: 'Third', company: 'Unique LLC', job_title: null },
      ]));
      const svc = createSearchService(cache);

      const result = await svc.suggest(wsId, prefix);

      // "Common Corp" appears 3 times, should be first
      expect(result[0]).toBe('Common Corp');
    });

    it('returns max 10 suggestions', async () => {
      const cache = makeMockCache();
      // Generate 15 unique hits
      const sources = Array.from({ length: 15 }, (_, i) => ({
        name: `Person ${i}`,
        company: null,
        job_title: null,
      }));
      mockSearch.mockResolvedValueOnce(makeHits(sources));
      const svc = createSearchService(cache);

      const result = await svc.suggest(wsId, prefix);

      expect(result.length).toBeLessThanOrEqual(10);
    });

    it('skips empty and whitespace-only field values', async () => {
      const cache = makeMockCache();
      mockSearch.mockResolvedValueOnce(makeHits([
        { name: 'Jane', company: '', job_title: '   ' },
        { name: null, company: null, job_title: 'Engineer' },
      ]));
      const svc = createSearchService(cache);

      const result = await svc.suggest(wsId, prefix);

      expect(result).toEqual(expect.arrayContaining(['Jane', 'Engineer']));
      expect(result).toHaveLength(2);
    });

    it('returns empty array when no hits', async () => {
      const cache = makeMockCache();
      mockSearch.mockResolvedValueOnce(makeHits([]));
      const svc = createSearchService(cache);

      const result = await svc.suggest(wsId, prefix);

      expect(result).toEqual([]);
      // Should still cache the empty result
      expect(cache.set).toHaveBeenCalledWith(
        `search:${wsId}:suggest:${prefix}`,
        [],
        30_000,
      );
    });

    it('throws 408 on timeout', async () => {
      const cache = makeMockCache();
      mockSearch.mockRejectedValueOnce({ name: 'TimeoutError', message: 'timeout' });
      const svc = createSearchService(cache);

      await expect(svc.suggest(wsId, prefix)).rejects.toMatchObject({
        statusCode: 408,
      });
    });

    it('throws 503 when OpenSearch is unreachable', async () => {
      const cache = makeMockCache();
      mockSearch.mockRejectedValueOnce({ name: 'ConnectionError', message: 'ECONNREFUSED' });
      const svc = createSearchService(cache);

      await expect(svc.suggest(wsId, prefix)).rejects.toMatchObject({
        statusCode: 503,
      });
    });
  });

  // =========================================================================
  // search
  // =========================================================================
  describe('search', () => {
  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  function makeSearchResponse(opts: {
    total?: number;
    hits?: Array<Record<string, unknown>>;
    aggregations?: Record<string, unknown>;
    timed_out?: boolean;
  }) {
    return {
      body: {
        timed_out: opts.timed_out ?? false,
        hits: {
          total: { value: opts.total ?? 0 },
          hits: opts.hits ?? [],
        },
        aggregations: opts.aggregations ?? {},
      },
    };
  }

  function makeHit(
    source: Record<string, unknown>,
    score = 10,
    highlight?: Record<string, string[]>,
  ) {
    return {
      _source: source,
      _score: score,
      ...(highlight ? { highlight } : {}),
    };
  }

  /** Builds a valid SearchQuery with defaults filled in via Zod. */
  function q(overrides: Record<string, unknown> = {}) {
    return searchQuerySchema.parse(overrides);
  }

  const baseSource = {
    record_id: 'rec-1',
    document_type: 'enrichment_record',
    workspace_id: wsId,
    name: 'Jane Doe',
    email: 'jane@acme.com',
    company: 'Acme Corp',
    job_title: 'CTO',
    location: 'NYC',
    phone: '+1-555',
    domain: 'acme.com',
    provider_slug: 'apollo',
    enrichment_status: 'completed',
    tags: ['enterprise'],
    source_url: null,
    scrape_target_type: null,
    created_at: '2024-06-01T12:00:00Z',
    updated_at: '2024-06-01T12:00:00Z',
  };

  // -----------------------------------------------------------------------
  // Query building
  // -----------------------------------------------------------------------

  it('builds multi-match query for plain search terms', async () => {
    const cache = makeMockCache();
    mockSearch.mockResolvedValueOnce(makeSearchResponse({ total: 0 }));
    const svc = createSearchService(cache);

    await svc.search(wsId, q({ q: 'Jane' }));

    const body = mockSearch.mock.calls[0][0].body;
    const must = body.query.bool.must;
    expect(must).toHaveLength(1);
    expect(must[0]).toHaveProperty('multi_match');
    expect(must[0].multi_match.query).toBe('Jane');
    expect(must[0].multi_match.fields).toEqual(['name', 'email', 'company', 'job_title', 'location']);
  });

  it('builds field-specific match query for field:value syntax', async () => {
    const cache = makeMockCache();
    mockSearch.mockResolvedValueOnce(makeSearchResponse({ total: 0 }));
    const svc = createSearchService(cache);

    await svc.search(wsId, q({ q: 'name:Jane' }));

    const body = mockSearch.mock.calls[0][0].body;
    const must = body.query.bool.must;
    expect(must).toHaveLength(1);
    expect(must[0]).toHaveProperty('match');
    expect(must[0].match).toHaveProperty('name');
    expect(must[0].match.name.query).toBe('Jane');
  });

  it('ignores field:value when field is not in allowlist', async () => {
    const cache = makeMockCache();
    mockSearch.mockResolvedValueOnce(makeSearchResponse({ total: 0 }));
    const svc = createSearchService(cache);

    await svc.search(wsId, q({ q: 'unknown:value' }));

    const body = mockSearch.mock.calls[0][0].body;
    const must = body.query.bool.must;
    expect(must).toHaveLength(1);
    // Falls back to multi_match since "unknown" is not in the allowlist
    expect(must[0]).toHaveProperty('multi_match');
  });

  it('applies keyword term filters', async () => {
    const cache = makeMockCache();
    mockSearch.mockResolvedValueOnce(makeSearchResponse({ total: 0 }));
    const svc = createSearchService(cache);

    await svc.search(wsId, q({
      filters: { document_type: ['enrichment_record', 'contact'] },
    }));

    const body = mockSearch.mock.calls[0][0].body;
    const filterClauses = body.query.bool.filter;
    // First filter is always workspace_id, second is the document_type terms
    const termsFilter = filterClauses.find(
      (f: Record<string, unknown>) => 'terms' in f && (f.terms as Record<string, unknown>).document_type,
    );
    expect(termsFilter).toBeDefined();
    expect((termsFilter.terms as Record<string, unknown>).document_type).toEqual(['enrichment_record', 'contact']);
  });

  it('applies date range filters', async () => {
    const cache = makeMockCache();
    mockSearch.mockResolvedValueOnce(makeSearchResponse({ total: 0 }));
    const svc = createSearchService(cache);

    await svc.search(wsId, q({
      filters: {
        created_at: { gte: '2024-01-01T00:00:00Z', lte: '2024-12-31T23:59:59Z' },
      },
    }));

    const body = mockSearch.mock.calls[0][0].body;
    const filterClauses = body.query.bool.filter;
    const rangeFilter = filterClauses.find(
      (f: Record<string, unknown>) => 'range' in f && (f.range as Record<string, unknown>).created_at,
    );
    expect(rangeFilter).toBeDefined();
    expect((rangeFilter.range as Record<string, unknown>).created_at).toEqual({
      gte: '2024-01-01T00:00:00Z',
      lte: '2024-12-31T23:59:59Z',
    });
  });

  it('always includes workspace_id term filter', async () => {
    const cache = makeMockCache();
    mockSearch.mockResolvedValueOnce(makeSearchResponse({ total: 0 }));
    const svc = createSearchService(cache);

    await svc.search(wsId, q());

    const body = mockSearch.mock.calls[0][0].body;
    const filterClauses = body.query.bool.filter;
    const wsFilter = filterClauses.find(
      (f: Record<string, unknown>) => 'term' in f && (f.term as Record<string, unknown>).workspace_id === wsId,
    );
    expect(wsFilter).toBeDefined();
  });

  it('configures highlights with <mark> tags', async () => {
    const cache = makeMockCache();
    mockSearch.mockResolvedValueOnce(makeSearchResponse({ total: 0 }));
    const svc = createSearchService(cache);

    await svc.search(wsId, q({ q: 'test' }));

    const body = mockSearch.mock.calls[0][0].body;
    expect(body.highlight.pre_tags).toEqual(['<mark>']);
    expect(body.highlight.post_tags).toEqual(['</mark>']);
    expect(body.highlight.fragment_size).toBe(150);
    expect(body.highlight.fields).toHaveProperty('name');
    expect(body.highlight.fields).toHaveProperty('email');
    expect(body.highlight.fields).toHaveProperty('company');
    expect(body.highlight.fields).toHaveProperty('job_title');
    expect(body.highlight.fields).toHaveProperty('location');
  });

  it('applies sort configuration', async () => {
    const cache = makeMockCache();
    mockSearch.mockResolvedValueOnce(makeSearchResponse({ total: 0 }));
    const svc = createSearchService(cache);

    await svc.search(wsId, q({ sort: { field: 'created_at', direction: 'asc' } }));

    const body = mockSearch.mock.calls[0][0].body;
    expect(body.sort).toEqual([{ created_at: { order: 'asc' } }]);
  });

  it('sorts by name.keyword for name field', async () => {
    const cache = makeMockCache();
    mockSearch.mockResolvedValueOnce(makeSearchResponse({ total: 0 }));
    const svc = createSearchService(cache);

    await svc.search(wsId, q({ sort: { field: 'name', direction: 'asc' } }));

    const body = mockSearch.mock.calls[0][0].body;
    expect(body.sort).toEqual([{ 'name.keyword': { order: 'asc' } }]);
  });

  it('defaults to _score desc sort', async () => {
    const cache = makeMockCache();
    mockSearch.mockResolvedValueOnce(makeSearchResponse({ total: 0 }));
    const svc = createSearchService(cache);

    await svc.search(wsId, q());

    const body = mockSearch.mock.calls[0][0].body;
    expect(body.sort).toEqual([{ _score: { order: 'desc' } }]);
  });

  it('computes correct from/size for pagination', async () => {
    const cache = makeMockCache();
    mockSearch.mockResolvedValueOnce(makeSearchResponse({ total: 100 }));
    const svc = createSearchService(cache);

    await svc.search(wsId, q({ page: 3, pageSize: 20 }));

    const body = mockSearch.mock.calls[0][0].body;
    expect(body.from).toBe(40); // (3 - 1) * 20
    expect(body.size).toBe(20);
  });

  it('rejects pagination when page * pageSize > 10000', async () => {
    const svc = createSearchService(makeMockCache());

    // page 101 * pageSize 100 = 10100 > 10000
    await expect(svc.search(wsId, q({ page: 101, pageSize: 100 }))).rejects.toMatchObject({
      statusCode: 400,
    });

    // OpenSearch should never be called
    expect(mockSearch).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Response mapping
  // -----------------------------------------------------------------------

  it('returns empty data array for zero results', async () => {
    const cache = makeMockCache();
    mockSearch.mockResolvedValueOnce(makeSearchResponse({ total: 0, hits: [] }));
    const svc = createSearchService(cache);

    const result = await svc.search(wsId, q({ q: 'nonexistent' }));

    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
    expect(result.meta.totalPages).toBe(0);
  });

  it('maps hits to SearchResult objects with highlights', async () => {
    const cache = makeMockCache();
    const highlight = { name: ['<mark>Jane</mark> Doe'] };
    mockSearch.mockResolvedValueOnce(makeSearchResponse({
      total: 1,
      hits: [makeHit(baseSource, 12.5, highlight)],
    }));
    const svc = createSearchService(cache);

    const result = await svc.search(wsId, q({ q: 'Jane' }));

    expect(result.data).toHaveLength(1);
    const item = result.data[0];
    expect(item.record_id).toBe('rec-1');
    expect(item.document_type).toBe('enrichment_record');
    expect(item.workspace_id).toBe(wsId);
    expect(item.name).toBe('Jane Doe');
    expect(item.email).toBe('jane@acme.com');
    expect(item.company).toBe('Acme Corp');
    expect(item.score).toBe(12.5);
    expect(item.highlights).toEqual(highlight);
  });

  it('maps aggregation buckets to facets', async () => {
    const cache = makeMockCache();
    mockSearch.mockResolvedValueOnce(makeSearchResponse({
      total: 10,
      hits: [makeHit(baseSource)],
      aggregations: {
        document_type: {
          buckets: [
            { key: 'enrichment_record', doc_count: 7 },
            { key: 'contact', doc_count: 3 },
          ],
        },
        provider_slug: {
          buckets: [{ key: 'apollo', doc_count: 10 }],
        },
        enrichment_status: { buckets: [] },
        scrape_target_type: { buckets: [] },
        tags: { buckets: [] },
      },
    }));
    const svc = createSearchService(cache);

    const result = await svc.search(wsId, q());

    expect(result.meta.facets.document_type).toEqual([
      { value: 'enrichment_record', count: 7 },
      { value: 'contact', count: 3 },
    ]);
    expect(result.meta.facets.provider_slug).toEqual([
      { value: 'apollo', count: 10 },
    ]);
  });

  it('filters out zero-count facet buckets', async () => {
    const cache = makeMockCache();
    mockSearch.mockResolvedValueOnce(makeSearchResponse({
      total: 5,
      hits: [makeHit(baseSource)],
      aggregations: {
        document_type: {
          buckets: [
            { key: 'enrichment_record', doc_count: 5 },
            { key: 'contact', doc_count: 0 },
          ],
        },
        provider_slug: { buckets: [] },
        enrichment_status: { buckets: [] },
        scrape_target_type: { buckets: [] },
        tags: { buckets: [] },
      },
    }));
    const svc = createSearchService(cache);

    const result = await svc.search(wsId, q());

    // The zero-count bucket should be filtered out
    expect(result.meta.facets.document_type).toEqual([
      { value: 'enrichment_record', count: 5 },
    ]);
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it('throws 408 on timeout error', async () => {
    const cache = makeMockCache();
    mockSearch.mockRejectedValueOnce({ name: 'TimeoutError', message: 'Request timed out' });
    const svc = createSearchService(cache);

    await expect(svc.search(wsId, q({ q: 'test' }))).rejects.toMatchObject({
      statusCode: 408,
    });
  });

  it('throws 408 when response has timed_out flag', async () => {
    const cache = makeMockCache();
    mockSearch.mockResolvedValueOnce(makeSearchResponse({ timed_out: true }));
    const svc = createSearchService(cache);

    await expect(svc.search(wsId, q({ q: 'test' }))).rejects.toMatchObject({
      statusCode: 408,
    });
  });

  it('throws 503 on connection error', async () => {
    const cache = makeMockCache();
    mockSearch.mockRejectedValueOnce({ name: 'ConnectionError', message: 'ECONNREFUSED' });
    const svc = createSearchService(cache);

    await expect(svc.search(wsId, q({ q: 'test' }))).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('escapes special characters in search terms', async () => {
    const cache = makeMockCache();
    mockSearch.mockResolvedValueOnce(makeSearchResponse({ total: 0 }));
    const svc = createSearchService(cache);

    await svc.search(wsId, q({ q: 'test+value (special)' }));

    const body = mockSearch.mock.calls[0][0].body;
    const queryStr = body.query.bool.must[0].multi_match.query;
    // Special chars should be escaped with backslash
    expect(queryStr).toContain('\\+');
    expect(queryStr).toContain('\\(');
    expect(queryStr).toContain('\\)');
    expect(queryStr).not.toBe('test+value (special)');
  });
});

// ---------------------------------------------------------------------------
// getClusterHealth
// ---------------------------------------------------------------------------

describe('getClusterHealth', () => {
  it('returns formatted cluster health', async () => {
    const cache = makeMockCache();
    mockClusterHealth.mockResolvedValueOnce({
      body: {
        status: 'green',
        number_of_nodes: 3,
        active_primary_shards: 15,
        unassigned_shards: 0,
        cluster_name: 'morket-cluster',
      },
    });

    const svc = createSearchService(cache);
    const health = await svc.getClusterHealth();

    expect(health).toEqual({
      status: 'green',
      numberOfNodes: 3,
      activeShards: 15,
      unassignedShards: 0,
      clusterName: 'morket-cluster',
    });
  });

  it('returns yellow status correctly', async () => {
    const cache = makeMockCache();
    mockClusterHealth.mockResolvedValueOnce({
      body: {
        status: 'yellow',
        number_of_nodes: 1,
        active_primary_shards: 5,
        unassigned_shards: 5,
        cluster_name: 'test-cluster',
      },
    });

    const svc = createSearchService(cache);
    const health = await svc.getClusterHealth();

    expect(health.status).toBe('yellow');
    expect(health.unassignedShards).toBe(5);
  });

  it('throws 503 on connection error', async () => {
    const cache = makeMockCache();
    const connErr = new Error('ECONNREFUSED');
    connErr.name = 'ConnectionError';
    mockClusterHealth.mockRejectedValueOnce(connErr);

    const svc = createSearchService(cache);

    await expect(svc.getClusterHealth()).rejects.toMatchObject({
      statusCode: 503,
      code: 'SEARCH_UNAVAILABLE',
    });
  });

  it('rethrows non-connection errors', async () => {
    const cache = makeMockCache();
    const err = new Error('unexpected');
    mockClusterHealth.mockRejectedValueOnce(err);

    const svc = createSearchService(cache);

    await expect(svc.getClusterHealth()).rejects.toThrow('unexpected');
  });
});

// ---------------------------------------------------------------------------
// getIndexList
// ---------------------------------------------------------------------------

describe('getIndexList', () => {
  it('returns formatted index list filtered to morket-workspace-* pattern', async () => {
    const cache = makeMockCache();
    mockCatIndices.mockResolvedValueOnce({
      body: [
        { index: 'morket-workspace-ws1', health: 'green', 'docs.count': '500', 'store.size': '2.1mb' },
        { index: 'morket-workspace-ws2', health: 'yellow', 'docs.count': '120', 'store.size': '800kb' },
      ],
    });

    const svc = createSearchService(cache);
    const indices = await svc.getIndexList();

    expect(indices).toEqual([
      { index: 'morket-workspace-ws1', health: 'green', docsCount: 500, storageSize: '2.1mb' },
      { index: 'morket-workspace-ws2', health: 'yellow', docsCount: 120, storageSize: '800kb' },
    ]);
  });

  it('returns empty array when no indices exist', async () => {
    const cache = makeMockCache();
    mockCatIndices.mockResolvedValueOnce({ body: [] });

    const svc = createSearchService(cache);
    const indices = await svc.getIndexList();

    expect(indices).toEqual([]);
  });

  it('returns empty array when body is not an array', async () => {
    const cache = makeMockCache();
    mockCatIndices.mockResolvedValueOnce({ body: null });

    const svc = createSearchService(cache);
    const indices = await svc.getIndexList();

    expect(indices).toEqual([]);
  });

  it('handles missing fields gracefully', async () => {
    const cache = makeMockCache();
    mockCatIndices.mockResolvedValueOnce({
      body: [{ index: 'morket-workspace-ws1' }],
    });

    const svc = createSearchService(cache);
    const indices = await svc.getIndexList();

    expect(indices).toEqual([
      { index: 'morket-workspace-ws1', health: 'unknown', docsCount: 0, storageSize: '0b' },
    ]);
  });

  it('throws 503 on connection error', async () => {
    const cache = makeMockCache();
    const connErr = new Error('ECONNREFUSED');
    connErr.name = 'ConnectionError';
    mockCatIndices.mockRejectedValueOnce(connErr);

    const svc = createSearchService(cache);

    await expect(svc.getIndexList()).rejects.toMatchObject({
      statusCode: 503,
      code: 'SEARCH_UNAVAILABLE',
    });
  });
});
});
