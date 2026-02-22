import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Replicate CSV worker logic for direct testing (Web Workers can't be imported)
// ---------------------------------------------------------------------------

function escapeCSVField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

function generateCSV(rows: Record<string, unknown>[], columns: string[]): string {
  const headerLine = columns.map(escapeCSVField).join(',');
  const dataLines = rows.map((row) =>
    columns.map((col) => {
      const val = row[col];
      return escapeCSVField(val == null ? '' : String(val));
    }).join(','),
  );
  return [headerLine, ...dataLines].join('\n');
}

function parseCSV(
  fileContent: string,
  columnMappings: Record<string, string>,
): { rows: Record<string, unknown>[]; skipped: Array<{ row: number; reason: string }> } {
  const lines = fileContent.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { rows: [], skipped: [] };

  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, unknown>[] = [];
  const skipped: Array<{ row: number; reason: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const row: Record<string, unknown> = {};
    let skipReason = '';

    for (let h = 0; h < headers.length; h++) {
      const sourceCol = headers[h];
      const targetCol = columnMappings[sourceCol];
      if (targetCol) {
        const value = h < fields.length ? fields[h].trim() : '';
        if (!value) {
          skipReason = `Missing value for mapped field "${targetCol}" (source: "${sourceCol}")`;
        }
        row[targetCol] = value;
      }
    }

    if (skipReason) {
      skipped.push({ row: i + 1, reason: skipReason });
    } else {
      rows.push(row);
    }
  }

  return { rows, skipped };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// Generate safe column names (no commas, quotes, newlines, non-empty)
const safeColumnNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,15}$/);

// Generate safe cell values (non-empty after trim, survive CSV round-trip)
const safeCellValueArb = fc.oneof(
  fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,29}$/),
  // Values with commas and quotes to test escaping — must have at least one alnum char
  fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9," ]{0,19}$/),
);

/**
 * Property 23: CSV parse round-trip
 * **Validates: Requirements 6.2, 6.5**
 *
 * For any set of records and column definitions, generating a CSV string and then
 * parsing it back should produce records with equivalent field values for all columns.
 */
describe('Property 23: CSV round-trip', () => {
  it('generate → parse should produce equivalent records', () => {
    fc.assert(
      fc.property(
        // Generate 1-5 unique column names
        fc.uniqueArray(safeColumnNameArb, { minLength: 1, maxLength: 5 }).filter((cols) => cols.length >= 1),
        // Will generate rows based on columns in the test body
        fc.integer({ min: 1, max: 20 }),
        fc.infiniteStream(safeCellValueArb),
        (columns, rowCount, valueStream) => {
          // Build rows with non-empty values for all columns
          const rows: Record<string, unknown>[] = [];
          const iter = valueStream[Symbol.iterator]();
          for (let r = 0; r < rowCount; r++) {
            const row: Record<string, unknown> = {};
            for (const col of columns) {
              row[col] = iter.next().value;
            }
            rows.push(row);
          }

          // Generate CSV
          const csv = generateCSV(rows, columns);

          // Parse back with identity mapping (column → column)
          const mapping: Record<string, string> = {};
          for (const col of columns) {
            mapping[col] = col;
          }
          const result = parseCSV(csv, mapping);

          // All rows should round-trip (no skipped rows since all values are non-empty)
          expect(result.rows.length).toBe(rows.length);

          // Each field value should match after trimming (parseCSV trims values)
          for (let i = 0; i < rows.length; i++) {
            for (const col of columns) {
              expect(String(result.rows[i][col]).trim()).toBe(
                String(rows[i][col]).trim(),
              );
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 24: CSV import validation partitioning
 * **Validates: Requirements 6.3, 6.4**
 *
 * For any CSV file containing a mix of valid and invalid rows, the import should insert
 * exactly the valid rows, skip exactly the invalid rows, and imported + skipped = total.
 */
describe('Property 24: CSV validation partitioning', () => {
  it('valid + skipped counts should equal total row count', () => {
    fc.assert(
      fc.property(
        // Number of valid rows and invalid rows
        fc.integer({ min: 0, max: 15 }),
        fc.integer({ min: 0, max: 15 }),
        fc.infiniteStream(safeCellValueArb),
        (validCount, invalidCount, valueStream) => {
          const columns = ['name', 'email'];
          const iter = valueStream[Symbol.iterator]();

          // Build CSV lines
          const headerLine = columns.join(',');
          const dataLines: string[] = [];
          let expectedValid = 0;
          let expectedSkipped = 0;

          // Add valid rows (all fields non-empty)
          for (let i = 0; i < validCount; i++) {
            const values = columns.map(() => escapeCSVField(iter.next().value));
            dataLines.push(values.join(','));
            expectedValid++;
          }

          // Add invalid rows (empty value for mapped field)
          for (let i = 0; i < invalidCount; i++) {
            // First column has value, second is empty → triggers skip
            dataLines.push(`${escapeCSVField(iter.next().value)},`);
            expectedSkipped++;
          }

          const csv = [headerLine, ...dataLines].join('\n');
          const mapping: Record<string, string> = { name: 'name', email: 'email' };
          const result = parseCSV(csv, mapping);

          // Partition property: valid + skipped = total
          expect(result.rows.length + result.skipped.length).toBe(validCount + invalidCount);
          expect(result.rows.length).toBe(expectedValid);
          expect(result.skipped.length).toBe(expectedSkipped);
        },
      ),
      { numRuns: 100 },
    );
  });
});
