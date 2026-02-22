import { describe, it, expect, vi, beforeEach } from 'vitest';
import { escapeCSVField, rowToCSVLine, streamCSVExport } from './csv-exporter';
import type { Response } from 'express';

// Mock the ClickHouse client module
vi.mock('../../clickhouse/client', () => {
  const mockQuery = vi.fn();
  return {
    getClickHouse: () => ({ query: mockQuery }),
    __mockQuery: mockQuery,
  };
});

// Access the mock query function
import { getClickHouse } from '../../clickhouse/client';

function getMockQuery() {
  return (getClickHouse() as unknown as { query: ReturnType<typeof vi.fn> }).query;
}

describe('CSV Exporter', () => {
  describe('escapeCSVField', () => {
    it('returns plain value unchanged', () => {
      expect(escapeCSVField('hello')).toBe('hello');
    });

    it('wraps value containing comma in double quotes', () => {
      expect(escapeCSVField('hello,world')).toBe('"hello,world"');
    });

    it('wraps value containing double quote and escapes it', () => {
      expect(escapeCSVField('say "hi"')).toBe('"say ""hi"""');
    });

    it('wraps value containing newline', () => {
      expect(escapeCSVField('line1\nline2')).toBe('"line1\nline2"');
    });

    it('wraps value containing carriage return', () => {
      expect(escapeCSVField('line1\rline2')).toBe('"line1\rline2"');
    });

    it('handles value with commas, quotes, and newlines together', () => {
      expect(escapeCSVField('a,"b"\nc')).toBe('"a,""b""\nc"');
    });

    it('returns empty string unchanged', () => {
      expect(escapeCSVField('')).toBe('');
    });
  });

  describe('rowToCSVLine', () => {
    it('maps columns in order', () => {
      const row = { a: '1', b: '2', c: '3' };
      expect(rowToCSVLine(row, ['c', 'a', 'b'])).toBe('3,1,2');
    });

    it('handles null/undefined as empty string', () => {
      const row = { a: '1', b: null, c: undefined };
      expect(rowToCSVLine(row, ['a', 'b', 'c'])).toBe('1,,');
    });

    it('escapes fields that need escaping', () => {
      const row = { name: 'O"Brien', city: 'New York, NY' };
      expect(rowToCSVLine(row, ['name', 'city'])).toBe('"O""Brien","New York, NY"');
    });
  });

  describe('streamCSVExport', () => {
    let mockRes: Response;
    let written: string[];

    beforeEach(() => {
      vi.clearAllMocks();
      written = [];
      mockRes = {
        setHeader: vi.fn(),
        write: vi.fn((chunk: string) => { written.push(chunk); return true; }),
        end: vi.fn(),
      } as unknown as Response;
    });

    it('sets correct Content-Type and Content-Disposition headers', async () => {
      const mockQuery = getMockQuery();
      const mockStream = (async function* () { /* empty */ })();
      mockQuery.mockResolvedValue({ stream: () => mockStream });

      await streamCSVExport(mockRes, {
        workspaceId: '00000000-0000-0000-0000-000000000001',
        table: 'enrichment',
        timeRange: { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
      });

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="enrichment-00000000-0000-0000-0000-000000000001-2024-01-01-2024-01-31.csv"',
      );
    });

    it('writes header row as first line for credits table', async () => {
      const mockQuery = getMockQuery();
      const mockStream = (async function* () { /* empty */ })();
      mockQuery.mockResolvedValue({ stream: () => mockStream });

      await streamCSVExport(mockRes, {
        workspaceId: '00000000-0000-0000-0000-000000000001',
        table: 'credits',
        timeRange: { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
      });

      expect(written[0]).toBe(
        'event_id,workspace_id,transaction_type,amount,source,reference_id,provider_slug,created_at\n',
      );
    });

    it('streams data rows after header', async () => {
      const mockQuery = getMockQuery();
      const rows = [
        { event_id: 'abc', workspace_id: 'ws1', transaction_type: 'debit', amount: '100', source: 'enrichment', reference_id: '', provider_slug: 'apollo', created_at: '2024-01-15' },
      ];
      const mockStream = (async function* () { yield rows; })();
      mockQuery.mockResolvedValue({ stream: () => mockStream });

      await streamCSVExport(mockRes, {
        workspaceId: 'ws1',
        table: 'credits',
        timeRange: { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
      });

      // Header + 1 data row
      expect(written.length).toBe(2);
      expect(written[1]).toBe('abc,ws1,debit,100,enrichment,,apollo,2024-01-15\n');
    });

    it('calls res.end() after streaming', async () => {
      const mockQuery = getMockQuery();
      const mockStream = (async function* () { /* empty */ })();
      mockQuery.mockResolvedValue({ stream: () => mockStream });

      await streamCSVExport(mockRes, {
        workspaceId: '00000000-0000-0000-0000-000000000001',
        table: 'scraping',
        timeRange: { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
      });

      expect(mockRes.end).toHaveBeenCalledTimes(1);
    });

    it('escapes fields with special characters in streamed rows', async () => {
      const mockQuery = getMockQuery();
      const rows = [
        { event_id: 'id1', workspace_id: 'ws1', transaction_type: 'debit', amount: '50', source: 'manual, test', reference_id: '', provider_slug: 'say "hi"', created_at: '2024-01-15' },
      ];
      const mockStream = (async function* () { yield rows; })();
      mockQuery.mockResolvedValue({ stream: () => mockStream });

      await streamCSVExport(mockRes, {
        workspaceId: 'ws1',
        table: 'credits',
        timeRange: { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
      });

      expect(written[1]).toBe('id1,ws1,debit,50,"manual, test",,"say ""hi""",2024-01-15\n');
    });
  });
});
