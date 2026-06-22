'use client';

/**
 * Pagination — THIN WRAPPER over the design-system `Pagination`.
 *
 * The app's call sites use a 0-indexed contract
 * (`{ page, pageCount, onChange }`, where `page` is 0-based); the DS
 * primitive is 1-indexed (`{ currentPage, totalPages, onPageChange }`).
 * This wrapper preserves the 0-indexed public API VERBATIM and
 * translates across the boundary, so existing importers keep compiling
 * while the rendered control, its prev/next affordances, and its tokens
 * all come from the design system. Single-page result sets still hide
 * themselves.
 */
import { Pagination as DsPagination } from '@borjie/design-system';

interface PaginationProps {
  readonly page: number;
  readonly pageCount: number;
  readonly onChange: (next: number) => void;
}

export function Pagination({ page, pageCount, onChange }: PaginationProps): JSX.Element | null {
  if (pageCount <= 1) return null;

  return (
    <div className="mt-3 flex justify-end">
      <DsPagination
        currentPage={page + 1}
        totalPages={pageCount}
        onPageChange={(next) => onChange(next - 1)}
      />
    </div>
  );
}
