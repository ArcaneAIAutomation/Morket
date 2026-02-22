import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AgGridReact } from 'ag-grid-react';
import type {
  ColDef,
  CellValueChangedEvent,
  ColumnResizedEvent,
  ColumnMovedEvent,
  SortChangedEvent,
  FilterChangedEvent,
  SelectionChangedEvent,
  CellContextMenuEvent,
} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

import { useGridStore } from '@/stores/grid.store';
import { useAutoSave } from '@/hooks/useAutoSave';
import CellRenderer from './CellRenderer';
import GridToolbar from './GridToolbar';
import StatusBar from './StatusBar';
import ContextMenu from './ContextMenu';
import { EnrichmentPanel } from '@/components/enrichment/EnrichmentPanel';

export default function SpreadsheetView() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const gridRef = useRef<AgGridReact>(null);
  const filterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rows = useGridStore((s) => s.rows);
  const columns = useGridStore((s) => s.columns);
  const hiddenColumnIds = useGridStore((s) => s.hiddenColumnIds);
  const loadRecords = useGridStore((s) => s.loadRecords);
  const loadColumns = useGridStore((s) => s.loadColumns);
  const updateCell = useGridStore((s) => s.updateCell);
  const resizeColumn = useGridStore((s) => s.resizeColumn);
  const reorderColumns = useGridStore((s) => s.reorderColumns);
  const setSortModel = useGridStore((s) => s.setSortModel);
  const setFilterModel = useGridStore((s) => s.setFilterModel);
  const setSelectedRows = useGridStore((s) => s.setSelectedRows);
  const undo = useGridStore((s) => s.undo);

  // Enrichment panel state
  const [enrichmentOpen, setEnrichmentOpen] = useState(false);

  // Auto-save dirty changes every 30s
  useAutoSave(workspaceId ?? null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    visible: boolean;
    type: 'row' | 'column';
  }>({ x: 0, y: 0, visible: false, type: 'row' });

  // Load data on mount
  useEffect(() => {
    if (!workspaceId) return;
    loadRecords(workspaceId).catch(() => {});
    loadColumns(workspaceId).catch(() => {});
  }, [workspaceId, loadRecords, loadColumns]);

  // Task 7.8: Ctrl/Cmd+Z keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [undo]);

  // Cleanup filter debounce timer on unmount
  useEffect(() => {
    return () => {
      if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
    };
  }, []);

  // Map ColumnDefinition[] to AG Grid ColDef[], excluding hidden columns
  const colDefs: ColDef[] = useMemo(() => {
    return columns
      .filter((col) => !hiddenColumnIds.has(col.id))
      .sort((a, b) => a.order - b.order)
      .map((col) => ({
        colId: col.id,
        field: col.field,
        headerName: col.headerName,
        width: col.width,
        pinned: col.pinned ?? undefined,
        sortable: col.sortable,
        filter: col.filterable,
        editable: col.editable,
        resizable: true,
        cellRenderer: CellRenderer,
      }));
  }, [columns, hiddenColumnIds]);

  const defaultColDef: ColDef = useMemo(
    () => ({
      resizable: true,
      sortable: true,
      filter: true,
    }),
    [],
  );

  // Event handlers
  const onCellValueChanged = useCallback(
    (event: CellValueChangedEvent) => {
      const recordId = event.data?.id as string;
      const field = event.colDef?.field;
      if (recordId && field) {
        updateCell(recordId, field, event.newValue);
      }
    },
    [updateCell],
  );

  const onColumnResized = useCallback(
    (event: ColumnResizedEvent) => {
      if (event.finished && event.column) {
        const colId = event.column.getColId();
        const width = event.column.getActualWidth();
        resizeColumn(colId, width);
      }
    },
    [resizeColumn],
  );

  const onColumnMoved = useCallback(
    (event: ColumnMovedEvent) => {
      if (event.finished) {
        const allCols = gridRef.current?.api.getColumns();
        if (allCols) {
          const order = allCols.map((c) => c.getColId());
          reorderColumns(order);
        }
      }
    },
    [reorderColumns],
  );

  const onSortChanged = useCallback(
    (event: SortChangedEvent) => {
      const sortState = event.api.getColumnState()
        .filter((c) => c.sort)
        .map((c) => ({ colId: c.colId, sort: c.sort as 'asc' | 'desc' }));
      setSortModel(sortState);
    },
    [setSortModel],
  );

  // Task 7.9: 300ms debounced filter
  const onFilterChanged = useCallback(
    (event: FilterChangedEvent) => {
      if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
      filterTimerRef.current = setTimeout(() => {
        const model = event.api.getFilterModel();
        setFilterModel(model);
      }, 300);
    },
    [setFilterModel],
  );

  const onSelectionChanged = useCallback(
    (event: SelectionChangedEvent) => {
      const selected = event.api.getSelectedRows() as Array<{ id: string }>;
      setSelectedRows(new Set(selected.map((r) => r.id)));
    },
    [setSelectedRows],
  );

  const onCellContextMenu = useCallback((event: CellContextMenuEvent) => {
    event.event?.preventDefault();
    const mouseEvent = event.event as MouseEvent | undefined;
    if (mouseEvent) {
      setContextMenu({
        x: mouseEvent.clientX,
        y: mouseEvent.clientY,
        visible: true,
        type: 'row',
      });
    }
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  return (
    <div className="flex flex-col h-full">
      <GridToolbar onEnrich={() => setEnrichmentOpen(true)} />

      <div className="flex-1 ag-theme-alpine">
        <AgGridReact
          ref={gridRef}
          rowData={rows}
          columnDefs={colDefs}
          defaultColDef={defaultColDef}
          getRowId={(params) => params.data.id}
          rowSelection="multiple"
          rowMultiSelectWithClick={false}
          suppressRowClickSelection
          animateRows
          onCellValueChanged={onCellValueChanged}
          onColumnResized={onColumnResized}
          onColumnMoved={onColumnMoved}
          onSortChanged={onSortChanged}
          onFilterChanged={onFilterChanged}
          onSelectionChanged={onSelectionChanged}
          onCellContextMenu={onCellContextMenu}
        />
      </div>

      <ContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        visible={contextMenu.visible}
        type={contextMenu.type}
        onClose={closeContextMenu}
        onEnrichSelected={() => setEnrichmentOpen(true)}
      />

      <StatusBar />

      <EnrichmentPanel
        open={enrichmentOpen}
        onClose={() => setEnrichmentOpen(false)}
      />
    </div>
  );
}
