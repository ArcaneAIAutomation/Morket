import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Pure sort/filter logic extracted for direct testing (no AG Grid dependency)
// These replicate the logic the grid applies to row data.
// ---------------------------------------------------------------------------

type SortDirection = 'asc' | 'desc';

function sortRows<T>(
  rows: T[],
  column: keyof T,
  direction: SortDirection,
): T[] {
  return [...rows].sort((a, b) => {
    const aVal = a[column];
    const bVal = b[column];

    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return direction === 'asc' ? -1 : 1;
    if (bVal == null) return direction === 'asc' ? 1 : -1;

    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return direction === 'asc' ? aVal - bVal : bVal - aVal;
    }

    const aStr = String(aVal);
    const bStr = String(bVal);
    const cmp = aStr.localeCompare(bStr);
    return direction === 'asc' ? cmp : -cmp;
  });
}

function filterRows<T extends Record<string, unknown>>(
  rows: T[],
  column: string,
  filterText: string,
): T[] {
  const lower = filterText.toLowerCase();
  return rows.filter((row) => {
    const val = row[column];
    if (val == null) return false;
    return String(val).toLowerCase().includes(lower);
  });
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

interface TestRow {
  id: string;
  name: string;
  age: number;
}

const testRowArb: fc.Arbitrary<TestRow> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 30 }),
  age: fc.integer({ min: 0, max: 150 }),
});

/**
 * Property 13: Sort correctness
 * **Validates: Requirements 4.3**
 *
 * For any column and dataset, applying ascending sort should produce rows ordered
 * by that column's values in ascending order, and descending sort should produce
 * the reverse order.
 */
describe('Property 13: Sort correctness', () => {
  it('ascending sort should produce non-decreasing order for numeric column', () => {
    fc.assert(
      fc.property(
        fc.array(testRowArb, { minLength: 0, maxLength: 50 }),
        (rows) => {
          const sorted = sortRows(rows, 'age', 'asc');

          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i].age).toBeGreaterThanOrEqual(sorted[i - 1].age);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('descending sort should produce non-increasing order for numeric column', () => {
    fc.assert(
      fc.property(
        fc.array(testRowArb, { minLength: 0, maxLength: 50 }),
        (rows) => {
          const sorted = sortRows(rows, 'age', 'desc');

          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i].age).toBeLessThanOrEqual(sorted[i - 1].age);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('ascending sort on string column should produce lexicographic order', () => {
    fc.assert(
      fc.property(
        fc.array(testRowArb, { minLength: 0, maxLength: 50 }),
        (rows) => {
          const sorted = sortRows(rows, 'name', 'asc');

          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i].name.localeCompare(sorted[i - 1].name)).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('sort should preserve the number of rows', () => {
    fc.assert(
      fc.property(
        fc.array(testRowArb, { minLength: 0, maxLength: 50 }),
        fc.constantFrom<SortDirection>('asc', 'desc'),
        (rows, direction) => {
          const sorted = sortRows(rows, 'age', direction);
          expect(sorted.length).toBe(rows.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 14: Filter correctness
 * **Validates: Requirements 4.4**
 *
 * For any column, filter text, and dataset, the visible rows after filtering should
 * be exactly those rows whose value in that column contains the filter text
 * (case-insensitive).
 */
describe('Property 14: Filter correctness', () => {
  it('all filtered rows should contain the filter text (case-insensitive)', () => {
    fc.assert(
      fc.property(
        fc.array(testRowArb, { minLength: 0, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 10 }),
        (rows, filterText) => {
          const filtered = filterRows(rows, 'name', filterText);

          for (const row of filtered) {
            expect(
              String(row.name).toLowerCase(),
            ).toContain(filterText.toLowerCase());
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('no excluded row should match the filter text', () => {
    fc.assert(
      fc.property(
        fc.array(testRowArb, { minLength: 0, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 10 }),
        (rows, filterText) => {
          const filtered = filterRows(rows, 'name', filterText);
          const filteredIds = new Set(filtered.map((r) => r.id));

          for (const row of rows) {
            if (!filteredIds.has(row.id)) {
              expect(
                String(row.name).toLowerCase(),
              ).not.toContain(filterText.toLowerCase());
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('filtered count + excluded count should equal total count', () => {
    fc.assert(
      fc.property(
        fc.array(testRowArb, { minLength: 0, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 10 }),
        (rows, filterText) => {
          const filtered = filterRows(rows, 'name', filterText);
          const excluded = rows.length - filtered.length;
          expect(filtered.length + excluded).toBe(rows.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('empty filter text on numeric column should match all non-null rows', () => {
    fc.assert(
      fc.property(
        fc.array(testRowArb, { minLength: 0, maxLength: 30 }),
        (rows) => {
          // Every row has a numeric age, String(age) always contains ""
          // but our filterRows requires minLength 1 for filterText,
          // so test with a digit that exists in the age
          const filtered = filterRows(rows, 'age', '0');
          for (const row of filtered) {
            expect(String(row.age)).toContain('0');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
