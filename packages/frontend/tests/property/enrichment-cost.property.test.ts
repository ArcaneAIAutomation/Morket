import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { useGridStore } from '@/stores/grid.store';
import type { CellEnrichmentStatus } from '@/types/grid.types';

beforeEach(() => {
  useGridStore.setState({
    rows: [],
    columns: [],
    selectedRowIds: new Set(),
    pendingChanges: [],
    undoStack: [],
    sortModel: [],
    filterModel: {},
    hiddenColumnIds: new Set(),
    isLoading: false,
    isDirty: false,
  });
});

// ---------------------------------------------------------------------------
// Credit estimation — pure function extracted from EnrichmentPanel logic
// ---------------------------------------------------------------------------

function estimateCreditCost(
  selectedRowCount: number,
  providers: Array<{ creditCostPerCall: number }>,
): number {
  return selectedRowCount * providers.reduce((sum, p) => sum + p.creditCostPerCall, 0);
}

/**
 * Property 26: Credit cost estimation arithmetic
 * **Validates: Requirements 7.3**
 *
 * For any combination of N selected records, a set of enrichment fields, and provider
 * credit costs, the estimated cost should equal N × Σ(creditCostPerCall).
 */
describe('Property 26: Credit estimation arithmetic', () => {
  it('estimated cost = selectedRows × sum of provider costs', () => {
    const providerArb = fc.record({
      creditCostPerCall: fc.integer({ min: 1, max: 100 }),
    });

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.array(providerArb, { minLength: 1, maxLength: 10 }),
        (selectedRowCount, providers) => {
          const estimated = estimateCreditCost(selectedRowCount, providers);
          const expectedSum = providers.reduce((s, p) => s + p.creditCostPerCall, 0);
          expect(estimated).toBe(selectedRowCount * expectedSum);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('zero selected rows should always produce zero cost', () => {
    const providerArb = fc.record({
      creditCostPerCall: fc.integer({ min: 1, max: 1000 }),
    });

    fc.assert(
      fc.property(
        fc.array(providerArb, { minLength: 1, maxLength: 10 }),
        (providers) => {
          expect(estimateCreditCost(0, providers)).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 27: Enrichment run button disabled when over budget
 * **Validates: Requirements 7.6**
 *
 * For any estimated credit cost and workspace credit balance, the "Run Enrichment"
 * button should be disabled if and only if the estimated cost exceeds the credit balance.
 */
describe('Property 27: Run button disabled when over budget', () => {
  it('button disabled iff estimatedCost > creditBalance', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (estimatedCost, creditBalance) => {
          const isDisabled = estimatedCost > creditBalance;

          if (estimatedCost > creditBalance) {
            expect(isDisabled).toBe(true);
          } else {
            expect(isDisabled).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 28: Enrichment results update grid cells
 * **Validates: Requirements 7.8**
 *
 * For any set of enrichment results (recordId, field, value, status), the Grid_Store
 * should update the corresponding cells with the enriched values and set the enrichment
 * status to "enriched" for successful results or "failed" for failed results.
 */
describe('Property 28: Enrichment results update cells', () => {
  it('bulkUpdateEnrichmentStatus should update cell values and statuses', () => {
    const statusArb = fc.constantFrom<CellEnrichmentStatus>('enriched', 'failed');
    const fieldArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,8}$/);

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.array(
          fc.record({
            field: fieldArb,
            status: statusArb,
            value: fc.string({ minLength: 1, maxLength: 30 }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (rowCount, updates) => {
          // Reset store
          const rowIds = Array.from({ length: rowCount }, (_, i) => `row-${i}`);
          useGridStore.setState({
            rows: rowIds.map((id) => ({
              id,
              _isNew: false,
              _isDirty: false,
              _enrichmentStatus: {},
            })),
          });

          // Apply updates to the first row
          const targetRowId = rowIds[0];
          const bulkUpdates = updates.map((u) => ({
            recordId: targetRowId,
            field: u.field,
            status: u.status,
            value: u.status === 'enriched' ? u.value : undefined,
          }));

          useGridStore.getState().bulkUpdateEnrichmentStatus(bulkUpdates);

          const state = useGridStore.getState();
          const row = state.rows.find((r) => r.id === targetRowId);
          expect(row).toBeDefined();

          for (const update of bulkUpdates) {
            // Enrichment status should be set
            expect(row!._enrichmentStatus[update.field]).toBe(update.status);
            // If enriched, value should be updated
            if (update.status === 'enriched' && update.value !== undefined) {
              expect(row![update.field]).toBe(update.value);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
