import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGridStore } from './grid.store';

vi.mock('@/api/records.api', () => ({
  getRecords: vi.fn(),
  createRecord: vi.fn(),
  batchUpdateRecords: vi.fn(),
  batchDeleteRecords: vi.fn(),
  getColumns: vi.fn(),
  createColumn: vi.fn(),
  updateColumn: vi.fn(),
  deleteColumn: vi.fn(),
}));

import * as recordsApi from '@/api/records.api';

const initialState = () => ({
  rows: [],
  columns: [],
  selectedRowIds: new Set<string>(),
  pendingChanges: [],
  undoStack: [],
  sortModel: [],
  filterModel: {},
  hiddenColumnIds: new Set<string>(),
  isLoading: false,
  isDirty: false,
});

describe('grid.store', () => {
  beforeEach(() => {
    useGridStore.setState(initialState());
    vi.clearAllMocks();
  });

  describe('addRow', () => {
    it('appends a new row with _isNew flag', () => {
      useGridStore.getState().addRow();

      const { rows } = useGridStore.getState();
      expect(rows).toHaveLength(1);
      expect(rows[0]._isNew).toBe(true);
      expect(rows[0].id).toBeDefined();
    });

    it('marks store as dirty', () => {
      useGridStore.getState().addRow();
      expect(useGridStore.getState().isDirty).toBe(true);
    });

    it('pushes a row_add entry to undo stack', () => {
      useGridStore.getState().addRow();

      const { undoStack } = useGridStore.getState();
      expect(undoStack).toHaveLength(1);
      expect(undoStack[0].type).toBe('row_add');
    });
  });

  describe('deleteRows', () => {
    it('removes specified rows', () => {
      useGridStore.setState({
        ...initialState(),
        rows: [
          { id: 'r1', _isNew: false, _isDirty: false, _enrichmentStatus: {} },
          { id: 'r2', _isNew: false, _isDirty: false, _enrichmentStatus: {} },
          { id: 'r3', _isNew: false, _isDirty: false, _enrichmentStatus: {} },
        ],
      });

      useGridStore.getState().deleteRows(['r1', 'r3']);

      const { rows } = useGridStore.getState();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('r2');
    });

    it('stores deleted rows in undo stack for restoration', () => {
      useGridStore.setState({
        ...initialState(),
        rows: [
          { id: 'r1', _isNew: false, _isDirty: false, _enrichmentStatus: {}, name: 'Alice' },
        ],
      });

      useGridStore.getState().deleteRows(['r1']);

      const { undoStack } = useGridStore.getState();
      expect(undoStack[0].type).toBe('row_delete');
      expect(undoStack[0].deletedRows).toHaveLength(1);
      expect(undoStack[0].deletedRows![0].name).toBe('Alice');
    });

    it('clears selection after delete', () => {
      useGridStore.setState({
        ...initialState(),
        rows: [{ id: 'r1', _isNew: false, _isDirty: false, _enrichmentStatus: {} }],
        selectedRowIds: new Set(['r1']),
      });

      useGridStore.getState().deleteRows(['r1']);
      expect(useGridStore.getState().selectedRowIds.size).toBe(0);
    });
  });

  describe('updateCell', () => {
    it('updates the cell value and marks row dirty', () => {
      useGridStore.setState({
        ...initialState(),
        rows: [{ id: 'r1', _isNew: false, _isDirty: false, _enrichmentStatus: {}, name: 'Old' }],
      });

      useGridStore.getState().updateCell('r1', 'name', 'New');

      const row = useGridStore.getState().rows[0];
      expect(row.name).toBe('New');
      expect(row._isDirty).toBe(true);
    });

    it('adds a pending change', () => {
      useGridStore.setState({
        ...initialState(),
        rows: [{ id: 'r1', _isNew: false, _isDirty: false, _enrichmentStatus: {}, name: 'Old' }],
      });

      useGridStore.getState().updateCell('r1', 'name', 'New');

      const { pendingChanges } = useGridStore.getState();
      expect(pendingChanges).toHaveLength(1);
      expect(pendingChanges[0].oldValue).toBe('Old');
      expect(pendingChanges[0].newValue).toBe('New');
    });

    it('does nothing for non-existent row', () => {
      useGridStore.setState({ ...initialState(), rows: [] });
      useGridStore.getState().updateCell('nonexistent', 'name', 'val');
      expect(useGridStore.getState().pendingChanges).toHaveLength(0);
    });
  });

  describe('undo', () => {
    it('reverts a cell edit', () => {
      useGridStore.setState({
        ...initialState(),
        rows: [{ id: 'r1', _isNew: false, _isDirty: false, _enrichmentStatus: {}, name: 'Original' }],
      });

      useGridStore.getState().updateCell('r1', 'name', 'Changed');
      useGridStore.getState().undo();

      expect(useGridStore.getState().rows[0].name).toBe('Original');
    });

    it('removes an added row on undo', () => {
      useGridStore.getState().addRow();
      expect(useGridStore.getState().rows).toHaveLength(1);

      useGridStore.getState().undo();
      expect(useGridStore.getState().rows).toHaveLength(0);
    });

    it('restores deleted rows on undo', () => {
      useGridStore.setState({
        ...initialState(),
        rows: [{ id: 'r1', _isNew: false, _isDirty: false, _enrichmentStatus: {}, name: 'Alice' }],
      });

      useGridStore.getState().deleteRows(['r1']);
      expect(useGridStore.getState().rows).toHaveLength(0);

      useGridStore.getState().undo();
      expect(useGridStore.getState().rows).toHaveLength(1);
      expect(useGridStore.getState().rows[0].name).toBe('Alice');
    });

    it('does nothing when undo stack is empty', () => {
      useGridStore.setState({ ...initialState() });
      useGridStore.getState().undo();
      expect(useGridStore.getState().rows).toHaveLength(0);
    });

    it('respects max 50 undo entries', () => {
      useGridStore.setState({
        ...initialState(),
        rows: [{ id: 'r1', _isNew: false, _isDirty: false, _enrichmentStatus: {}, val: 0 }],
      });

      for (let i = 1; i <= 55; i++) {
        useGridStore.getState().updateCell('r1', 'val', i);
      }

      expect(useGridStore.getState().undoStack.length).toBeLessThanOrEqual(50);
    });
  });

  describe('saveChanges', () => {
    it('calls createRecord for new rows and clears dirty state', async () => {
      vi.mocked(recordsApi.createRecord).mockResolvedValue({
        id: 'r1', _isNew: false, _isDirty: false, _enrichmentStatus: {},
      });

      useGridStore.setState({
        ...initialState(),
        rows: [{ id: 'r1', _isNew: true, _isDirty: false, _enrichmentStatus: {}, name: 'New' }],
        isDirty: true,
      });

      await useGridStore.getState().saveChanges('ws-1');

      expect(recordsApi.createRecord).toHaveBeenCalledWith('ws-1', { name: 'New' });
      expect(useGridStore.getState().isDirty).toBe(false);
      expect(useGridStore.getState().rows[0]._isNew).toBe(false);
    });

    it('calls batchUpdateRecords for edited rows', async () => {
      vi.mocked(recordsApi.batchUpdateRecords).mockResolvedValue(undefined);

      useGridStore.setState({
        ...initialState(),
        rows: [{ id: 'r1', _isNew: false, _isDirty: true, _enrichmentStatus: {}, name: 'Edited' }],
        pendingChanges: [{ recordId: 'r1', field: 'name', oldValue: 'Old', newValue: 'Edited', timestamp: Date.now() }],
        isDirty: true,
      });

      await useGridStore.getState().saveChanges('ws-1');

      expect(recordsApi.batchUpdateRecords).toHaveBeenCalledWith('ws-1', [
        { id: 'r1', fields: { name: 'Edited' } },
      ]);
    });

    it('retains pending changes on failure', async () => {
      vi.mocked(recordsApi.createRecord).mockRejectedValue(new Error('Save failed'));

      useGridStore.setState({
        ...initialState(),
        rows: [{ id: 'r1', _isNew: true, _isDirty: false, _enrichmentStatus: {} }],
        isDirty: true,
      });

      await expect(useGridStore.getState().saveChanges('ws-1')).rejects.toThrow('Save failed');
      expect(useGridStore.getState().isDirty).toBe(true);
    });
  });

  describe('column operations', () => {
    it('addColumn appends a column with generated id and order', () => {
      useGridStore.getState().addColumn({
        field: 'email',
        headerName: 'Email',
        dataType: 'email',
        width: 200,
        pinned: null,
        hidden: false,
        sortable: true,
        filterable: true,
        editable: true,
        enrichmentField: null,
        enrichmentProvider: null,
      });

      const { columns } = useGridStore.getState();
      expect(columns).toHaveLength(1);
      expect(columns[0].field).toBe('email');
      expect(columns[0].id).toBeDefined();
      expect(columns[0].order).toBe(0);
    });

    it('updateColumn updates specific column properties', () => {
      useGridStore.setState({
        ...initialState(),
        columns: [{
          id: 'c1', field: 'name', headerName: 'Name', dataType: 'text' as const,
          width: 150, pinned: null, hidden: false, sortable: true, filterable: true,
          editable: true, enrichmentField: null, enrichmentProvider: null, order: 0,
        }],
      });

      useGridStore.getState().updateColumn('c1', { headerName: 'Full Name', width: 250 });

      const col = useGridStore.getState().columns[0];
      expect(col.headerName).toBe('Full Name');
      expect(col.width).toBe(250);
    });

    it('deleteColumn removes the column and cleans hiddenColumnIds', () => {
      useGridStore.setState({
        ...initialState(),
        columns: [{
          id: 'c1', field: 'name', headerName: 'Name', dataType: 'text' as const,
          width: 150, pinned: null, hidden: true, sortable: true, filterable: true,
          editable: true, enrichmentField: null, enrichmentProvider: null, order: 0,
        }],
        hiddenColumnIds: new Set(['c1']),
      });

      useGridStore.getState().deleteColumn('c1');

      expect(useGridStore.getState().columns).toHaveLength(0);
      expect(useGridStore.getState().hiddenColumnIds.has('c1')).toBe(false);
    });

    it('hideColumn marks column hidden and adds to hiddenColumnIds', () => {
      useGridStore.setState({
        ...initialState(),
        columns: [{
          id: 'c1', field: 'name', headerName: 'Name', dataType: 'text' as const,
          width: 150, pinned: null, hidden: false, sortable: true, filterable: true,
          editable: true, enrichmentField: null, enrichmentProvider: null, order: 0,
        }],
      });

      useGridStore.getState().hideColumn('c1');

      expect(useGridStore.getState().columns[0].hidden).toBe(true);
      expect(useGridStore.getState().hiddenColumnIds.has('c1')).toBe(true);
    });

    it('showColumn marks column visible and removes from hiddenColumnIds', () => {
      useGridStore.setState({
        ...initialState(),
        columns: [{
          id: 'c1', field: 'name', headerName: 'Name', dataType: 'text' as const,
          width: 150, pinned: null, hidden: true, sortable: true, filterable: true,
          editable: true, enrichmentField: null, enrichmentProvider: null, order: 0,
        }],
        hiddenColumnIds: new Set(['c1']),
      });

      useGridStore.getState().showColumn('c1');

      expect(useGridStore.getState().columns[0].hidden).toBe(false);
      expect(useGridStore.getState().hiddenColumnIds.has('c1')).toBe(false);
    });

    it('reorderColumns updates order and sorts', () => {
      useGridStore.setState({
        ...initialState(),
        columns: [
          { id: 'c1', field: 'a', headerName: 'A', dataType: 'text' as const, width: 100, pinned: null, hidden: false, sortable: true, filterable: true, editable: true, enrichmentField: null, enrichmentProvider: null, order: 0 },
          { id: 'c2', field: 'b', headerName: 'B', dataType: 'text' as const, width: 100, pinned: null, hidden: false, sortable: true, filterable: true, editable: true, enrichmentField: null, enrichmentProvider: null, order: 1 },
        ],
      });

      useGridStore.getState().reorderColumns(['c2', 'c1']);

      const cols = useGridStore.getState().columns;
      expect(cols[0].id).toBe('c2');
      expect(cols[1].id).toBe('c1');
    });

    it('resizeColumn updates column width', () => {
      useGridStore.setState({
        ...initialState(),
        columns: [{
          id: 'c1', field: 'name', headerName: 'Name', dataType: 'text' as const,
          width: 150, pinned: null, hidden: false, sortable: true, filterable: true,
          editable: true, enrichmentField: null, enrichmentProvider: null, order: 0,
        }],
      });

      useGridStore.getState().resizeColumn('c1', 300);
      expect(useGridStore.getState().columns[0].width).toBe(300);
    });
  });
});
