import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock setup (must be before service import) ---

const mockInsert = vi.fn().mockResolvedValue(undefined);
const mockClickHouseClient = { insert: mockInsert };

vi.mock('../../clickhouse/client', () => ({
  getClickHouse: () => mockClickHouseClient,
}));

vi.mock('../../config/env', () => ({
  env: { DATABASE_URL: 'postgresql://localhost/test' },
}));

vi.mock('../../shared/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockFetchEnrichment = vi.fn().mockResolvedValue([]);
const mockFetchCredit = vi.fn().mockResolvedValue([]);
const mockFetchScrape = vi.fn().mockResolvedValue([]);

vi.mock('./replication.queries', () => ({
  fetchEnrichmentEvents: (...args: unknown[]) => mockFetchEnrichment(...args),
  fetchCreditEvents: (...args: unknown[]) => mockFetchCredit(...args),
  fetchScrapeEvents: (...args: unknown[]) => mockFetchScrape(...args),
}));

import { createReplicationService } from './replication.service';
import type { DLQRepository } from './dlq.repository';
import type { AnalyticsCache } from '../analytics/analytics.cache';

// --- Helpers ---

function makeEnrichmentPayload(recordId: string) {
  return JSON.stringify({ record_id: recordId, op: 'INSERT' });
}

function makeCreditPayload(transactionId: string) {
  return JSON.stringify({ transaction_id: transactionId, op: 'INSERT' });
}

function makeScrapePayload(taskId: string, jobId: string) {
  return JSON.stringify({ task_id: taskId, job_id: jobId });
}

function makeEnrichmentRow(recordId: string, workspaceId = 'ws-1') {
  return {
    event_id: recordId,
    workspace_id: workspaceId,
    job_id: 'job-1',
    record_id: recordId,
    provider_slug: 'apollo',
    enrichment_field: 'email',
    status: 'success',
    credits_consumed: 2,
    duration_ms: 150,
    error_category: null,
    created_at: '2024-06-01T00:00:00Z',
    job_created_at: '2024-06-01T00:00:00Z',
  };
}

function makeCreditRow(txId: string, workspaceId = 'ws-1') {
  return {
    event_id: txId,
    workspace_id: workspaceId,
    transaction_type: 'debit',
    amount: 2,
    source: 'enrichment',
    reference_id: null,
    provider_slug: null,
    created_at: '2024-06-01T00:00:00Z',
  };
}

// ---------------------------------------------------------------
// Buffer flush logic tests
// ---------------------------------------------------------------
describe('replication.service — buffer flush logic', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('buffers events via _handleNotification', () => {
    const svc = createReplicationService({ batchSize: 100, flushIntervalMs: 5000 });

    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-1'));
    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-2'));
    svc._handleNotification('credit_events', makeCreditPayload('tx-1'));

    expect(svc._getTotalBuffered()).toBe(3);

    const buffers = svc._getBuffers();
    expect(buffers.enrichment_events).toHaveLength(2);
    expect(buffers.credit_events).toHaveLength(1);
    expect(buffers.scrape_events).toHaveLength(0);
  });

  it('extracts correct IDs from payloads per channel', () => {
    const svc = createReplicationService({ batchSize: 1000 });

    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-abc'));
    svc._handleNotification('credit_events', makeCreditPayload('tx-xyz'));
    svc._handleNotification('scrape_events', makeScrapePayload('task-123', 'job-456'));

    const buffers = svc._getBuffers();
    expect(buffers.enrichment_events[0].id).toBe('rec-abc');
    expect(buffers.credit_events[0].id).toBe('tx-xyz');
    expect(buffers.scrape_events[0].id).toBe('task-123');
  });

  it('ignores invalid JSON payloads without crashing', () => {
    const svc = createReplicationService({ batchSize: 1000 });

    svc._handleNotification('enrichment_events', 'not-json');
    svc._handleNotification('enrichment_events', undefined);

    expect(svc._getTotalBuffered()).toBe(0);
  });

  it('ignores unknown channels', () => {
    const svc = createReplicationService({ batchSize: 1000 });

    svc._handleNotification('unknown_channel', makeEnrichmentPayload('rec-1'));

    expect(svc._getTotalBuffered()).toBe(0);
  });

  it('triggers flush when batch size is reached', async () => {
    const batchSize = 3;
    mockFetchEnrichment.mockResolvedValue([
      makeEnrichmentRow('rec-1'),
      makeEnrichmentRow('rec-2'),
      makeEnrichmentRow('rec-3'),
    ]);

    const svc = createReplicationService({ batchSize, flushIntervalMs: 60_000 });

    // Add events up to batch size
    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-1'));
    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-2'));
    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-3'));

    // Allow the async flush triggered by batch size to complete
    await vi.advanceTimersByTimeAsync(0);

    expect(mockFetchEnrichment).toHaveBeenCalledWith(['rec-1', 'rec-2', 'rec-3']);
    expect(mockInsert).toHaveBeenCalledWith({
      table: 'enrichment_events',
      values: expect.any(Array),
      format: 'JSONEachRow',
    });
    expect(svc._getTotalBuffered()).toBe(0);
  });

  it('flushes on interval timer when buffer is not full', async () => {
    mockFetchEnrichment.mockResolvedValue([makeEnrichmentRow('rec-1')]);

    const svc = createReplicationService({ batchSize: 100, flushIntervalMs: 5000 });

    // Simulate start (which sets up the interval) — we test _flushAll directly
    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-1'));

    expect(svc._getTotalBuffered()).toBe(1);

    // Manually trigger flush (simulating what the interval would do)
    await svc._flushAll();

    expect(mockFetchEnrichment).toHaveBeenCalledWith(['rec-1']);
    expect(mockInsert).toHaveBeenCalled();
    expect(svc._getTotalBuffered()).toBe(0);
  });

  it('flushes multiple channels in a single flush cycle', async () => {
    mockFetchEnrichment.mockResolvedValue([makeEnrichmentRow('rec-1')]);
    mockFetchCredit.mockResolvedValue([makeCreditRow('tx-1')]);

    const svc = createReplicationService({ batchSize: 100 });

    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-1'));
    svc._handleNotification('credit_events', makeCreditPayload('tx-1'));

    await svc._flushAll();

    expect(mockFetchEnrichment).toHaveBeenCalledWith(['rec-1']);
    expect(mockFetchCredit).toHaveBeenCalledWith(['tx-1']);
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(svc._getTotalBuffered()).toBe(0);
  });

  it('does not flush when buffer is empty', async () => {
    const svc = createReplicationService({ batchSize: 100 });

    await svc._flushAll();

    expect(mockFetchEnrichment).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('updates stats after successful flush', async () => {
    mockFetchEnrichment.mockResolvedValue([
      makeEnrichmentRow('rec-1'),
      makeEnrichmentRow('rec-2'),
    ]);

    const svc = createReplicationService({ batchSize: 100 });

    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-1'));
    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-2'));

    await svc._flushAll();

    const stats = svc.getStats();
    expect(stats.totalFlushed).toBe(2);
    expect(stats.bufferedEvents).toBe(0);
    expect(stats.lastFlushAt).toBeInstanceOf(Date);
  });

  it('skips channel when PG returns no rows', async () => {
    mockFetchEnrichment.mockResolvedValue([]);

    const svc = createReplicationService({ batchSize: 100 });

    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-1'));

    await svc._flushAll();

    // Should not attempt ClickHouse insert when no rows returned
    expect(mockInsert).not.toHaveBeenCalled();
    expect(svc._getTotalBuffered()).toBe(0);
  });
});

// ---------------------------------------------------------------
// Retry behavior and DLQ fallback tests
// ---------------------------------------------------------------
describe('replication.service — retry and DLQ', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries ClickHouse insert on failure and succeeds on second attempt', async () => {
    mockFetchEnrichment.mockResolvedValue([makeEnrichmentRow('rec-1')]);
    mockInsert
      .mockRejectedValueOnce(new Error('CH connection refused'))
      .mockResolvedValueOnce(undefined);

    const svc = createReplicationService({
      batchSize: 100,
      maxRetries: 3,
      retryBackoffMs: [10, 20, 40], // Short backoffs for testing
    });

    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-1'));

    // Run flush — it will retry internally with sleep
    const flushPromise = svc._flushAll();
    // Advance timers to cover the retry backoff
    await vi.advanceTimersByTimeAsync(100);
    await flushPromise;

    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(svc.getStats().totalFlushed).toBe(1);
    expect(svc.getStats().totalFailed).toBe(0);
  });

  it('writes to DLQ after all retries exhausted', async () => {
    mockFetchEnrichment.mockResolvedValue([makeEnrichmentRow('rec-1')]);
    mockInsert.mockRejectedValue(new Error('CH permanently down'));

    const mockDLQ: DLQRepository = {
      insertDLQEvent: vi.fn().mockResolvedValue({ id: 'dlq-1' }),
      getPendingEvents: vi.fn().mockResolvedValue([]),
      markReplayed: vi.fn(),
      markExhausted: vi.fn(),
      incrementRetry: vi.fn(),
      resetExhausted: vi.fn(),
    };

    const svc = createReplicationService(
      { batchSize: 100, maxRetries: 3, retryBackoffMs: [10, 20, 40] },
      { dlqRepository: mockDLQ },
    );

    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-1'));

    const flushPromise = svc._flushAll();
    await vi.advanceTimersByTimeAsync(200);
    await flushPromise;

    // 3 attempts total
    expect(mockInsert).toHaveBeenCalledTimes(3);

    // DLQ should have received the failed event
    expect(mockDLQ.insertDLQEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'enrichment_events',
        errorReason: 'CH permanently down',
        retryCount: 0,
        maxRetries: 5,
        status: 'pending',
      }),
    );

    const stats = svc.getStats();
    expect(stats.totalFailed).toBe(1);
    expect(stats.dlqPending).toBe(1);
  });

  it('logs error when DLQ repository is not available', async () => {
    mockFetchEnrichment.mockResolvedValue([makeEnrichmentRow('rec-1')]);
    mockInsert.mockRejectedValue(new Error('CH down'));

    const svc = createReplicationService(
      { batchSize: 100, maxRetries: 1, retryBackoffMs: [10] },
      { dlqRepository: undefined },
    );

    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-1'));

    const flushPromise = svc._flushAll();
    await vi.advanceTimersByTimeAsync(100);
    await flushPromise;

    // Should still track the failure in stats
    expect(svc.getStats().totalFailed).toBe(1);
  });

  it('invalidates analytics cache for affected workspace IDs on success', async () => {
    mockFetchEnrichment.mockResolvedValue([
      makeEnrichmentRow('rec-1', 'ws-aaa'),
      makeEnrichmentRow('rec-2', 'ws-bbb'),
      makeEnrichmentRow('rec-3', 'ws-aaa'), // duplicate workspace
    ]);

    const mockCache: AnalyticsCache = {
      get: vi.fn(),
      set: vi.fn(),
      invalidateWorkspace: vi.fn(),
      clear: vi.fn(),
      size: vi.fn().mockReturnValue(0),
    };

    const svc = createReplicationService(
      { batchSize: 100 },
      { analyticsCache: mockCache },
    );

    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-1'));
    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-2'));
    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-3'));

    await svc._flushAll();

    // Should invalidate each unique workspace once
    expect(mockCache.invalidateWorkspace).toHaveBeenCalledTimes(2);
    expect(mockCache.invalidateWorkspace).toHaveBeenCalledWith('ws-aaa');
    expect(mockCache.invalidateWorkspace).toHaveBeenCalledWith('ws-bbb');
  });

  it('does not invalidate cache when analyticsCache is not provided', async () => {
    mockFetchEnrichment.mockResolvedValue([makeEnrichmentRow('rec-1')]);

    const svc = createReplicationService(
      { batchSize: 100 },
      { analyticsCache: undefined },
    );

    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-1'));

    // Should not throw
    await svc._flushAll();

    expect(svc.getStats().totalFlushed).toBe(1);
  });

  it('handles DLQ write failure gracefully', async () => {
    mockFetchEnrichment.mockResolvedValue([makeEnrichmentRow('rec-1')]);
    mockInsert.mockRejectedValue(new Error('CH down'));

    const mockDLQ: DLQRepository = {
      insertDLQEvent: vi.fn().mockRejectedValue(new Error('DLQ write failed')),
      getPendingEvents: vi.fn().mockResolvedValue([]),
      markReplayed: vi.fn(),
      markExhausted: vi.fn(),
      incrementRetry: vi.fn(),
      resetExhausted: vi.fn(),
    };

    const svc = createReplicationService(
      { batchSize: 100, maxRetries: 1, retryBackoffMs: [10] },
      { dlqRepository: mockDLQ },
    );

    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-1'));

    const flushPromise = svc._flushAll();
    await vi.advanceTimersByTimeAsync(100);
    await flushPromise;

    // Should not crash — failure is logged
    expect(svc.getStats().totalFailed).toBe(1);
  });

  it('retries with correct exponential backoff delays', async () => {
    mockFetchEnrichment.mockResolvedValue([makeEnrichmentRow('rec-1')]);
    mockInsert.mockRejectedValue(new Error('CH down'));

    const mockDLQ: DLQRepository = {
      insertDLQEvent: vi.fn().mockResolvedValue({ id: 'dlq-1' }),
      getPendingEvents: vi.fn().mockResolvedValue([]),
      markReplayed: vi.fn(),
      markExhausted: vi.fn(),
      incrementRetry: vi.fn(),
      resetExhausted: vi.fn(),
    };

    const svc = createReplicationService(
      { batchSize: 100, maxRetries: 3, retryBackoffMs: [1000, 2000, 4000] },
      { dlqRepository: mockDLQ },
    );

    svc._handleNotification('enrichment_events', makeEnrichmentPayload('rec-1'));

    const flushPromise = svc._flushAll();

    // First attempt happens immediately, then waits 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    // Second retry waits 2000ms
    await vi.advanceTimersByTimeAsync(2000);
    // After 3 attempts, should go to DLQ
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromise;

    expect(mockInsert).toHaveBeenCalledTimes(3);
    expect(mockDLQ.insertDLQEvent).toHaveBeenCalled();
  });
});
