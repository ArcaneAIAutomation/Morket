import { useState } from 'react';
import { useGridStore } from '@/stores/grid.store';
import { useUIStore } from '@/stores/ui.store';
import { useRole } from '@/hooks/useRole';
import ColumnDialog from './ColumnDialog';
import CSVImportDialog from './CSVImportDialog';

export default function GridToolbar() {
  const { can } = useRole();
  const addRow = useGridStore((s) => s.addRow);
  const selectedRowIds = useGridStore((s) => s.selectedRowIds);
  const deleteRows = useGridStore((s) => s.deleteRows);
  const columns = useGridStore((s) => s.columns);
  const rows = useGridStore((s) => s.rows);
  const hiddenColumnIds = useGridStore((s) => s.hiddenColumnIds);
  const showColumn = useGridStore((s) => s.showColumn);
  const addToast = useUIStore((s) => s.addToast);

  const [columnDialogOpen, setColumnDialogOpen] = useState(false);
  const [hiddenDropdownOpen, setHiddenDropdownOpen] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const hiddenColumns = columns.filter((c) => hiddenColumnIds.has(c.id));
  const hasSelection = selectedRowIds.size > 0;

  function handleDeleteSelected() {
    if (hasSelection) {
      deleteRows(Array.from(selectedRowIds));
    }
  }

  function handleImportCsv() {
    setCsvImportOpen(true);
  }

  function triggerExport(exportRows: Record<string, unknown>[], label: string) {
    const visibleCols = columns.filter((c) => !c.hidden);
    const colFields = visibleCols.map((c) => c.field);

    if (exportRows.length === 0) {
      addToast('warning', 'No rows to export.');
      return;
    }

    // Strip internal fields
    const cleanRows = exportRows.map((r) => {
      const clean: Record<string, unknown> = {};
      for (const f of colFields) {
        clean[f] = r[f];
      }
      return clean;
    });

    const USE_WORKER_THRESHOLD = 10_000;

    if (cleanRows.length >= USE_WORKER_THRESHOLD) {
      setIsExporting(true);
      const worker = new Worker(
        new URL('../../workers/csv.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'generate_result') {
          downloadCSV(msg.payload.csvContent, label);
          setIsExporting(false);
          worker.terminate();
        } else if (msg.type === 'error') {
          addToast('error', `Export failed: ${msg.payload.message}`);
          setIsExporting(false);
          worker.terminate();
        }
      };
      worker.onerror = () => {
        addToast('error', 'Export worker error.');
        setIsExporting(false);
        worker.terminate();
      };
      worker.postMessage({ type: 'generate', payload: { rows: cleanRows, columns: colFields } });
    } else {
      // Generate inline for small datasets
      const header = colFields.join(',');
      const lines = cleanRows.map((row) =>
        colFields.map((f) => {
          const v = row[f];
          const s = v == null ? '' : String(v);
          return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"`
            : s;
        }).join(','),
      );
      downloadCSV([header, ...lines].join('\n'), label);
    }
  }

  function downloadCSV(csvContent: string, label: string) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `morket-export-${label}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('success', `Exported ${label} data.`);
  }

  function handleExportAll() {
    setExportMenuOpen(false);
    triggerExport(rows, 'all');
  }

  function handleExportSelected() {
    setExportMenuOpen(false);
    const selected = rows.filter((r) => selectedRowIds.has(r.id));
    triggerExport(selected, 'selected');
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200">
      {can('add_records') && (
        <button
          onClick={addRow}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Add Row
        </button>
      )}

      {can('delete_records') && (
        <button
          onClick={handleDeleteSelected}
          disabled={!hasSelection}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Delete Selected
        </button>
      )}

      {can('import_csv') && (
        <button
          onClick={handleImportCsv}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Import CSV
        </button>
      )}

      {can('export_csv') && (
        <div className="relative">
          <button
            onClick={() => setExportMenuOpen((prev) => !prev)}
            disabled={isExporting}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            {isExporting ? 'Exporting…' : 'Export CSV'}
          </button>
          {exportMenuOpen && (
            <div className="absolute left-0 mt-1 w-44 bg-white border border-gray-200 rounded-md shadow-lg z-40 py-1">
              <button
                onClick={handleExportAll}
                className="block w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
              >
                Export All
              </button>
              <button
                onClick={handleExportSelected}
                disabled={!hasSelection}
                className="block w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Export Selected
              </button>
            </div>
          )}
        </div>
      )}

      {can('manage_columns') && (
        <button
          onClick={() => setColumnDialogOpen(true)}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Add Column
        </button>
      )}

      {/* Hidden Columns dropdown */}
      {hiddenColumns.length > 0 && (
        <div className="relative ml-auto">
          <button
            onClick={() => setHiddenDropdownOpen((prev) => !prev)}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200"
          >
            Hidden ({hiddenColumns.length})
          </button>
          {hiddenDropdownOpen && (
            <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-40 py-1">
              {hiddenColumns.map((col) => (
                <div
                  key={col.id}
                  className="flex items-center justify-between px-3 py-1.5 text-sm"
                >
                  <span className="text-gray-700 truncate">{col.headerName}</span>
                  <button
                    onClick={() => {
                      showColumn(col.id);
                      if (hiddenColumns.length <= 1) setHiddenDropdownOpen(false);
                    }}
                    className="text-blue-600 hover:text-blue-800 text-xs font-medium ml-2"
                  >
                    Show
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ColumnDialog open={columnDialogOpen} onClose={() => setColumnDialogOpen(false)} />
      <CSVImportDialog open={csvImportOpen} onClose={() => setCsvImportOpen(false)} />
    </div>
  );
}
