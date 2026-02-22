import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Client, QueryResult } from 'pg';
import { up, down } from '../../migrations/012_create_dead_letter_queue';

function createMockClient(): Client {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 } as QueryResult),
  } as unknown as Client;
}

describe('012_create_dead_letter_queue', () => {
  let client: Client;

  beforeEach(() => {
    client = createMockClient();
  });

  describe('up', () => {
    it('creates dead_letter_queue table with correct columns and partial index', async () => {
      await up(client);

      const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS dead_letter_queue');
      expect(sql).toContain('id UUID PRIMARY KEY DEFAULT gen_random_uuid()');
      expect(sql).toContain('channel VARCHAR(50) NOT NULL');
      expect(sql).toContain('event_payload JSONB NOT NULL');
      expect(sql).toContain('error_reason TEXT NOT NULL');
      expect(sql).toContain('retry_count INTEGER NOT NULL DEFAULT 0');
      expect(sql).toContain('max_retries INTEGER NOT NULL DEFAULT 5');
      expect(sql).toContain("status VARCHAR(20) NOT NULL DEFAULT 'pending'");
      expect(sql).toContain('created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
      expect(sql).toContain('next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
      expect(sql).toContain('idx_dlq_status_next_retry');
      expect(sql).toContain("WHERE status = 'pending'");
    });

    it('uses IF NOT EXISTS for idempotent table creation', async () => {
      await up(client);

      const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS');
    });

    it('can run up twice without error (idempotency)', async () => {
      await up(client);
      await up(client);

      expect(client.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('down', () => {
    it('drops dead_letter_queue table with CASCADE', async () => {
      await down(client);

      const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('DROP TABLE IF EXISTS dead_letter_queue CASCADE');
    });

    it('uses IF EXISTS for idempotent drop', async () => {
      await down(client);

      const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('DROP TABLE IF EXISTS');
    });

    it('can run down twice without error (idempotency)', async () => {
      await down(client);
      await down(client);

      expect(client.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('up then down then up (full cycle)', () => {
    it('completes a full migration cycle without error', async () => {
      await up(client);
      await down(client);
      await up(client);

      expect(client.query).toHaveBeenCalledTimes(3);
    });
  });
});
