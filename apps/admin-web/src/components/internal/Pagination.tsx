'use client';

interface PaginationProps {
  readonly page: number;
  readonly pageCount: number;
  readonly onChange: (next: number) => void;
}

/**
 * Simple page selector used by the tenant directory and other
 * fixed-page-size tables. Hides itself for single-page result sets.
 */
export function Pagination({ page, pageCount, onChange }: PaginationProps): JSX.Element | null {
  if (pageCount <= 1) return null;

  return (
    <nav aria-label="Pagination" className="flex items-center justify-end gap-2 mt-3">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, page - 1))}
        disabled={page === 0}
        className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-neutral-300 hover:bg-surface-sunken disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-xs text-neutral-500 tabular-nums">
        Page {page + 1} of {pageCount}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(pageCount - 1, page + 1))}
        disabled={page >= pageCount - 1}
        className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-neutral-300 hover:bg-surface-sunken disabled:opacity-40"
      >
        Next
      </button>
    </nav>
  );
}
