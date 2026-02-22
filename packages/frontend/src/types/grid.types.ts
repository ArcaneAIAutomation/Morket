export type ColumnDataType = 'text' | 'number' | 'email' | 'url' | 'date' | 'boolean';
export type CellEnrichmentStatus = 'enriched' | 'pending' | 'failed' | 'empty';

export interface ColumnDefinition {
  id: string;
  field: string;
  headerName: string;
  dataType: ColumnDataType;
  width: number;
  pinned: 'left' | null;
  hidden: boolean;
  sortable: boolean;
  filterable: boolean;
  editable: boolean;
  enrichmentField: string | null;
  enrichmentProvider: string | null;
  order: number;
}

export interface RecordRow {
  id: string;
  [field: string]: unknown;
  _enrichmentStatus: Record<string, CellEnrichmentStatus>;
  _isDirty: boolean;
  _isNew: boolean;
}

export interface PendingChange {
  recordId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
}

export interface UndoEntry {
  type: 'cell_edit' | 'row_add' | 'row_delete';
  changes: PendingChange[];
  deletedRows?: RecordRow[];
}
