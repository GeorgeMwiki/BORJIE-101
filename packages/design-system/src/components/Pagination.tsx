import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';

export interface PaginationProps extends React.HTMLAttributes<HTMLElement> {
  /** Current page (1-indexed) */
  currentPage: number;
  /** Total number of pages */
  totalPages: number;
  /** Callback when page changes */
  onPageChange: (page: number) => void;
  /** Number of page buttons to show (excluding prev/next) */
  siblingCount?: number;
  /** Show first/last page buttons */
  showFirstLast?: boolean;
  /** Disabled state */
  disabled?: boolean;
}

const getPageRange = (
  currentPage: number,
  totalPages: number,
  siblingCount: number
): (number | 'ellipsis')[] => {
  const range: (number | 'ellipsis')[] = [];
  const leftSibling = Math.max(currentPage - siblingCount, 1);
  const rightSibling = Math.min(currentPage + siblingCount, totalPages);

  const showLeftEllipsis = leftSibling > 2;
  const showRightEllipsis = rightSibling < totalPages - 1;

  if (showLeftEllipsis && !showRightEllipsis) {
    const rightCount = 3 + 2 * siblingCount;
    return [
      1,
      'ellipsis',
      ...Array.from({ length: rightCount }, (_, i) => totalPages - rightCount + 1 + i),
    ];
  }
  if (!showLeftEllipsis && showRightEllipsis) {
    const leftCount = 3 + 2 * siblingCount;
    return [...Array.from({ length: leftCount }, (_, i) => i + 1), 'ellipsis', totalPages];
  }
  if (showLeftEllipsis && showRightEllipsis) {
    return [
      1,
      'ellipsis',
      ...Array.from({ length: rightSibling - leftSibling + 1 }, (_, i) => leftSibling + i),
      'ellipsis',
      totalPages,
    ];
  }

  return Array.from({ length: totalPages }, (_, i) => i + 1);
};

const Pagination = React.forwardRef<HTMLElement, PaginationProps>(
  (
    {
      currentPage,
      totalPages,
      onPageChange,
      siblingCount = 1,
      showFirstLast = false,
      disabled = false,
      className,
      ...props
    },
    ref
  ) => {
    const pages = getPageRange(currentPage, totalPages, siblingCount);
    const canPrevious = currentPage > 1 && !disabled;
    const canNext = currentPage < totalPages && !disabled;

    return (
      <nav
        ref={ref}
        role="navigation"
        aria-label="Pagination"
        className={cn('inline-flex items-center gap-1', className)}
        {...props}
      >
        {showFirstLast && (
          <button
            type="button"
            onClick={() => onPageChange(1)}
            disabled={!canPrevious}
            aria-label="Go to first page"
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-sm font-medium transition-colors',
              canPrevious
                ? 'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                : 'cursor-not-allowed opacity-50'
            )}
          >
            <ChevronLeft className="h-4 w-4 rotate-180" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={!canPrevious}
          aria-label="Go to previous page"
          className={cn(
            'inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-sm font-medium transition-colors',
            canPrevious
              ? 'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              : 'cursor-not-allowed opacity-50'
          )}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>

        <ul className="flex items-center gap-1" role="list">
          {pages.map((page, index) =>
            page === 'ellipsis' ? (
              <li key={`ellipsis-${index}`} className="px-2">
                <span className="text-muted-foreground" aria-hidden>
                  …
                </span>
              </li>
            ) : (
              <li key={page}>
                <button
                  type="button"
                  onClick={() => onPageChange(page)}
                  disabled={disabled}
                  aria-label={`Go to page ${page}`}
                  aria-current={page === currentPage ? 'page' : undefined}
                  className={cn(
                    'inline-flex h-9 min-w-[2.25rem] items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors',
                    page === currentPage
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  )}
                >
                  {page}
                </button>
              </li>
            )
          )}
        </ul>

        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={!canNext}
          aria-label="Go to next page"
          className={cn(
            'inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-sm font-medium transition-colors',
            canNext
              ? 'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              : 'cursor-not-allowed opacity-50'
          )}
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
        {showFirstLast && (
          <button
            type="button"
            onClick={() => onPageChange(totalPages)}
            disabled={!canNext}
            aria-label="Go to last page"
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-sm font-medium transition-colors',
              canNext
                ? 'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                : 'cursor-not-allowed opacity-50'
            )}
          >
            <ChevronRight className="h-4 w-4 rotate-180" aria-hidden />
          </button>
        )}
      </nav>
    );
  }
);
Pagination.displayName = 'Pagination';

export { Pagination };
