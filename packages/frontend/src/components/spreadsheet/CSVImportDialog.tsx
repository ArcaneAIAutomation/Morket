import { useState, useRef, useCallback, useEffect } from 'react';
import { useGridStore } from '@/stores/grid.store';
import { useUIStore } from '@/stores/ui.store';
import type { RecordRow, ColumnDefinition } from '@/types/grid.types';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

type ImportStep = 'pick' | 'mapping' | 'importing';

interface CSVImportDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Parse just the header row from CSV content to extract column names. */
function parseHeaderRow(content: string): string[] {
  const firstLine = content.split(/\r?\n/)[0] ?? '';
  // Simple header parse — no quoted commas expected in headers typically
  return firstLine.split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
}

export default function CSVImportDialog({ open, onClose }: CSVImportDialogProps) {
  const columns = useGridStore((s) => s.columns);
  const addToast = useUIStore((s) => s.addToast);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);

  const [step, setStep] = useState<ImportStep>('pick');
  const [fileContent, setFileContent] = useState<string>('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Visible (non-hidden) columns for mapping targets
  const visibleColumns = columns.filter((c) => !c.hidden);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setStep('pick');
      setFileContent('');
      setCsvHeaders([]);
      setMappings({});
      setProgress(0);
      setError(null);
    }
  }, [open]);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  /** Auto-map CSV headers to grid columns by matching header name to column field or headerName. */
  const autoMap = useCallback(
    (headers: string[]) => {
      const map: Record<string, string> = {};
      for (const header of headers) {
        const lower = header.toLowerCase();
        const match = visibleColumns.find(
          (c) =>
            c.field.toLowerCase() === lower ||
            c.headerName.toLowerCase() === lower,
        );
        if (match) {
          map[header] = match.field;
        }
      }
      return map;
    },
    [visibleColumns],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setError(null);
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > MAX_FILE_SIZE) {
        setError('File exceeds 10MB limit.');
        return;
      }
      if (!file.name.endsWith('.csv')) {
        setError('Only .csv files are accepted.');
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        const headers = parseHeaderRow(content);
        if (headers.length === 0 || (headers.length === 1 && !headers[0])) {
          setError('CSV file appears to be empty or has no headers.');
          return;
        }
        setFileContent(content);
        setCsvHeaders(headers);
        setMappings(autoMap(headers));
        setStep('mapping');
      };
      reader.onerror = () => setError('Failed to read file.');
      reader.readAsText(file);
    },
    [autoMap],
  );

  const handleMappingChange = useCallback(
    (csvHeader: string, targetField: string) => {
      setMappings((prev) => {
        const next = { ...prev };
        if (targetField === '') {
          delete next[csvHeader];
        } else {
          next[csvHeader] = targetField;
        }
        return next;
      });
    },
    [],
  );

  const handleConfirmImport = useCallback(() => {
    if (Object.keys(mappings).length === 0) {
      setError('Map at least one column before importing.');
      return;
    }

    setStep('importing');
    setProgress(0);
    setError(null);

    const worker = new Worker(
      new URL('../../workers/csv.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        setProgress(msg.payload.percent);
      } else if (msg.type === 'parse_result') {
        const { rows: parsedRows, skipped } = msg.payload as {
          rows: Record<string, unknown>[];
          skipped: Array<{ row: number; reason: string }>;
        };

        // Insert parsed rows into grid store
        const gridStore = useGridStore.getState();
        for (const parsed of parsedRows) {
          const id = crypto.randomUUID();
          const newRow: RecordRow = {
            id,
            _isNew: true,
            _isDirty: false,
            _enrichmentStatus: {},
            ...parsed,
          };
          // Batch by directly mutating state once
          gridStore.rows = [...gridStore.rows, newRow];
        }
        // Trigger a single state update
        useGridStore.setState({
          rows: [...gridStore.rows],
          isDirty: parsedRows.length > 0,
        });

        // Build summary toast
        let message = `Imported ${parsedRows.length} row${parsedRows.length !== 1 ? 's' : ''}.`;
        if (skipped.length > 0) {
          message += ` Skipped ${skipped.length} row${skipped.length !== 1 ? 's' : ''} (missing required fields).`;
        }
        addToast(skipped.length > 0 ? 'warning' : 'success', message);

        worker.terminate();
        workerRef.current = null;
        onClose();
      } else if (msg.type === 'error') {
        setError(msg.payload.message);
        setStep('mapping');
        worker.terminate();
        workerRef.current = null;
      }
    };

    worker.onerror = () => {
      setError('CSV worker encountered an error.');
      setStep('mapping');
      worker.terminate();
      workerRef.current = null;
    };

    worker.postMessage({
      type: 'parse',
      payload: { fileContent, columnMappings: mappings },
    });
  }, [mappings, fileContent, addToast, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Import CSV</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-4">
          {error && (
            <div className="mb-3 p-2 text-sm text-red-700 bg-red-50 rounded border border-red-200">
              {error}
            </div>
          )}

          {/* Step 1: File picker */}
          {step === 'pick' && (
            <div>
              <p className="text-sm text-gray-600 mb-3">
                Select a .csv file (max 10MB) to import records.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
            </div>
          )}

          {/* Step 2: Column mapping preview */}
          {step === 'mapping' && (
            <div>
              <p className="text-sm text-gray-600 mb-3">
                Map CSV columns to grid columns. Unmapped columns will be skipped.
              </p>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {csvHeaders.map((header) => (
                  <div key={header} className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-700 w-1/3 truncate" title={header}>
                      {header}
                    </span>
                    <span className="text-gray-400 text-sm">→</span>
                    <select
                      value={mappings[header] ?? ''}
                      onChange={(e) => handleMappingChange(header, e.target.value)}
                      className="flex-1 text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">— Skip —</option>
                      {visibleColumns.map((col) => (
                        <option key={col.id} value={col.field}>
                          {col.headerName} ({col.dataType})
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Importing progress */}
          {step === 'importing' && (
            <div className="text-center py-4">
              <p className="text-sm text-gray-600 mb-3">Importing…</p>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-2">{progress}%</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-3 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          {step === 'mapping' && (
            <button
              onClick={handleConfirmImport}
              disabled={Object.keys(mappings).length === 0}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
