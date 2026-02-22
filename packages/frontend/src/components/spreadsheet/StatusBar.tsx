import { useGridStore } from '@/stores/grid.store';

export default function StatusBar() {
  const rowCount = useGridStore((s) => s.rows.length);
  const selectedCount = useGridStore((s) => s.selectedRowIds.size);
  const filterModel = useGridStore((s) => s.filterModel);

  const hasActiveFilter = Object.keys(filterModel).length > 0;

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 text-sm text-gray-600 bg-gray-50 border-t border-gray-200">
      <span>Total: {rowCount} rows</span>
      <span className="text-gray-300">|</span>
      <span>Selected: {selectedCount}</span>
      {hasActiveFilter && (
        <>
          <span className="text-gray-300">|</span>
          <span className="flex items-center gap-1 text-blue-600">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
              />
            </svg>
            Filter active
          </span>
        </>
      )}
    </div>
  );
}
