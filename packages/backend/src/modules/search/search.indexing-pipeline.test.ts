import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SearchIndexingPipeline } from './search.indexing-pipeline';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockOsBulk = vi.fn();
vi.mock('./opensearch/client', () => ({
  getOpenSearch: () => ({
    bulk: mockOsBulk,
  }),
}));

vi.mock('./mappings/workspace-index.v1', () => ({
  getWorkspaceIndexName: (id: string) => `morket-workspace-${id}`,
}));

const mockFetchEnrichmentRecord = vi.fn();
const mockFetchContactCompanyRecord = vi.fn();
const mockFetchScrapeResult = vi.fn();
vi.mock('./search.repository', () => ({
  fetchEnrichmentRecord: (...args: unknown[]) => mockFetchEnrichmentRecord(...args),
  fetchContactCompanyRecord: (...args: unknown[]) => mockFetchContactCompanyRecord(...args),
  fetchScrapeResult: (...args: unknown[]) => mockFetchScrapeResult(...args),
}));

vi.mock('./search.service', () => ({
  transformToSearchDocument: vi.fn((rec: { id: string; workspaceId: string }, source: string) => ({
    document_type:
      source === 'enrichment'
        ? 'enrichment_record'
        : source === 'record'
          ? 'contact'
          : 'scrape_result',
    record_id: rec.id,
    workspace_id: rec.workspaceId,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  })),
}));

vi.mock('../../config/env', () => ({
  env: { DATABASE_URL: 'postgresql://localhost/test' },
}));

vi.mock('../../shared/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createSearchIndexingPipeline } from './search.indexing-pipeline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockEnrichmentRec = {
  id: 'rec-1',
  workspaceId: 'ws-1',
  jobId: 'job-1',
  inputData: {},
  outputData: { name: 'Test' },
  providerSlug: 'apollo',
  status: 'completed',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockContactRec = {
  id: 'rec-2',
  workspaceId: 'ws-2',
  name: 'Jane Doe',
  email: 'jane@example.com',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockScrapeRec = {
  id: 'task-1',
  workspaceId: 'ws-3',
  targetUrl: 'https://example.com',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makePipeline(overrides?: { batchSize?: number }) {
  const mockCache = { get: vi.fn(), set: vi.fn(), invalidateWorkspace: vi.fn() };
  const pipeline = createSearchIndexingPipeline(
    {
      batchSize: overrides?.batchSize ?? 50,
      maxRetries: 3,
      retryBackoffMs: [0, 0, 0],
    },
    { searchCache: mockCache },
  );
  return { pipeline, mockCache };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('search.indexing-pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. buffers events from _handleNotification
  it('buffers events from _handleNotification', () => {
    const { pipeline } = makePipeline();
    const payload = JSON.stringify({ record_id: 'rec-1', workspace_id: 'ws-1', op: 'INSERT' });

    pipeline._handleNotification('search_index_enrichment', payload);

    expect(pipeline.getStats().bufferedEvents).toBe(1);
  });

  // 2. ignores unknown channels
  it('ignores unknown channels', () => {
    const { pipeline } = makePipeline();
    const payload = JSON.stringify({ record_id: 'rec-1', workspace_id: 'ws-1', op: 'INSERT' });

    pipeline._handleNotification('unknown_channel', payload);

    expect(pipeline.getStats().bufferedEvents).toBe(0);
  });

  // 3. ignores empty payload
  it('ignores empty payload', () => {
    const { pipeline } = makePipeline();

    pipeline._handleNotification('search_index_enrichment', undefined);

    expect(pipeline.getStats().bufferedEvents).toBe(0);
  });

  // 4. extracts record_id for enrichment channel
  it('extracts record_id for enrichment channel', async () => {
    const { pipeline } = makePipeline();
    mockFetchEnrichmentRecord.mockResolvedValue(mockEnrichmentRec);
    mockOsBulk.mockResolvedValue({ body: { errors: false, items: [] } });

    const payload = JSON.stringify({ record_id: 'rec-1', workspace_id: 'ws-1', op: 'INSERT' });
    pipeline._handleNotification('search_index_enrichment', payload);
    await pipeline._flushAll();

    expect(mockFetchEnrichmentRecord).toHaveBeenCalledWith('rec-1');
  });

  // 5. extracts task_id for scrape channel
  it('extracts task_id for scrape channel', async () => {
    const { pipeline } = makePipeline();
    mockFetchScrapeResult.mockResolvedValue(mockScrapeRec);
    mockOsBulk.mockResolvedValue({ body: { errors: false, items: [] } });

    const payload = JSON.stringify({
      task_id: 'task-1',
      workspace_id: 'ws-3',
      job_id: 'job-1',
      op: 'INSERT',
    });
    pipeline._handleNotification('search_index_scrape', payload);
    await pipeline._flushAll();

    expect(mockFetchScrapeResult).toHaveBeenCalledWith('task-1', 'ws-3');
  });

  // 6. flushes on batch size threshold
  it('flushes on batch size threshold', async () => {
    const { pipeline } = makePipeline({ batchSize: 2 });
    mockFetchEnrichmentRecord.mockResolvedValue(mockEnrichmentRec);
    mockOsBulk.mockResolvedValue({ body: { errors: false, items: [] } });

    pipeline._handleNotification(
      'search_index_enrichment',
      JSON.stringify({ record_id: 'rec-1', workspace_id: 'ws-1', op: 'INSERT' }),
    );
    pipeline._handleNotification(
      'search_index_enrichment',
      JSON.stringify({ record_id: 'rec-2', workspace_id: 'ws-1', op: 'INSERT' }),
    );

    // Allow the auto-flush triggered by batch size to complete
    await vi.waitFor(() => {
      expect(mockOsBulk).toHaveBeenCalled();
    });
  });

  // 7. _flushAll fetches documents from PG and bulk indexes to OpenSearch
  it('_flushAll fetches documents from PG and bulk indexes to OpenSearch', async () => {
    const { pipeline } = makePipeline();
    mockFetchEnrichmentRecord.mockResolvedValue(mockEnrichmentRec);
    mockOsBulk.mockResolvedValue({ body: { errors: false, items: [] } });

    pipeline._handleNotification(
      'search_index_enrichment',
      JSON.stringify({ record_id: 'rec-1', workspace_id: 'ws-1', op: 'INSERT' }),
    );
    await pipeline._flushAll();

    expect(mockFetchEnrichmentRecord).toHaveBeenCalledWith('rec-1');
    expect(mockOsBulk).toHaveBeenCalledTimes(1);

    const bulkCall = mockOsBulk.mock.calls[0][0];
    const body = bulkCall.body as Record<string, unknown>[];
    // Should have index action + document = 2 entries
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({
      index: { _index: 'morket-workspace-ws-1', _id: 'rec-1' },
    });
    expect(body[1]).toMatchObject({
      document_type: 'enrichment_record',
      record_id: 'rec-1',
      workspace_id: 'ws-1',
    });
  });

  // 8. _flushAll handles DELETE operations
  it('_flushAll handles DELETE operations', async () => {
    const { pipeline } = makePipeline();
    mockOsBulk.mockResolvedValue({ body: { errors: false, items: [] } });

    pipeline._handleNotification(
      'search_index_enrichment',
      JSON.stringify({ record_id: 'rec-1', workspace_id: 'ws-1', op: 'DELETE' }),
    );
    await pipeline._flushAll();

    expect(mockOsBulk).toHaveBeenCalledTimes(1);
    const bulkCall = mockOsBulk.mock.calls[0][0];
    const body = bulkCall.body as Record<string, unknown>[];
    // DELETE produces only a delete action line (no document body)
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
      delete: { _index: 'morket-workspace-ws-1', _id: 'rec-1' },
    });
    // Should NOT fetch from PG for DELETE
    expect(mockFetchEnrichmentRecord).not.toHaveBeenCalled();
  });

  // 9. _flushAll retries on bulk failure
  it('_flushAll retries on bulk failure', async () => {
    const { pipeline } = makePipeline();
    mockFetchEnrichmentRecord.mockResolvedValue(mockEnrichmentRec);
    mockOsBulk
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ body: { errors: false, items: [] } });

    pipeline._handleNotification(
      'search_index_enrichment',
      JSON.stringify({ record_id: 'rec-1', workspace_id: 'ws-1', op: 'INSERT' }),
    );
    await pipeline._flushAll();

    expect(mockOsBulk).toHaveBeenCalledTimes(3);
    expect(pipeline.getStats().totalFlushed).toBe(1);
    expect(pipeline.getStats().totalFailed).toBe(0);
  });

  // 10. _flushAll logs error after all retries exhausted
  it('_flushAll logs error after all retries exhausted', async () => {
    const { pipeline } = makePipeline();
    mockFetchEnrichmentRecord.mockResolvedValue(mockEnrichmentRec);
    mockOsBulk.mockRejectedValue(new Error('persistent failure'));

    pipeline._handleNotification(
      'search_index_enrichment',
      JSON.stringify({ record_id: 'rec-1', workspace_id: 'ws-1', op: 'INSERT' }),
    );
    await pipeline._flushAll();

    // 3 attempts (maxRetries = 3)
    expect(mockOsBulk).toHaveBeenCalledTimes(3);
    expect(pipeline.getStats().totalFailed).toBe(1);
    expect(pipeline.getStats().totalFlushed).toBe(0);
  });

  // 11. _flushAll invalidates cache for affected workspaces
  it('_flushAll invalidates cache for affected workspaces', async () => {
    const { pipeline, mockCache } = makePipeline();
    mockFetchEnrichmentRecord.mockResolvedValue(mockEnrichmentRec);
    mockFetchContactCompanyRecord.mockResolvedValue(mockContactRec);
    mockOsBulk.mockResolvedValue({ body: { errors: false, items: [] } });

    pipeline._handleNotification(
      'search_index_enrichment',
      JSON.stringify({ record_id: 'rec-1', workspace_id: 'ws-1', op: 'INSERT' }),
    );
    pipeline._handleNotification(
      'search_index_records',
      JSON.stringify({ record_id: 'rec-2', workspace_id: 'ws-2', op: 'INSERT' }),
    );
    await pipeline._flushAll();

    expect(mockCache.invalidateWorkspace).toHaveBeenCalledWith('ws-1');
    expect(mockCache.invalidateWorkspace).toHaveBeenCalledWith('ws-2');
  });

  // 12. _flushAll skips documents not found in PG
  it('_flushAll skips documents not found in PG', async () => {
    const { pipeline } = makePipeline();
    mockFetchEnrichmentRecord.mockResolvedValue(null);

    pipeline._handleNotification(
      'search_index_enrichment',
      JSON.stringify({ record_id: 'rec-gone', workspace_id: 'ws-1', op: 'INSERT' }),
    );
    await pipeline._flushAll();

    // No bulk call because the only event produced no document
    expect(mockOsBulk).not.toHaveBeenCalled();
  });

  // 13. getStats returns correct counts
  it('getStats returns correct counts', async () => {
    const { pipeline } = makePipeline();
    mockFetchEnrichmentRecord.mockResolvedValue(mockEnrichmentRec);
    mockOsBulk.mockResolvedValue({ body: { errors: false, items: [] } });

    // Initially empty
    const initial = pipeline.getStats();
    expect(initial.bufferedEvents).toBe(0);
    expect(initial.totalFlushed).toBe(0);
    expect(initial.totalFailed).toBe(0);
    expect(initial.lastFlushAt).toBeNull();

    // Buffer an event
    pipeline._handleNotification(
      'search_index_enrichment',
      JSON.stringify({ record_id: 'rec-1', workspace_id: 'ws-1', op: 'INSERT' }),
    );
    expect(pipeline.getStats().bufferedEvents).toBe(1);

    // Flush
    await pipeline._flushAll();
    const after = pipeline.getStats();
    expect(after.bufferedEvents).toBe(0);
    expect(after.totalFlushed).toBe(1);
    expect(after.totalFailed).toBe(0);
    expect(after.lastFlushAt).toBeInstanceOf(Date);
  });
});
