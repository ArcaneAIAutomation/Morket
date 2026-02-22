interface SearchPaginationProps {
  page: number;
  totalPages: number;
  totalResults: number;
  onPageChange: (page: number) => void;
}

export default function SearchPagination({
  page,
  totalPages,
  totalResults,
  onPageChange,
}: SearchPaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <nav className="flex items-center justify-between py-4" aria-label="Search results pagination">
      <p className="text-sm text-gray-500">
        Page {page} of {totalPages} ({totalResults.toLocaleString()} results)
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          aria-label="Previous page"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </nav>
  );
}
