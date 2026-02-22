import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  insertDLQEvent,
  getPendingEvents,
  markReplayed,
  markExhausted,
  incrementRetry,
  resetExhausted,
  listEvents,
  type DeadLetterEvent,
} from './dlq.repository';

const mockQuery = vi.fn();
vi.mock('../../shared/db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const now = new Date('2024-06-15T12:00:00Z');
const later = new Date('2024-06-15T13:00:00Z');

const sampleRow = {
  id: 'dlq-1111-2222-3333-444444444444',
  channel: 'enrichment_events',
  event_payload: { record_id: 'rec-1', op: 'INSERT' },
  error_reason: 'ClickHouse connection refused',
  retry_count: 0,
  max_retries: 5,
  status: 'pending' as const,
  created_at: now,
  next_retry_at: now,
};

const expectedEvent: DeadLetterEvent = {
  id: sampleRow.id,
  channel: sampleRow.channel,
  eventPayload: sampleRow.event_payload,
  errorReason: sampleRow.error_reason,
  retryCount: 0,
  maxRetries: 5,
  status: 'pending',
  createdAt: now,
  nextRetryAt: now,
};

describe('dlq.repository', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('insertDLQEvent', () => {
    it('inserts with parameterized query and returns mapped DeadLetterEvent', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [sampleRow] });

      const result = await insertDLQEvent({
        channel: 'enrichment_events',
        eventPayload: { record_id: 'rec-1', op: 'INSERT' },
        errorReason: 'ClickHouse connection refused',
        retryCount: 0,
        maxRetries: 5,
        status: 'pending',
        nextRetryAt: now,
      });

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO dead_letter_queue');
      expect(sql).toContain('$1');
      expect(sql).toContain('$7');
      expect(params).toHaveLength(7);
      expect(params[0]).toBe('enrichment_events');
      expect(params[3]).toBe(0);
      expect(params[4]).toBe(5);
      expect(params[5]).toBe('pending');
      expect(result).toEqual(expectedEvent);
    });
  });

  describe('getPendingEvents', () => {
    it('fetches pending events where next_retry_at <= NOW()', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [sampleRow] });

      const events = await getPendingEvents(10);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("status = 'pending'");
      expect(sql).toContain('next_retry_at <= NOW()');
      expect(sql).toContain('LIMIT $1');
      expect(params).toEqual([10]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(expectedEvent);
    });

    it('returns empty array when no pending events', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const events = await getPendingEvents(10);

      expect(events).toEqual([]);
    });
  });

  describe('markReplayed', () => {
    it('updates status to replayed with parameterized query', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await markReplayed(sampleRow.id);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("SET status = 'replayed'");
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual([sampleRow.id]);
    });
  });

  describe('markExhausted', () => {
    it('updates status to exhausted with parameterized query', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await markExhausted(sampleRow.id);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("SET status = 'exhausted'");
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual([sampleRow.id]);
    });
  });

  describe('incrementRetry', () => {
    it('increments retry_count and sets next_retry_at', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await incrementRetry(sampleRow.id, later);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('retry_count = retry_count + 1');
      expect(sql).toContain('next_retry_at = $2');
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual([sampleRow.id, later]);
    });
  });

  describe('resetExhausted', () => {
    it('resets all exhausted events to pending and returns count', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 3 });

      const count = await resetExhausted();

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain("SET status = 'pending'");
      expect(sql).toContain('retry_count = 0');
      expect(sql).toContain("WHERE status = 'exhausted'");
      expect(count).toBe(3);
    });

    it('returns 0 when no exhausted events exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const count = await resetExhausted();

      expect(count).toBe(0);
    });
  });

  describe('listEvents', () => {
    it('returns paginated results without status filter', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [sampleRow] })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });

      const result = await listEvents({ page: 1, limit: 50 });

      expect(mockQuery).toHaveBeenCalledTimes(2);
      // Data query
      const [dataSql, dataParams] = mockQuery.mock.calls[0];
      expect(dataSql).toContain('SELECT');
      expect(dataSql).toContain('FROM dead_letter_queue');
      expect(dataSql).toContain('ORDER BY created_at DESC');
      expect(dataSql).toContain('LIMIT');
      expect(dataSql).toContain('OFFSET');
      expect(dataParams).toEqual([50, 0]);
      // Count query
      const [countSql, countParams] = mockQuery.mock.calls[1];
      expect(countSql).toContain('COUNT(*)');
      expect(countParams).toEqual([]);

      expect(result).toEqual({
        items: [expectedEvent],
        total: 1,
        page: 1,
        limit: 50,
      });
    });

    it('applies status filter when provided', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const result = await listEvents({ page: 1, limit: 10, status: 'exhausted' });

      expect(mockQuery).toHaveBeenCalledTimes(2);
      const [dataSql, dataParams] = mockQuery.mock.calls[0];
      expect(dataSql).toContain('status = $1');
      expect(dataParams).toEqual(['exhausted', 10, 0]);

      const [countSql, countParams] = mockQuery.mock.calls[1];
      expect(countSql).toContain('status = $1');
      expect(countParams).toEqual(['exhausted']);

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('calculates correct offset for page 2', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: '100' }] });

      const result = await listEvents({ page: 2, limit: 25 });

      const [, dataParams] = mockQuery.mock.calls[0];
      expect(dataParams).toEqual([25, 25]); // limit=25, offset=(2-1)*25=25
      expect(result.page).toBe(2);
      expect(result.limit).toBe(25);
      expect(result.total).toBe(100);
    });
  });
});
