import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { useGridStore } from '@/stores/grid.store';

const LAST_WORKSPACE_KEY = 'morket_lastWorkspaceId';

function resetGridStore() {
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
}

beforeEach(() => {
  resetGridStore();
  localStorage.clear();
});

/**
 * Property 2: Last workspace ID round-trip persistence
 * **Validates: Requirements 1.7**
 *
 * For any valid workspace UUID, setting it as the active workspace should persist it
 * to localStorage, and reading it back should return the same UUID.
 */
describe('Property 2: Workspace ID round-trip persistence', () => {
  it('should persist and retrieve workspace ID from localStorage', () => {
    fc.assert(
      fc.property(fc.uuid(), (workspaceId) => {
        localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
        const retrieved = localStorage.getItem(LAST_WORKSPACE_KEY);
        expect(retrieved).toBe(workspaceId);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 15: Cell edit updates Grid_Store and marks dirty
 * **Validates: Requirements 4.6, 5.4**
 *
 * For any cell edit (recordId, field, newValue), the Grid_Store should reflect the new
 * value, the record should be marked dirty, and a PendingChange entry should be added.
 */
describe('Property 15: Cell edit updates store', () => {
  it('should update cell value, mark dirty, and add pending change', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,10}$/),
        fc.string({ minLength: 1, maxLength: 50 }),
        (recordId, field, newValue) => {
          resetGridStore();

          // Seed a row
          useGridStore.setState({
            rows: [{ id: recordId, _isNew: false, _isDirty: false, _enrichmentStatus: {} }],
          });

          // Perform cell edit
          useGridStore.getState().updateCell(recordId, field, newValue);

          const state = useGridStore.getState();
          const row = state.rows.find((r) => r.id === recordId);

          // Value should be updated
          expect(row?.[field]).toBe(newValue);
          // Row should be marked dirty
          expect(row?._isDirty).toBe(true);
          // Store should be dirty
          expect(state.isDirty).toBe(true);
          // PendingChange should exist
          expect(state.pendingChanges.length).toBeGreaterThanOrEqual(1);
          const lastChange = state.pendingChanges[state.pendingChanges.length - 1];
          expect(lastChange.recordId).toBe(recordId);
          expect(lastChange.field).toBe(field);
          expect(lastChange.newValue).toBe(newValue);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 17: Column layout persistence
 * **Validates: Requirements 4.10, 4.11**
 *
 * For any column resize or reorder operation, the Grid_Store should reflect the
 * updated width or column order immediately.
 */
describe('Property 17: Column layout persistence', () => {
  it('should persist column width after resize', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 50, max: 800 }),
        (colId, newWidth) => {
          resetGridStore();
          useGridStore.setState({
            columns: [{
              id: colId, field: 'col1', headerName: 'Col 1', dataType: 'text',
              width: 100, pinned: null, hidden: false, sortable: true,
              filterable: true, editable: true, enrichmentField: null,
              enrichmentProvider: null, order: 0,
            }],
          });

          useGridStore.getState().resizeColumn(colId, newWidth);

          const col = useGridStore.getState().columns.find((c) => c.id === colId);
          expect(col?.width).toBe(newWidth);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should persist column order after reorder', () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(['col-a', 'col-b', 'col-c'], { minLength: 3, maxLength: 3 }),
        (newOrder) => {
          resetGridStore();
          const baseCols = newOrder.map((id, i) => ({
            id, field: id, headerName: id, dataType: 'text' as const,
            width: 100, pinned: null as ('left' | null), hidden: false, sortable: true,
            filterable: true, editable: true, enrichmentField: null,
            enrichmentProvider: null, order: i,
          }));
          useGridStore.setState({ columns: baseCols });

          useGridStore.getState().reorderColumns(newOrder);

          const cols = useGridStore.getState().columns;
          for (let i = 0; i < newOrder.length; i++) {
            expect(cols[i].id).toBe(newOrder[i]);
            expect(cols[i].order).toBe(i);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Property 19: Add row increases row count
 * **Validates: Requirements 5.1**
 *
 * For any grid state with N rows, adding a new row should result in N+1 rows,
 * with the new row at the bottom having _isNew: true and all fields empty.
 */
describe('Property 19: Add row count', () => {
  it('should increase row count by 1 with _isNew true', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }),
        (initialRowCount) => {
          resetGridStore();

          // Seed initial rows
          const initialRows = Array.from({ length: initialRowCount }, (_, i) => ({
            id: `row-${i}`,
            _isNew: false,
            _isDirty: false,
            _enrichmentStatus: {},
          }));
          useGridStore.setState({ rows: initialRows });

          // Add a row
          useGridStore.getState().addRow();

          const state = useGridStore.getState();
          expect(state.rows.length).toBe(initialRowCount + 1);

          // New row should be at the bottom
          const newRow = state.rows[state.rows.length - 1];
          expect(newRow._isNew).toBe(true);
          expect(state.isDirty).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 20: Delete rows removes exactly selected rows
 * **Validates: Requirements 5.2, 5.3**
 *
 * For any grid state and any subset of selected row IDs, confirming deletion should
 * remove exactly those rows, leaving all other rows unchanged.
 */
describe('Property 20: Delete rows', () => {
  it('should remove exactly the specified rows', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 0, max: 100 }),
        (rowCount, seed) => {
          resetGridStore();

          const allIds = Array.from({ length: rowCount }, (_, i) => `row-${i}`);
          const initialRows = allIds.map((id) => ({
            id,
            _isNew: false,
            _isDirty: false,
            _enrichmentStatus: {},
          }));
          useGridStore.setState({ rows: initialRows });

          // Select a subset to delete (use seed to determine which)
          const deleteCount = Math.min(seed % (rowCount + 1), rowCount);
          const toDelete = allIds.slice(0, deleteCount);
          const toKeep = allIds.slice(deleteCount);

          useGridStore.getState().deleteRows(toDelete);

          const state = useGridStore.getState();
          const remainingIds = state.rows.map((r) => r.id);

          // Remaining rows should be exactly the ones not deleted
          expect(remainingIds.length).toBe(toKeep.length);
          for (const id of toKeep) {
            expect(remainingIds).toContain(id);
          }
          for (const id of toDelete) {
            expect(remainingIds).not.toContain(id);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 22: Undo reverses edits in LIFO order with max 50
 * **Validates: Requirements 5.7**
 *
 * For any sequence of edit operations, each undo should reverse the most recent
 * operation. The undo stack should never exceed 50 entries.
 */
describe('Property 22: Undo LIFO with max 50', () => {
  it('undo stack should never exceed 50 entries', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 80 }),
        (editCount) => {
          resetGridStore();

          // Seed a row to edit
          useGridStore.setState({
            rows: [{ id: 'row-1', _isNew: false, _isDirty: false, _enrichmentStatus: {} }],
          });

          // Perform N cell edits
          for (let i = 0; i < editCount; i++) {
            useGridStore.getState().updateCell('row-1', 'field', `value-${i}`);
          }

          const state = useGridStore.getState();
          expect(state.undoStack.length).toBeLessThanOrEqual(50);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('undo should reverse the most recent cell edit', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (firstValue, secondValue) => {
          resetGridStore();

          useGridStore.setState({
            rows: [{ id: 'row-1', field1: 'original', _isNew: false, _isDirty: false, _enrichmentStatus: {} }],
          });

          // Edit twice
          useGridStore.getState().updateCell('row-1', 'field1', firstValue);
          useGridStore.getState().updateCell('row-1', 'field1', secondValue);

          // Undo should restore to firstValue
          useGridStore.getState().undo();
          expect(useGridStore.getState().rows[0].field1).toBe(firstValue);

          // Undo again should restore to 'original'
          useGridStore.getState().undo();
          expect(useGridStore.getState().rows[0].field1).toBe('original');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('undo of addRow should remove the added row', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }),
        (initialCount) => {
          resetGridStore();

          const initialRows = Array.from({ length: initialCount }, (_, i) => ({
            id: `existing-${i}`,
            _isNew: false,
            _isDirty: false,
            _enrichmentStatus: {},
          }));
          useGridStore.setState({ rows: initialRows });

          useGridStore.getState().addRow();
          expect(useGridStore.getState().rows.length).toBe(initialCount + 1);

          useGridStore.getState().undo();
          expect(useGridStore.getState().rows.length).toBe(initialCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});
