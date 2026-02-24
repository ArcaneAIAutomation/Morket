import type { Response } from 'express';
import { getClickHouse } from '../../clickhouse/client';
import type { TimeRange } from './analytics.schemas';

export interface CSVExportOptions {
  workspaceId: string;
  table: 'enrichment' | 'scraping' | 'credits';
  timeRange: TimeRange;
}

// Column definitions per table
const TABLE_COLUMNS: Record<CSVExportOptions['table'], string[]> = {
  enrichment: [
    'event_id', 'workspace_id', 'job_id', 'record_id', 'provider_slug',
    'enrichment_field', 'status', 'credits_consumed', 'duration_ms',
    'error_category', 'created_at', 'job_created_at',
  ],
  scraping: [
    'event_id', 'workspace_id', 'job_id', 'task_id', 'target_domain',
    'target_type', 'status', 'duration_ms', 'proxy_used',
    'error_category', 'created_at', 'job_created_at',
  ],
  credits: [
    'event_id', 'workspace_id', 'transaction_type', 'amount', 'source',
    'reference_id', 'provider_slug', 'created_at',
  ],
};

const CH_TABLE_NAMES: Record<CSVExportOptions['table'], string> = {
  enrichment: 'enrichment_events',
  scraping: 'scrape_events',
  credits: 'credit_events',
};

/**
 * Escapes a CSV field value per RFC 4180.
 * Fields containing commas, double quotes, or newlines are wrapped in double quotes.
 * Double quotes within fields are escaped by doubling them.
 */
export function escapeCSVField(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Converts a row object to a CSV line string.
 */
export function rowToCSVLine(row: Record<string, unknown>, columns: string[]): string {
  return columns
    .map((col) => {
      const val = row[col];
      if (val === null || val === undefined) return '';
      return escapeCSVField(String(val));
    })
    .join(',');
}

/**
 * Streams ClickHouse query results as CSV with proper headers.
 * Uses chunked transfer encoding — rows are written as they arrive.
 */
export async function streamCSVExport(res: Response, options: CSVExportOptions): Promise<void> {
  const { workspaceId, table, timeRange } = options;
  const columns = TABLE_COLUMNS[table];
  const chTable = CH_TABLE_NAMES[table];

  const startStr = timeRange.start.toISOString().split('T')[0];
  const endStr = timeRange.end.toISOString().split('T')[0];
  const filename = `${table}-${workspaceId}-${startStr}-${endStr}.csv`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Transfer-Encoding', 'chunked');

  // Write header row
  res.write(columns.map(escapeCSVField).join(',') + '\n');

  const ch = getClickHouse();
  const result = await ch.query({
    query: `
      SELECT ${columns.join(', ')}
      FROM ${chTable}
      WHERE workspace_id = {workspaceId:UUID}
        AND created_at BETWEEN {start:DateTime64} AND {end:DateTime64}
      ORDER BY created_at ASC
    `,
    query_params: {
      workspaceId,
      start: timeRange.start.toISOString(),
      end: timeRange.end.toISOString(),
    },
    format: 'JSONEachRow',
  });

  const stream = result.stream();

  for await (const rows of stream) {
    // Each chunk from the stream is an array of row objects
    const rowArray = Array.isArray(rows) ? rows : [rows];
    for (const row of rowArray) {
      const parsed = typeof row === 'object' && row !== null ? row as unknown as Record<string, unknown> : JSON.parse(String(row));
      res.write(rowToCSVLine(parsed, columns) + '\n');
    }
  }

  res.end();
}
