import { useState, useEffect } from 'react';
import type { ColumnDataType, ColumnDefinition } from '@/types/grid.types';
import type { EnrichmentFieldType } from '@/types/enrichment.types';
import { useGridStore } from '@/stores/grid.store';

const DATA_TYPES: ColumnDataType[] = ['text', 'number', 'email', 'url', 'date', 'boolean'];

const ENRICHMENT_FIELDS: Array<{ value: EnrichmentFieldType; label: string }> = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'company_info', label: 'Company Info' },
  { value: 'job_title', label: 'Job Title' },
  { value: 'social_profiles', label: 'Social Profiles' },
  { value: 'address', label: 'Address' },
];

interface ColumnDialogProps {
  open: boolean;
  onClose: () => void;
  editColumn?: ColumnDefinition;
}

export default function ColumnDialog({ open, onClose, editColumn }: ColumnDialogProps) {
  const addColumn = useGridStore((s) => s.addColumn);
  const updateColumn = useGridStore((s) => s.updateColumn);

  const [name, setName] = useState('');
  const [dataType, setDataType] = useState<ColumnDataType>('text');
  const [enrichmentField, setEnrichmentField] = useState<string>('');

  useEffect(() => {
    if (editColumn) {
      setName(editColumn.headerName);
      setDataType(editColumn.dataType);
      setEnrichmentField(editColumn.enrichmentField ?? '');
    } else {
      setName('');
      setDataType('text');
      setEnrichmentField('');
    }
  }, [editColumn, open]);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const field = trimmedName.toLowerCase().replace(/\s+/g, '_');

    if (editColumn) {
      updateColumn(editColumn.id, {
        headerName: trimmedName,
        field,
        dataType,
        enrichmentField: enrichmentField || null,
      });
    } else {
      addColumn({
        field,
        headerName: trimmedName,
        dataType,
        width: 150,
        pinned: null,
        hidden: false,
        sortable: true,
        filterable: true,
        editable: true,
        enrichmentField: enrichmentField || null,
        enrichmentProvider: null,
      });
    }

    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" role="dialog" aria-label={editColumn ? 'Edit Column' : 'Add Column'}>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {editColumn ? 'Edit Column' : 'Add Column'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="col-name" className="block text-sm font-medium text-gray-700 mb-1">
              Column Name
            </label>
            <input
              id="col-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Company Name"
              required
            />
          </div>

          <div>
            <label htmlFor="col-type" className="block text-sm font-medium text-gray-700 mb-1">
              Data Type
            </label>
            <select
              id="col-type"
              value={dataType}
              onChange={(e) => setDataType(e.target.value as ColumnDataType)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {DATA_TYPES.map((dt) => (
                <option key={dt} value={dt}>
                  {dt.charAt(0).toUpperCase() + dt.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="col-enrichment" className="block text-sm font-medium text-gray-700 mb-1">
              Enrichment Field Binding (optional)
            </label>
            <select
              id="col-enrichment"
              value={enrichmentField}
              onChange={(e) => setEnrichmentField(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">None</option>
              {ENRICHMENT_FIELDS.map((ef) => (
                <option key={ef.value} value={ef.value}>
                  {ef.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              {editColumn ? 'Save' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
