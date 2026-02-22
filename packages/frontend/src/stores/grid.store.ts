import { create } from 'zustand';
import type {
  RecordRow,
  ColumnDefinition,
  PendingChange,
  UndoEntry,
  CellEnrichmentStatus,
} from '@/types/grid.types';
import * as recordsApi from '@/api/records.api';

const MAX_UNDO = 50;

interface GridState {
  rows: RecordRow[];
  columns: ColumnDefinition[];
  selectedRowIds: Set<string>;
  pendingChanges: PendingChange[];
  undoStack: UndoEntry[];
  sortModel: Array<{ colId: string; sort: 'asc' | 'desc' }>;
  filterModel: Record<string, unknown>;
  hiddenColumnIds: Set<string>;
  isLoading: boolean;
  isDirty: boolean;

  // Data operations
  loadRecords: (workspaceId: string) => Promise<void>;
  addRow: () => void;
  deleteRows: (rowIds: string[]) => void;
  updateCell: (recordId: string, field: string, value: unknown) => void;
  saveChanges: (workspaceId: string) => Promise<void>;
  undo: () => void;

  // Column operations
  loadColumns: (workspaceId: string) => Promise<void>;
  addColumn: (col: Omit<ColumnDefinition, 'id' | 'order'>) => void;
  updateColumn: (colId: string, updates: Partial<ColumnDefinition>) => void;
  deleteColumn: (colId: string) => void;
  hideColumn: (colId: string) => void;
  showColumn: (colId: string) => void;
  reorderColumns: (columnOrder: string[]) => void;
  resizeColumn: (colId: string, width: number) => void;

  // Selection
  setSelectedRows: (ids: Set<string>) => void;
  clearSelection: () => void;

  // Sort/Filter
  setSortModel: (model: Array<{ colId: string; sort: 'asc' | 'desc' }>) => void;
  setFilterModel: (model: Record<string, unknown>) => void;

  // Enrichment status
  setCellEnrichmentStatus: (recordId: string, field: string, status: CellEnrichmentStatus) => void;
  bulkUpdateEnrichmentStatus: (updates: Array<{ recordId: string; field: string; status: CellEnrichmentStatus; value?: unknown }>) => void;
}

function pushUndo(stack: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  const next = [...stack, entry];
  return next.length > MAX_UNDO ? next.slice(next.length - MAX_UNDO) : next;
}

export const useGridStore = create<GridState>((set, get) => ({
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

  // ---------------------------------------------------------------------------
  // Data operations
  // ---------------------------------------------------------------------------

  loadRecords: async (workspaceId) => {
    set({ isLoading: true });
    try {
      const rows = await recordsApi.getRecords(workspaceId);
      set({ rows, isLoading: false, pendingChanges: [], undoStack: [], isDirty: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  addRow: () => {
    const id = crypto.randomUUID();
    const newRow: RecordRow = {
      id,
      _isNew: true,
      _isDirty: false,
      _enrichmentStatus: {},
    };
    set((state) => ({
      rows: [...state.rows, newRow],
      undoStack: pushUndo(state.undoStack, {
        type: 'row_add',
        changes: [{ recordId: id, field: '', oldValue: undefined, newValue: undefined, timestamp: Date.now() }],
      }),
      isDirty: true,
    }));
  },

  deleteRows: (rowIds) => {
    const rowIdSet = new Set(rowIds);
    const { rows, undoStack } = get();
    const deletedRows = rows.filter((r) => rowIdSet.has(r.id));
    set({
      rows: rows.filter((r) => !rowIdSet.has(r.id)),
      undoStack: pushUndo(undoStack, {
        type: 'row_delete',
        changes: rowIds.map((id) => ({ recordId: id, field: '', oldValue: undefined, newValue: undefined, timestamp: Date.now() })),
        deletedRows,
      }),
      selectedRowIds: new Set(),
      isDirty: true,
    });
  },

  updateCell: (recordId, field, value) => {
    const { rows, pendingChanges, undoStack } = get();
    const row = rows.find((r) => r.id === recordId);
    if (!row) return;

    const oldValue = row[field];
    const timestamp = Date.now();

    set({
      rows: rows.map((r) =>
        r.id === recordId ? { ...r, [field]: value, _isDirty: true } : r,
      ),
      pendingChanges: [
        ...pendingChanges,
        { recordId, field, oldValue, newValue: value, timestamp },
      ],
      undoStack: pushUndo(undoStack, {
        type: 'cell_edit',
        changes: [{ recordId, field, oldValue, newValue: value, timestamp }],
      }),
      isDirty: true,
    });
  },

  saveChanges: async (workspaceId) => {
    const { rows, pendingChanges } = get();

    const newRows = rows.filter((r) => r._isNew);
    const editedRecordIds = new Set(
      pendingChanges.filter((c) => c.field).map((c) => c.recordId),
    );
    const editedRows = rows.filter(
      (r) => r._isDirty && !r._isNew && editedRecordIds.has(r.id),
    );

    try {
      // Create new rows
      for (const row of newRows) {
        const { _isNew, _isDirty, _enrichmentStatus, id: _id, ...fields } = row;
        await recordsApi.createRecord(workspaceId, fields);
      }

      // Batch update edited rows
      if (editedRows.length > 0) {
        const updates = editedRows.map((r) => {
          const { _isNew, _isDirty, _enrichmentStatus, id, ...fields } = r;
          return { id, fields };
        });
        await recordsApi.batchUpdateRecords(workspaceId, updates);
      }

      // Mark all rows as persisted
      set((state) => ({
        rows: state.rows.map((r) => ({ ...r, _isNew: false, _isDirty: false })),
        pendingChanges: [],
        isDirty: false,
      }));
    } catch (error) {
      // Retain pending changes on failure for retry
      throw error;
    }
  },

  undo: () => {
    const { undoStack, rows } = get();
    if (undoStack.length === 0) return;

    const entry = undoStack[undoStack.length - 1];
    const newStack = undoStack.slice(0, -1);

    switch (entry.type) {
      case 'cell_edit': {
        const change = entry.changes[0];
        set({
          rows: rows.map((r) =>
            r.id === change.recordId
              ? { ...r, [change.field]: change.oldValue }
              : r,
          ),
          undoStack: newStack,
        });
        break;
      }
      case 'row_add': {
        const addedId = entry.changes[0].recordId;
        set({
          rows: rows.filter((r) => r.id !== addedId),
          undoStack: newStack,
        });
        break;
      }
      case 'row_delete': {
        if (entry.deletedRows) {
          set({
            rows: [...rows, ...entry.deletedRows],
            undoStack: newStack,
          });
        }
        break;
      }
    }
  },

  // ---------------------------------------------------------------------------
  // Column operations
  // ---------------------------------------------------------------------------

  loadColumns: async (workspaceId) => {
    const columns = await recordsApi.getColumns(workspaceId);
    const hiddenColumnIds = new Set(
      columns.filter((c) => c.hidden).map((c) => c.id),
    );
    set({ columns, hiddenColumnIds });
  },

  addColumn: (col) => {
    const id = crypto.randomUUID();
    const { columns } = get();
    const order = columns.length;
    set({ columns: [...columns, { ...col, id, order }] });
  },

  updateColumn: (colId, updates) => {
    set((state) => ({
      columns: state.columns.map((c) =>
        c.id === colId ? { ...c, ...updates } : c,
      ),
    }));
  },

  deleteColumn: (colId) => {
    set((state) => ({
      columns: state.columns.filter((c) => c.id !== colId),
      hiddenColumnIds: (() => {
        const next = new Set(state.hiddenColumnIds);
        next.delete(colId);
        return next;
      })(),
    }));
  },

  hideColumn: (colId) => {
    set((state) => ({
      columns: state.columns.map((c) =>
        c.id === colId ? { ...c, hidden: true } : c,
      ),
      hiddenColumnIds: new Set(state.hiddenColumnIds).add(colId),
    }));
  },

  showColumn: (colId) => {
    set((state) => ({
      columns: state.columns.map((c) =>
        c.id === colId ? { ...c, hidden: false } : c,
      ),
      hiddenColumnIds: (() => {
        const next = new Set(state.hiddenColumnIds);
        next.delete(colId);
        return next;
      })(),
    }));
  },

  reorderColumns: (columnOrder) => {
    set((state) => ({
      columns: state.columns
        .map((c) => ({ ...c, order: columnOrder.indexOf(c.id) }))
        .sort((a, b) => a.order - b.order),
    }));
  },

  resizeColumn: (colId, width) => {
    set((state) => ({
      columns: state.columns.map((c) =>
        c.id === colId ? { ...c, width } : c,
      ),
    }));
  },

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  setSelectedRows: (ids) => set({ selectedRowIds: ids }),
  clearSelection: () => set({ selectedRowIds: new Set() }),

  // ---------------------------------------------------------------------------
  // Sort / Filter
  // ---------------------------------------------------------------------------

  setSortModel: (model) => set({ sortModel: model }),
  setFilterModel: (model) => set({ filterModel: model }),

  // ---------------------------------------------------------------------------
  // Enrichment status
  // ---------------------------------------------------------------------------

  setCellEnrichmentStatus: (recordId, field, status) => {
    set((state) => ({
      rows: state.rows.map((r) =>
        r.id === recordId
          ? { ...r, _enrichmentStatus: { ...r._enrichmentStatus, [field]: status } }
          : r,
      ),
    }));
  },

  bulkUpdateEnrichmentStatus: (updates) => {
    set((state) => {
      const rowMap = new Map(state.rows.map((r) => [r.id, { ...r }]));
      for (const { recordId, field, status, value } of updates) {
        const row = rowMap.get(recordId);
        if (row) {
          row._enrichmentStatus = { ...row._enrichmentStatus, [field]: status };
          if (value !== undefined) {
            row[field] = value;
          }
        }
      }
      return { rows: Array.from(rowMap.values()) };
    });
  },
}));
