import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Client, QueryResult } from 'pg';
import { up, down } from '../../migrations/013_create_replication_triggers';

function createMockClient(): Client {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 } as QueryResult),
  } as unknown as Client;
}

function getAllSql(client: Client): string[] {
  return (client.query as ReturnType<typeof vi.fn>).mock.calls.map(
    (call: unknown[]) => call[0] as string,
  );
}

describe('013_create_replication_triggers', () => {
  let client: Client;

  beforeEach(() => {
    client = createMockClient();
  });

  describe('up', () => {
    it('creates notify_enrichment_event trigger function', async () => {
      await up(client);
      const allSql = getAllSql(client);
      const fnSql = allSql.find((s) => s.includes('notify_enrichment_event()'));
      expect(fnSql).toBeDefined();
      expect(fnSql).toContain('CREATE OR REPLACE FUNCTION notify_enrichment_event()');
      expect(fnSql).toContain('RETURNS trigger');
      expect(fnSql).toContain("pg_notify('enrichment_events'");
      expect(fnSql).toContain("'record_id'");
      expect(fnSql).toContain('NEW.id');
      expect(fnSql).toContain("'op'");
      expect(fnSql).toContain('TG_OP');
    });

    it('creates trigger on enrichment_records for AFTER INSERT OR UPDATE', async () => {
      await up(client);
      const allSql = getAllSql(client);
      const triggerSql = allSql.find(
        (s) => s.includes('CREATE TRIGGER trg_enrichment_record_notify'),
      );
      expect(triggerSql).toBeDefined();
      expect(triggerSql).toContain('AFTER INSERT OR UPDATE ON enrichment_records');
      expect(triggerSql).toContain('FOR EACH ROW');
      expect(triggerSql).toContain('EXECUTE FUNCTION notify_enrichment_event()');
    });

    it('drops existing enrichment trigger before creating for idempotency', async () => {
      await up(client);
      const allSql = getAllSql(client);
      const dropIdx = allSql.findIndex((s) =>
        s.includes('DROP TRIGGER IF EXISTS trg_enrichment_record_notify'),
      );
      const createIdx = allSql.findIndex((s) =>
        s.includes('CREATE TRIGGER trg_enrichment_record_notify'),
      );
      expect(dropIdx).toBeGreaterThanOrEqual(0);
      expect(createIdx).toBeGreaterThan(dropIdx);
    });

    it('creates notify_credit_event trigger function', async () => {
      await up(client);
      const allSql = getAllSql(client);
      const fnSql = allSql.find((s) =>
        s.includes('CREATE OR REPLACE FUNCTION notify_credit_event()'),
      );
      expect(fnSql).toBeDefined();
      expect(fnSql).toContain('RETURNS trigger');
      expect(fnSql).toContain("pg_notify('credit_events'");
      expect(fnSql).toContain("'transaction_id'");
      expect(fnSql).toContain('NEW.id');
      expect(fnSql).toContain("'op'");
      expect(fnSql).toContain('TG_OP');
    });

    it('creates trigger on credit_transactions for AFTER INSERT only', async () => {
      await up(client);
      const allSql = getAllSql(client);
      const triggerSql = allSql.find(
        (s) => s.includes('CREATE TRIGGER trg_credit_transaction_notify'),
      );
      expect(triggerSql).toBeDefined();
      expect(triggerSql).toContain('AFTER INSERT ON credit_transactions');
      expect(triggerSql).not.toContain('UPDATE');
      expect(triggerSql).toContain('FOR EACH ROW');
      expect(triggerSql).toContain('EXECUTE FUNCTION notify_credit_event()');
    });

    it('creates notify_scrape_event callable function with UUID parameters', async () => {
      await up(client);
      const allSql = getAllSql(client);
      const fnSql = allSql.find((s) =>
        s.includes('notify_scrape_event(p_task_id UUID, p_job_id UUID)'),
      );
      expect(fnSql).toBeDefined();
      expect(fnSql).toContain('CREATE OR REPLACE FUNCTION');
      expect(fnSql).toContain('RETURNS void');
      expect(fnSql).toContain("pg_notify('scrape_events'");
      expect(fnSql).toContain("'task_id'");
      expect(fnSql).toContain('p_task_id');
      expect(fnSql).toContain("'job_id'");
      expect(fnSql).toContain('p_job_id');
    });

    it('NOTIFY payloads contain only identifiers (under 8KB)', async () => {
      await up(client);
      const allSql = getAllSql(client);

      // Enrichment: only record_id and op
      const enrichFn = allSql.find((s) => s.includes("pg_notify('enrichment_events'"))!;
      expect(enrichFn).toContain('json_build_object');
      expect(enrichFn).not.toContain('NEW.status');
      expect(enrichFn).not.toContain('NEW.workspace_id');

      // Credit: only transaction_id and op
      const creditFn = allSql.find((s) => s.includes("pg_notify('credit_events'"))!;
      expect(creditFn).toContain('json_build_object');
      expect(creditFn).not.toContain('NEW.amount');
      expect(creditFn).not.toContain('NEW.workspace_id');

      // Scrape: only task_id and job_id
      const scrapeFn = allSql.find((s) => s.includes("pg_notify('scrape_events'"))!;
      expect(scrapeFn).toContain('json_build_object');
      expect(scrapeFn).toContain('p_task_id');
      expect(scrapeFn).toContain('p_job_id');
    });

    it('uses CREATE OR REPLACE for all functions (idempotency)', async () => {
      await up(client);
      const allSql = getAllSql(client);
      const functionSqls = allSql.filter((s) => s.includes('CREATE OR REPLACE FUNCTION'));
      expect(functionSqls).toHaveLength(3);
    });

    it('can run up twice without error (idempotency)', async () => {
      await up(client);
      await up(client);

      // 7 queries per up call: 3 functions + 2 drop triggers + 2 create triggers
      expect(client.query).toHaveBeenCalledTimes(14);
    });
  });

  describe('down', () => {
    it('drops triggers before functions (correct order)', async () => {
      await down(client);
      const allSql = getAllSql(client);

      const dropEnrichTrigger = allSql.findIndex((s) =>
        s.includes('DROP TRIGGER IF EXISTS trg_enrichment_record_notify'),
      );
      const dropCreditTrigger = allSql.findIndex((s) =>
        s.includes('DROP TRIGGER IF EXISTS trg_credit_transaction_notify'),
      );
      const dropEnrichFn = allSql.findIndex((s) =>
        s.includes('DROP FUNCTION IF EXISTS notify_enrichment_event()'),
      );
      const dropCreditFn = allSql.findIndex((s) =>
        s.includes('DROP FUNCTION IF EXISTS notify_credit_event()'),
      );
      const dropScrapeFn = allSql.findIndex((s) =>
        s.includes('DROP FUNCTION IF EXISTS notify_scrape_event'),
      );

      // Triggers dropped before their functions
      expect(dropEnrichTrigger).toBeLessThan(dropEnrichFn);
      expect(dropCreditTrigger).toBeLessThan(dropCreditFn);
      // All exist
      expect(dropScrapeFn).toBeGreaterThanOrEqual(0);
    });

    it('uses IF EXISTS for all drops (idempotency)', async () => {
      await down(client);
      const allSql = getAllSql(client);

      for (const sql of allSql) {
        expect(sql).toMatch(/DROP (TRIGGER|FUNCTION) IF EXISTS/);
      }
    });

    it('can run down twice without error (idempotency)', async () => {
      await down(client);
      await down(client);

      // 5 queries per down call
      expect(client.query).toHaveBeenCalledTimes(10);
    });
  });

  describe('up then down then up (full cycle)', () => {
    it('completes a full migration cycle without error', async () => {
      await up(client);
      await down(client);
      await up(client);

      // 7 + 5 + 7 = 19 queries
      expect(client.query).toHaveBeenCalledTimes(19);
    });
  });
});
