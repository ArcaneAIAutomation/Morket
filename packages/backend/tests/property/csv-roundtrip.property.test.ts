import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { escapeCSVField, rowToCSVLine } from '../../src/modules/analytics/csv-exporter';

const NUM_RUNS = 100;

/**
 * Minimal RFC 4180 CSV parser for round-trip testing.
 * Parses a single CSV line into an array of field values.
 */
function parseCSVLine(line: string): string[] {
  if (line === '') return [''];

  const fields: string[] = [];
  let pos = 0;

  while (pos <= line.length) {
    if (pos === line.length) {
      // We only get here if the line ended with a comma
      fields.push('');
      break;
    }

    if (line[pos] === '"') {
      // Quoted field: read until closing quote
      let value = '';
      pos++; // skip opening quote
      while (pos < line.length) {
        if (line[pos] === '"') {
          if (pos + 1 < line.length && line[pos + 1] === '"') {
            // Escaped quote
            value += '"';
            pos += 2;
          } else {
            // Closing quote
            pos++;
            break;
          }
        } else {
          value += line[pos];
          pos++;
        }
      }
      fields.push(value);
      if (pos < line.length && line[pos] === ',') {
        pos++; // skip separator
        // Continue to parse next field
      } else {
        break; // end of line
      }
    } else {
      // Unquoted field: read until comma or end
      const commaIdx = line.indexOf(',', pos);
      if (commaIdx === -1) {
        fields.push(line.slice(pos));
        break;
      } else {
        fields.push(line.slice(pos, commaIdx));
        pos = commaIdx + 1;
        // Continue to parse next field
      }
    }
  }

  return fields;
}

/**
 * Arbitrary for generating CSV-safe string values.
 * Includes commas, double quotes, newlines, and normal text.
 */
const csvFieldArb = fc.stringOf(
  fc.oneof(
    fc.char(),
    fc.constantFrom(',', '"', '\n', '\r'),
  ),
  { minLength: 0, maxLength: 50 },
);

/**
 * Arbitrary for generating a row of analytics-like data.
 * Uses a fixed set of column names matching the credit_events table.
 */
const creditColumns = [
  'event_id', 'workspace_id', 'transaction_type', 'amount',
  'source', 'reference_id', 'provider_slug', 'created_at',
];

const creditRowArb = fc.record({
  event_id: fc.uuid(),
  workspace_id: fc.uuid(),
  transaction_type: fc.constantFrom('debit', 'refund', 'topup'),
  amount: fc.integer({ min: 0, max: 100000 }).map(String),
  source: fc.constantFrom('enrichment', 'scraping', 'manual'),
  reference_id: fc.oneof(fc.uuid(), fc.constant('')),
  provider_slug: fc.constantFrom('apollo', 'clearbit', 'hunter', ''),
  created_at: fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') }).map((d) => d.toISOString()),
});

describe('Property 4: CSV round-trip fidelity', () => {
  /**
   * Property 4: CSV round-trip fidelity
   * For any set of analytics event rows, serializing to CSV via the exporter
   * and parsing the CSV back SHALL produce field values identical to the originals.
   * Special characters (commas, quotes, newlines) SHALL survive the round-trip.
   *
   * **Validates: Requirements 6.6, 6.7**
   */
  it('escapeCSVField round-trip: escape → parse → re-escape produces identical output', () => {
    fc.assert(
      fc.property(csvFieldArb, (value) => {
        const escaped = escapeCSVField(value);
        // Parse the escaped value back (it's a single-field CSV line)
        const parsed = parseCSVLine(escaped);
        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toBe(value);

        // Re-escape and verify identical output
        const reEscaped = escapeCSVField(parsed[0]);
        expect(reEscaped).toBe(escaped);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rowToCSVLine round-trip: serialize → parse → re-serialize produces identical CSV', () => {
    fc.assert(
      fc.property(creditRowArb, (row) => {
        const csvLine = rowToCSVLine(row as Record<string, unknown>, creditColumns);

        // Parse the CSV line back into fields
        const parsedFields = parseCSVLine(csvLine);
        expect(parsedFields).toHaveLength(creditColumns.length);

        // Reconstruct the row from parsed fields
        const reconstructed: Record<string, unknown> = {};
        creditColumns.forEach((col, i) => {
          reconstructed[col] = parsedFields[i];
        });

        // Re-serialize and compare
        const reSerializedLine = rowToCSVLine(reconstructed, creditColumns);
        expect(reSerializedLine).toBe(csvLine);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rowToCSVLine round-trip with special characters in fields', () => {
    const specialRowArb = fc.record(
      Object.fromEntries(creditColumns.map((col) => [col, csvFieldArb])),
    );

    fc.assert(
      fc.property(specialRowArb, (row) => {
        const csvLine = rowToCSVLine(row as Record<string, unknown>, creditColumns);
        const parsedFields = parseCSVLine(csvLine);
        expect(parsedFields).toHaveLength(creditColumns.length);

        // Verify each field survived the round-trip
        creditColumns.forEach((col, i) => {
          expect(parsedFields[i]).toBe(row[col]);
        });

        // Re-serialize and verify byte-identical output
        const reconstructed: Record<string, unknown> = {};
        creditColumns.forEach((col, i) => {
          reconstructed[col] = parsedFields[i];
        });
        const reSerializedLine = rowToCSVLine(reconstructed, creditColumns);
        expect(reSerializedLine).toBe(csvLine);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
